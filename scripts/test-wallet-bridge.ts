/**
 * Wallet bridge smoke test (Phase C) — live server + headless Edge.
 *
 * Proves:
 *   1. Server endpoints: shim served, /api/web3/rpc reads work + allowlist holds,
 *      /api/web3/inspect decodes + simulates a real USDC transfer.
 *   2. In a real sandboxed preview iframe, the injected shim gives a build:
 *      - reads through the runtime proxy (no wallet involved) → eth_chainId/eth_getBalance
 *      - a wallet send → the console HOST panel appears with DECODED + SIMULATED
 *        content; reject → the build gets error 4001
 *      - a second send, approved with a stubbed host wallet → the build receives
 *        the tx hash, proving the full loop up to the wallet boundary.
 *
 * Self-contained: spawns its own local runtime on :4532 with the ownership gate
 * off (throwaway data dir) — no dev server needed and the operator's server is
 * untouched. Run from the repo root: node_modules\.bin\tsx.cmd scripts\test-wallet-bridge.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { encodeFunctionData } from 'viem';
import { buildsRoot } from '../src/core/settings.js';

const PORT = 4532;
const BASE = `http://127.0.0.1:${PORT}`;
/** Real token so the console can activate; only scratch build files are touched. */
const TOKEN = Number(process.env.LOOPER_TEST_TOKEN ?? 7777);
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const OWNER = '0x1111111111111111111111111111111111111111';
const DEAD = '0x000000000000000000000000000000000000dEaD';

let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const transferData = encodeFunctionData({
  abi: [
    {
      name: 'transfer',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ type: 'bool' }],
    },
  ] as const,
  functionName: 'transfer',
  args: [DEAD, 1n],
});

const transferHugeData = encodeFunctionData({
  abi: [
    {
      name: 'transfer',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ type: 'bool' }],
    },
  ] as const,
  functionName: 'transfer',
  args: [DEAD, 10n ** 12n],
});

// ---------------------------------------------------------------- 1. server side

// ---------------------------------------------------- 0. local runtime (self-contained)
const tmpDir = path.join(os.tmpdir(), `looper-wallet-bridge-${Date.now()}`);
process.env.LOOPER_DATA_DIR = tmpDir; // scratch builds written below are served by the child
const serverProc = spawn(
  process.execPath,
  [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(process.cwd(), 'src', 'server', 'index.ts')],
  {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), LOOPER_DATA_DIR: tmpDir, LOOPER_REQUIRE_OWNERSHIP: 'false', LOOPER_TOKEN_ID: String(TOKEN) },
    stdio: 'ignore',
  },
);
const stopServer = (): void => {
  if (serverProc.pid) {
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/PID', String(serverProc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        serverProc.kill();
      }
    } else {
      serverProc.kill();
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
};

{
  let up = false;
  for (let i = 0; i < 45; i += 1) {
    try {
      const ping = await fetch(`${BASE}/api/settings`);
      if (ping.ok) {
        up = true;
        break;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) {
    console.error(`couldn't start the local test server on :${PORT}`);
    stopServer();
    process.exit(1);
  }
  console.log(`local runtime up on :${PORT} (gate off, data ${tmpDir})`);
}

const shim = await fetch(`${BASE}/looper-wallet.js`);
check('shim served', shim.ok && (await shim.text()).includes('looper-wallet-request'));

const chainId = (await (
  await fetch(`${BASE}/api/web3/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chain: 'base', method: 'eth_chainId', params: [] }),
  })
).json()) as { result?: string };
check('read proxy eth_chainId', chainId.result === '0x2105', String(chainId.result));

const block = (await (
  await fetch(`${BASE}/api/web3/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'eth_blockNumber' }),
  })
).json()) as { result?: string };
check('read proxy eth_blockNumber (default chain)', /^0x[0-9a-f]+$/.test(String(block.result)), String(block.result));

const denied = await fetch(`${BASE}/api/web3/rpc`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ method: 'eth_sendTransaction', params: [] }),
});
check('read proxy refuses non-read methods', denied.status === 400);

const inspect = (await (
  await fetch(`${BASE}/api/web3/inspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chain: 'base', tx: { to: USDC, data: transferData, value: '0x0', from: OWNER } }),
  })
).json()) as {
  decoded: { signature: string; args: unknown[] } | null;
  simulation: { ok: boolean; result?: string };
  gasEstimate: string | null;
};
check('inspect decodes USDC.transfer', inspect.decoded?.signature === 'transfer(address,uint256)', JSON.stringify(inspect.decoded?.args));
check('inspect simulated OK + gas', inspect.simulation.ok === true && Boolean(inspect.gasEstimate), `gas=${inspect.gasEstimate}`);

const inspectRevert = (await (
  await fetch(`${BASE}/api/web3/inspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chain: 'base', tx: { to: USDC, data: transferHugeData, value: '0x0', from: OWNER } }),
  })
).json()) as { simulation: { ok: boolean } };
check('inspect detects over-balance revert', inspectRevert.simulation.ok === false);

// ---------------------------------------------------------------- 2. browser side

const scratchDir = path.join(buildsRoot(), `web_${TOKEN}`);
fs.mkdirSync(scratchDir, { recursive: true });
const scratchId = `${Date.now()}-wallet-bridge-test`;
const scratchFolder = path.join(scratchDir, scratchId);
fs.mkdirSync(scratchFolder, { recursive: true });
const scratchFile = path.join(scratchFolder, 'index.html');

fs.writeFileSync(
  scratchFile,
  `<!doctype html>
<html><head><title>wallet bridge test</title></head>
<body style="background:#0a0d13;color:#d7dde8;font-family:monospace;padding:16px">
<h3>wallet bridge test</h3>
<pre id="out">booting…</pre>
<script>
  var out = document.getElementById('out');
  window.__log = [];
  function log(s) { window.__log.push(String(s)); out.textContent = window.__log.join('\\n'); }
  (async function () {
    try { log('chainId=' + (await ethereum.request({ method: 'eth_chainId' }))); } catch (e) { log('chainId ERR ' + e.message); }
    try { log('bal=' + String(await ethereum.request({ method: 'eth_getBalance', params: ['${OWNER}', 'latest'] })).slice(0, 8)); } catch (e) { log('bal ERR ' + e.message); }
    setTimeout(async function () {
      try { var accts = await ethereum.request({ method: 'eth_requestAccounts' }); log('acct=' + accts[0]); }
      catch (e) { log('acct ERR ' + (e.code || '') + ' ' + e.message); }
    }, 2000);
    setTimeout(async function () {
      try { log('send1 OK ' + await ethereum.request({ method: 'eth_sendTransaction', params: [{ to: '${USDC}', data: '${transferData}', value: '0x0' }] })); }
      catch (e) { log('send1 ERR ' + (e.code || '') + ' ' + e.message); }
    }, 4500);
    setTimeout(async function () {
      try { log('send2 OK ' + await ethereum.request({ method: 'eth_sendTransaction', params: [{ to: '${USDC}', data: '${transferData}', value: '0x0' }] })); }
      catch (e) { log('send2 ERR ' + (e.code || '') + ' ' + e.message); }
    }, 10000);
  })();
</script>
</body></html>`,
);

/**
 * The preview iframe is a served navigation now (multi-file builds resolve
 * relative refs against the artifact URL), so find it by its title attribute —
 * NOT by srcdoc. The handle is re-resolved on every call: a refresh navigates
 * the frame and replaces its execution context, which would otherwise leave us
 * polling a dead context forever.
 */
async function findBuildFrame(page: Page, title: string): Promise<Frame | null> {
  for (const handle of await page.$$('iframe.artifact-frame')) {
    const attr = await handle.getAttribute('title');
    if (attr !== title) continue;
    const frame = await handle.contentFrame();
    if (frame) return frame;
  }
  return null;
}

async function getBuildLogs(page: Page, title: string): Promise<string[]> {
  const frame = await findBuildFrame(page, title);
  if (!frame) return [];
  try {
    return JSON.parse(await frame.evaluate('JSON.stringify(window.__log ?? [])')) as string[];
  } catch {
    return []; // context replaced mid-navigation
  }
}

async function waitBuildLog(page: Page, title: string, prefix: string, ms: number): Promise<string[]> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const logs = await getBuildLogs(page, title);
    if (logs.some((l) => l.startsWith(prefix))) return logs;
    await page.waitForTimeout(300);
  }
  throw new Error(`"${prefix}…" never appeared in the build log within ${ms}ms`);
}

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Auto-activate the fixture token on boot (the gate is off on the test server).
  await page.addInitScript(`localStorage.setItem('looper-harness.token', '${TOKEN}');`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // Stub the operator's wallet in the CONSOLE page so the approve path can run
  // end-to-end up to the wallet boundary. String form: esbuild's __name helper
  // doesn't exist in the browser, so serialized functions are avoided.
  await page.evaluate(`
    window.ethereum = {
      request: async (args) => {
        if (args.method === 'eth_chainId') return '0x2105';
        if (args.method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
        if (args.method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
        if (args.method === 'eth_sendTransaction') { window.__hostTx = args.params && args.params[0]; return '0x${'ab'.repeat(32)}'; }
        throw new Error('stub wallet: unstubbed ' + args.method);
      },
    };
  `);

  await page.getByRole('button', { name: 'builds', exact: true }).click();

  const afterReads = (await waitBuildLog(page, 'wallet bridge test', 'bal=', 45_000)).join('\n');
  check('build read via shim proxy: eth_chainId', afterReads.includes('chainId=0x2105'), afterReads.split('\n')[0]);
  check('build read via shim proxy: eth_getBalance', /bal=0x[0-9a-f]/i.test(afterReads));

  // Connect flow (auto-runs at t+2s): host panel → approve → build gets the account.
  await page.waitForSelector('#wallet-panel:not(.hidden)', { timeout: 25_000 });
  await page.click('#wallet-panel-approve');
  const afterConnect = (await waitBuildLog(page, 'wallet bridge test', 'acct=', 20_000)).join('\n');
  check('connect flows through the host panel', afterConnect.includes(`acct=${OWNER}`), afterConnect.split('\n').find((l) => l.startsWith('acct=')) ?? '');

  // Send #1 (t+4.5s) → host panel with decoded + simulated content → reject.
  await page.waitForSelector('#wallet-panel:not(.hidden)', { timeout: 25_000 });
  const panelText = (await page.locator('#wallet-panel').innerText()).replace(/\s+/g, ' ');
  check('panel shows decoded function', panelText.includes('transfer(address,uint256)'), panelText.slice(0, 140));
  check('panel shows passing simulation', panelText.includes('passed'), panelText.slice(0, 220));
  check('panel shows build name', panelText.includes('wallet bridge test'));
  await page.click('#wallet-panel-reject');
  const afterReject = (await waitBuildLog(page, 'wallet bridge test', 'send1 ERR', 20_000)).join('\n');
  check('reject propagates to the build (4001)', afterReject.includes('send1 ERR 4001'), afterReject.split('\n').find((l) => l.startsWith('send1')) ?? '');

  // Send #2 (t+10s) → approve with the stubbed host wallet → build receives the hash.
  await page.waitForSelector('#wallet-panel:not(.hidden)', { timeout: 25_000 });
  await page.click('#wallet-panel-approve');
  const afterApprove = (await waitBuildLog(page, 'wallet bridge test', 'send2 OK', 20_000)).join('\n');
  check('approve returns the tx hash to the build', afterApprove.includes(`send2 OK 0x${'ab'.repeat(32)}`), afterApprove.split('\n').find((l) => l.startsWith('send2')) ?? '');

  const hostTx = JSON.parse(await page.evaluate('JSON.stringify(window.__hostTx ?? null)')) as { to?: string; data?: string; from?: string } | null;
  check('host wallet received the raw tx (to + data)', hostTx?.to?.toLowerCase() === USDC.toLowerCase() && hostTx?.data === transferData);
  check('host wallet received the connected sender', hostTx?.from?.toLowerCase() === OWNER.toLowerCase(), String(hostTx?.from));
} finally {
  await browser?.close().catch(() => undefined);
  fs.rmSync(scratchFolder, { recursive: true, force: true });
  stopServer();
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall wallet-bridge checks passed');
process.exit(fails ? 1 : 0);
