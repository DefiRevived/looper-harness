/**
 * Smoke test: ReMEM-backed memory (scopes) + lock enforcement on
 * update_build/edit_build + purge on delete. Uses a scratch session dir and
 * an isolated token id so nothing real is touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall, type ToolContext } from '../src/core/tools.js';
import { locksFor, memoryRecall, memoryRemember, purgeTokenMemory } from '../src/core/memory.js';
import { buildsRoot } from '../src/core/settings.js';

const TOKEN = 999999;
const call = (ctx: ToolContext, name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

const cleaned = await purgeTokenMemory(TOKEN);
console.log(`(purged ${cleaned} leftover test entr${cleaned === 1 ? 'y' : 'ies'} for determinism)`);

const buildId = '1790000000001-lock-test';
const agentCtx: ToolContext = { sessionKey: 'web:999999', surface: 'web', tokenId: TOKEN };
const threadCtx: ToolContext = { sessionKey: `web:999999:build:${buildId}`, surface: 'web', tokenId: TOKEN, buildId };

console.log('===== memory scopes =====');
await memoryRemember({ tokenId: TOKEN, note: 'operator rule: never use CDNs' });
await memoryRemember({ tokenId: TOKEN, note: 'this build locks its header copy', buildId });
const inThread = await memoryRecall({ tokenId: TOKEN, buildId });
const inConsole = await memoryRecall({ tokenId: TOKEN });
console.log(`thread recall: ${inThread.length} entries (expect 2 — build note + operator rule)`);
console.log(`console recall: ${inConsole.length} entries (expect 1 — operator rule only)`);
console.log('console content:', inConsole[0]?.content);

const otherToken = await memoryRecall({ tokenId: 452, limit: 5 });
console.log(`cross-token isolation: ${otherToken.length} entries under token 452 (informational — nothing should leak between tokens)`);

const dir = path.join(buildsRoot(), 'web_999999');
const folder = path.join(dir, buildId);
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'index.html'), '<!DOCTYPE html><html><head><title>LOCK TEST</title></head><body>header copy v1</body></html>');

console.log('\n===== freeze =====');
console.log((await call(threadCtx, 'lock_build', { action: 'freeze' })).modelText);
console.log((await call(threadCtx, 'update_build', { content: '<html>changed</html>' })).modelText);
console.log((await call(threadCtx, 'edit_build', { edits: [{ old_text: 'header copy v1', new_text: 'header copy v2' }] })).modelText);
console.log((await call(threadCtx, 'lock_build', { action: 'unfreeze' })).modelText);

console.log('\n===== snippet lock =====');
console.log((await call(threadCtx, 'lock_build', { action: 'lock_snippet', snippet: 'header copy v1' })).modelText);
console.log((await call(threadCtx, 'edit_build', { edits: [{ old_text: 'header copy v1', new_text: 'header copy v2' }] })).modelText);
console.log((await call(threadCtx, 'edit_build', { edits: [{ old_text: '<title>LOCK TEST</title>', new_text: '<title>LOCKED OK</title>' }] })).modelText);
console.log((await call(threadCtx, 'update_build', { content: '<html>no header anymore</html>' })).modelText);
console.log('file now starts:', fs.readFileSync(path.join(folder, 'index.html'), 'utf8').slice(0, 80));
console.log('--- lock list ---');
console.log((await call(threadCtx, 'lock_build', { action: 'list' })).modelText);

console.log('\n===== delete + purge =====');
console.log((await call(threadCtx, 'delete_build', { build_id: buildId })).modelText);
console.log('locks after delete:', (await locksFor(TOKEN, buildId)).length);
fs.rmSync(dir, { recursive: true, force: true });
console.log('(scratch cleaned)');
console.log('\nNote: token 999999 keeps one test rule entry in ReMEM (never queried by the real agent).');
