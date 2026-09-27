import { createPublicClient, fallback, formatEther, formatUnits, http } from 'viem';
import { base } from 'viem/chains';
import { config } from './config.js';
import { erc721Abi, loopersExtrasAbi } from './abi.js';

/**
 * Public RPCs rate-limit aggressively (mainnet.base.org returns -32016 under
 * load). Rotate across independent endpoints instead of trusting one.
 */
const rpcCandidates = [
  config.rpcUrl,
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
  'https://mainnet.base.org',
];

const uniqueRpcs = [...new Set(rpcCandidates.filter(Boolean))];

const client = createPublicClient({
  chain: base,
  transport: fallback(uniqueRpcs.map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
});

export interface TokenIdentity {
  tokenId: number;
  contract: string;
  name: string;
  symbol: string;
  owner: string | null;
  tokenUri: string;
}

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export async function readTokenIdentity(tokenId: number): Promise<TokenIdentity> {
  const address = config.contract;
  const args = [BigInt(tokenId)] as const;

  const [name, symbol, owner, tokenUri] = await Promise.all([
    safe(client.readContract({ address, abi: erc721Abi, functionName: 'name' }), 'Unknown'),
    safe(client.readContract({ address, abi: erc721Abi, functionName: 'symbol' }), '?'),
    safe(client.readContract({ address, abi: erc721Abi, functionName: 'ownerOf', args }), null),
    client.readContract({ address, abi: erc721Abi, functionName: 'tokenURI', args }),
  ]);

  return { tokenId, contract: address, name: name.trim(), symbol: symbol.trim(), owner, tokenUri };
}

/** Fresh `ownerOf` read (bypasses the bundle cache) — used by the ownership gate. */
export async function readOwner(tokenId: number): Promise<string | null> {
  const owner = await safe(
    client.readContract({ address: config.contract, abi: erc721Abi, functionName: 'ownerOf', args: [BigInt(tokenId)] as const }),
    null,
  );
  return owner ? String(owner) : null;
}

export interface AgentBindings {
  bound: boolean;
  agentId: string | null;
  agentUri: string | null;
  identityRegistry: string | null;
  tokenBoundAccount: string | null;
}

/**
 * ERC-8004 agent identity + ERC-6551 token-bound account bindings for a Looper.
 * Every Looper is bound to an agent id at mint; legacy mints map their old id
 * through `legacyAgentIdByLooper`.
 */
export async function readAgentBindings(tokenId: number): Promise<AgentBindings> {
  const address = config.contract;
  const args = [BigInt(tokenId)] as const;

  const [bound, agentId, agentUri, registry, tba] = await Promise.all([
    safe(client.readContract({ address, abi: loopersExtrasAbi, functionName: 'erc8004BoundByLooper', args }), false),
    safe(client.readContract({ address, abi: loopersExtrasAbi, functionName: 'erc8004AgentIdByLooper', args }), 0n),
    safe(client.readContract({ address, abi: loopersExtrasAbi, functionName: 'erc8004AgentURI', args }), ''),
    safe(client.readContract({ address, abi: loopersExtrasAbi, functionName: 'EXPECTED_IDENTITY_REGISTRY' }), null),
    safe(client.readContract({ address, abi: loopersExtrasAbi, functionName: 'tokenBoundAccount', args }), null),
  ]);

  return {
    bound,
    agentId: agentId && agentId !== 0n ? agentId.toString() : null,
    agentUri: agentUri || null,
    identityRegistry: registry,
    tokenBoundAccount: tba,
  };
}

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const erc20BalanceAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/** Public wallet balances on Base (ETH + USDC) — sourced reads for the agent. */
export async function readWalletBalances(address: string): Promise<{ eth: string; usdc: string; at: string }> {
  const addr = address as `0x${string}`;
  const [wei, usdcRaw] = await Promise.all([
    client.getBalance({ address: addr }),
    safe(client.readContract({ address: USDC_BASE, abi: erc20BalanceAbi, functionName: 'balanceOf', args: [addr] }), 0n),
  ]);
  return { eth: formatEther(wei), usdc: formatUnits(usdcRaw ?? 0n, 6), at: new Date().toISOString() };
}
