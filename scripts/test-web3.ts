/**
 * Web3 Phase A smoke test — live reads against Base mainnet + Base Sepolia.
 * Proves: ABI resolution (Sourcify + disk cache), read_contract (real reads,
 * write-function rejection, fail-closed on unverified contracts), simulate_call
 * (dry-run success + revert detection), tx_status, Sepolia connectivity.
 * Run: node_modules\.bin\tsx.cmd scripts\test-web3.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall } from '../src/core/tools.js';
import { getLatestBlock } from '../src/core/web3.js';
import { config } from '../src/core/config.js';
import { dataPath } from '../src/core/settings.js';
import type { ToolCall } from '../src/core/llm.js';

const TOKEN = 452;
let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const call = (name: string, args: Record<string, unknown>): Promise<{ modelText: string }> =>
  executeToolCall(
    { id: 'test', type: 'function', function: { name, arguments: JSON.stringify(args) } } as ToolCall,
    { sessionKey: `web:${TOKEN}`, surface: 'web', tokenId: TOKEN },
  );

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const LOOPERS = '0x1649CD37f4748807b4882FC48765bA0B2aFfa94a';
const SAMPLE_ADDR = '0x1111111111111111111111111111111111111111';
const DEAD = '0x000000000000000000000000000000000000dEaD';

// --- 1. connectivity on both chains
const [baseBlock, sepBlock] = await Promise.all([getLatestBlock('base'), getLatestBlock('sepolia')]);
check('base RPC reachable', baseBlock > 0n, `block ${baseBlock}`);
check('sepolia RPC reachable', sepBlock > 0n, `block ${sepBlock}`);
check('sepolia behind base tip (sanity)', sepBlock < baseBlock, `${sepBlock} < ${baseBlock}`);

// --- 2. ABI resolution
const abiRes = await call('fetch_contract_abi', { chain: 'base', address: USDC });
console.log('\n--- fetch_contract_abi: USDC on base ---');
console.log(abiRes.modelText);
console.log('');
check('fetch_contract_abi resolves + lists reads', /balanceOf\(address\)/.test(abiRes.modelText) && /read/.test(abiRes.modelText));
const cacheFile = path.join(dataPath('cache', 'abi'), `8453-${USDC.toLowerCase()}.json`);
check('ABI cached to disk', fs.existsSync(cacheFile));

// --- 3. real reads
const symbol = await call('read_contract', { chain: 'base', address: USDC, function: 'symbol' });
check('read USDC symbol', /result: USDC/.test(symbol.modelText), symbol.modelText.split('\n')[1] ?? '');
const decimals = await call('read_contract', { chain: 'base', address: USDC, function: 'decimals' });
check('read USDC decimals = 6', /result: 6\b/.test(decimals.modelText), decimals.modelText.split('\n')[1] ?? '');
const owner = await call('read_contract', { chain: 'base', address: LOOPERS, function: 'ownerOf(uint256)', args: [452] });
check('ownerOf(452) returns a live owner address', /0x[0-9a-fA-F]{40}/.test(owner.modelText), owner.modelText.split('\n')[1] ?? '');

// --- 4. write-function rejection (fail closed)
const writeTry = await call('read_contract', { chain: 'base', address: USDC, function: 'transfer', args: [SAMPLE_ADDR, '1'] });
check('read_contract rejects a state-changing fn', /only executes view\/pure/.test(writeTry.modelText), writeTry.modelText.slice(0, 110));

// --- 5. unverified contract fails closed (no guessing)
const unverified = await call('read_contract', { chain: 'base', address: '0x1234567890aBcDeF1234567890aBcDeF12345678', function: 'name' });
check('unverified contract fails closed', /read_contract failed:/.test(unverified.modelText) && !/result:/.test(unverified.modelText), unverified.modelText.slice(0, 140));

// --- 6. simulation: success + revert detection
const sim = await call('simulate_call', { chain: 'base', to: USDC, function: 'transfer', args: [DEAD, '1'], from: SAMPLE_ADDR });
console.log('--- simulate_call: USDC.transfer(dead, 0.000001) from a sample address ---');
console.log(sim.modelText);
console.log('');
check('simulate succeeds + returns true + gas', /SIMULATE \(dry-run/.test(sim.modelText) && /result: true/.test(sim.modelText) && /gas estimate: \d+/.test(sim.modelText));
const simBad = await call('simulate_call', { chain: 'base', to: USDC, function: 'transfer', args: [DEAD, '999999999999999000'], from: SAMPLE_ADDR });
check('simulate detects a revert (over-balance)', /REVERTS/.test(simBad.modelText), simBad.modelText.slice(0, 150));

// --- 7. tx_status against a real historical tx (the settled Helixa mint payment)
const tx = await call('tx_status', { chain: 'base', hash: '0x073f5188dda18655120e61b6826aea52e2d4ec37dd1ec26290c7bd5e1b97ebc8' });
console.log('--- tx_status: settled Helixa mint payment ---');
console.log(tx.modelText);
console.log('');
check('tx_status resolves a real tx', /SUCCESS|REVERTED/.test(tx.modelText));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall web3 checks passed');
process.exit(fails ? 1 : 0);
