/* SIWA signer page — builds the exact message, asks the injected wallet to sign
 * it (personal_sign), and outputs the ready-to-run registration command.
 * The private key never touches this page.
 *
 * Notes for this repo: this page is a dev-mode utility (not part of the prod
 * build), the companion `helixa-register.ps1` script is NOT bundled here, and
 * PAY_TO must be configured (see below) before the payment step can run. */

interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const statusEl = $<HTMLDivElement>('wallet-status');
const messageEl = $<HTMLPreElement>('message');
const commandEl = $<HTMLPreElement>('command');
const connectBtn = $<HTMLButtonElement>('connect');
const signBtn = $<HTMLButtonElement>('sign');
const payBtn = $<HTMLButtonElement>('pay');
const payStatusEl = $<HTMLDivElement>('pay-status');
const regenBtn = $<HTMLButtonElement>('regen');
const copyBtn = $<HTMLButtonElement>('copy');

const provider = (window as unknown as { ethereum?: InjectedProvider }).ethereum;

// x402 v2 terms captured from Helixa's live 402 challenge (their paid mint flow).
// PAY_TO is the payment destination for the flow — set it to YOUR service's
// x402 pay-to address before using the payment step; the placeholder below is
// intentionally not an address and blocks the flow until configured.
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0xYOUR_PAY_TO_ADDRESS';
const CHAIN_ID = 8453;
const PRICE = '1000000'; // 1.00 USDC (6 decimals)

const payToConfigured = (): boolean => /^0x[0-9a-fA-F]{40}$/.test(PAY_TO);

let address: string | null = null;
let timestamp = String(Math.floor(Date.now() / 1000));
let siwaSignature: string | null = null;

const buildMessage = (): string =>
  `Sign-In With Agent: api.helixa.xyz wants you to sign in with your wallet ${address ?? '{address}'} at ${timestamp}`;

function clearSignatures(note: string): void {
  siwaSignature = null;
  payBtn.disabled = true;
  payStatusEl.textContent = '';
  commandEl.textContent = note;
  copyBtn.disabled = true;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function render(): void {
  messageEl.textContent = buildMessage();
  signBtn.disabled = !address;
  payBtn.disabled = !siwaSignature;
  if (address) {
    statusEl.textContent = `connected: ${address}`;
  } else {
    statusEl.textContent = provider
      ? 'wallet detected — click connect'
      : 'no injected wallet found — open this page in a browser with MetaMask (or any browser wallet) installed';
  }
}

connectBtn.addEventListener('click', async () => {
  if (!provider) {
    render();
    return;
  }
  try {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    address = accounts[0] ?? null;
    render();
  } catch (err) {
    statusEl.textContent = `connection failed: ${(err as Error).message}`;
  }
});

regenBtn.addEventListener('click', () => {
  timestamp = String(Math.floor(Date.now() / 1000));
  clearSignatures('timestamp changed — sign again');
  render();
});

signBtn.addEventListener('click', async () => {
  if (!provider || !address) return;
  try {
    statusEl.textContent = 'waiting for your wallet to sign…';
    const msg = buildMessage();
    let signature: string;
    try {
      signature = (await provider.request({ method: 'personal_sign', params: [msg, address] })) as string;
    } catch {
      // some wallets expect the address first
      signature = (await provider.request({ method: 'personal_sign', params: [address, msg] })) as string;
    }
    siwaSignature = signature;
    statusEl.textContent = `siwa signed by ${address}`;
    payStatusEl.textContent = 'next: authorize the 1.00 USDC payment — no gas, expires in ~4 minutes…';
    commandEl.textContent = 'authorize the USDC payment, then copy the command…';
    copyBtn.disabled = true;
    render();
  } catch (err) {
    statusEl.textContent = `signing failed or was rejected: ${(err as Error).message}`;
  }
});

payBtn.addEventListener('click', async () => {
  if (!provider || !address || !siwaSignature) return;
  if (!payToConfigured()) {
    payStatusEl.textContent = 'pay-to address not configured — set PAY_TO in src/web/sign.ts to the x402 service\'s address first.';
    return;
  }
  try {
    payStatusEl.textContent = 'switching wallet to Base…';
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
    } catch {
      // wallet may already be on Base, or may refuse — the typed data carries chainId anyway
    }

    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: address,
      to: PAY_TO,
      value: PRICE,
      validAfter: String(now - 60),
      validBefore: String(now + 240),
      nonce: randomNonce(),
    };

    const typedData = {
      domain: { name: 'USD Coin', version: '2', chainId: CHAIN_ID, verifyingContract: USDC },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    };

    payStatusEl.textContent = 'waiting for your wallet to sign the USDC authorization…';
    const signature = (await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify(typedData)],
    })) as string;

    // x402 v2 PaymentPayload: resource + accepted (verbatim requirement) + payload + extensions
    const payload = {
      x402Version: 2,
      resource: {
        url: 'https://api.helixa.xyz/api/v2/mint',
        description: 'Register a new Helixa agent identity',
        mimeType: 'application/json',
      },
      accepted: {
        scheme: 'exact',
        network: 'eip155:8453',
        amount: PRICE,
        asset: USDC,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { name: 'USD Coin', version: '2' },
      },
      payload: { signature, authorization },
      extensions: {},
    };
    const paymentPayload = btoa(JSON.stringify(payload));

    payStatusEl.textContent = 'USDC authorization signed — valid ~4 minutes, run the command now';
    commandEl.textContent = `& scripts\\helixa-register.ps1 -Address ${address} -Timestamp ${timestamp} -Signature ${siwaSignature} -PaymentPayload ${paymentPayload} -Verify`;
    copyBtn.disabled = false;
  } catch (err) {
    payStatusEl.textContent = `payment signing failed or was rejected: ${(err as Error).message}`;
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(commandEl.textContent ?? '');
    copyBtn.textContent = 'copied ✓';
    setTimeout(() => (copyBtn.textContent = 'copy command'), 1500);
  } catch {
    copyBtn.textContent = 'copy failed — select the text manually';
  }
});

render();
if (!payToConfigured()) {
  payStatusEl.textContent = 'pay-to address not configured — set PAY_TO in src/web/sign.ts before using the payment step.';
  payBtn.title = 'set PAY_TO in src/web/sign.ts first';
}

export {};
