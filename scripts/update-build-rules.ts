/**
 * Seeds (or refreshes) the operator's build rule in agent memory: builds stay
 * self-contained, and a library is only allowed from the vendored local set
 * under /libs/. Idempotent — safe to run on a fresh install.
 *   node_modules\.bin\tsx.cmd scripts\update-build-rules.ts <tokenId>
 */
import { forgetEntry, listMemoryEntries, memoryRecall, memoryRemember } from '../src/core/memory.js';

const tokenId = Number(process.argv[2]);
if (!Number.isInteger(tokenId) || tokenId < 1) {
  console.error('usage: tsx scripts/update-build-rules.ts <tokenId>');
  process.exit(1);
}

const NEW_RULE =
  'Operator rule (all future work): builds stay self-contained — inline style/script; when a library is needed use ONLY the vendored local set under /libs/ (list_libs has the inventory and exact usage). No CDN links, no other external scripts/assets, no fetch()/XHR/network calls.';

const entries = await listMemoryEntries(tokenId);
const old = entries.filter((e) => e.scope === 'agent' && /cdn|self-contained/i.test(e.content));
if (!old.length) {
  console.log('no old rule entries found — nothing to forget');
} else {
  for (const e of old) {
    const gone = await forgetEntry(e.id);
    console.log(`forgot ${gone ? 'ok' : 'MISS'} — ${e.content.slice(0, 90)}…`);
  }
}

console.log(await memoryRemember({ tokenId, note: NEW_RULE }));

const check = await memoryRecall({ tokenId, limit: 5 });
console.log('\nmemory now reads:');
for (const e of check) console.log(`- [${e.scope}] ${e.content.slice(0, 140)}${e.content.length > 140 ? '…' : ''}`);
