/**
 * Seeds (or refreshes) the web3 dapp conventions in agent memory.
 * Single-write script (avoids concurrent-writer risk with the dev server).
 * Run: node_modules\.bin\tsx.cmd scripts\update-web3-rules.ts <tokenId>
 */
import { memoryRecall, memoryRemember } from '../src/core/memory.js';

const tokenId = Number(process.argv[2]);
if (!Number.isInteger(tokenId) || tokenId < 1) {
  console.error('usage: tsx scripts/update-web3-rules.ts <tokenId>');
  process.exit(1);
}

const NOTE = [
  'Web3 dapps (conventions):',
  '- vendored ethers v6 is available to builds at /libs/ethers.umd.min.js (global `ethers`).',
  '- supported chains: Base mainnet (8453) and Base Sepolia (84532).',
  '- builds never embed RPC URLs or fetch external endpoints: YOU read chain facts with fetch_contract_abi / read_contract / simulate_call / tx_status and bake the real values into the page; verify every address/function against the verified ABI first — never invent an ABI.',
  '- wallet code: write standard EIP-1193 code against window.ethereum with a graceful "no wallet" state — the preview iframe has no provider yet (console wallet bridge ships later); the same code will work when the build is self-hosted with a real wallet.',
].join('\n');

const out = await memoryRemember({ tokenId, kind: 'procedure', note: NOTE });
console.log(out);

const entries = await memoryRecall({ tokenId, about: 'web3 dapps ethers conventions', limit: 3 });
console.log('\nrecall check:');
for (const e of entries) console.log(`- [${e.scope}] ${e.content.slice(0, 130).replace(/\n/g, ' ')}…`);
process.exit(0);
