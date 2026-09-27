/**
 * Platform-tools smoke test: telegram lane, version archive + revert,
 * task board, wallet/market reads, looper-art placeholders (unit + live
 * serve route), and the ReMEM smart layer (intake dedup + relevance recall).
 * Scratch-only (token 999999, web_999999 dir) — nothing real is touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall, toolSpecsForSurface, type ToolContext } from '../src/core/tools.js';
import { listVersions } from '../src/core/versions.js';
import { looperImageCount, resolveLooperImages } from '../src/core/looperAssets.js';
import { memoryRecall, memoryRemember, purgeTokenMemory, taskAdd, taskComplete, taskList } from '../src/core/memory.js';
import { buildsRoot, dataPath } from '../src/core/settings.js';

const TOKEN = 999999;
const call = (ctx: ToolContext, name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);
const webCtx: ToolContext = { sessionKey: 'web:999999', surface: 'web', tokenId: TOKEN };

console.log('===== telegram lane =====');
console.log('telegram:', toolSpecsForSurface('telegram').map((t) => t.function.name).join(', ') || '(none)', '(expect read_looper, recall, market_price)');
console.log('discord:', toolSpecsForSurface('discord').length, '(expect 0)');

await purgeTokenMemory(TOKEN);
const dir = path.join(buildsRoot(), 'web_999999');
fs.mkdirSync(dir, { recursive: true });
const vid = '1790000000004-version-test';
const vctx: ToolContext = { sessionKey: `web:999999:build:${vid}`, surface: 'web', tokenId: TOKEN, buildId: vid };
fs.mkdirSync(path.join(dir, vid), { recursive: true });
fs.writeFileSync(path.join(dir, vid, 'index.html'), '<!DOCTYPE html><html><body>v0</body></html>');

console.log('\n===== versions =====');
console.log((await call(vctx, 'update_build', { content: '<!DOCTYPE html><html><body>v1</body></html>' })).modelText);
console.log((await call(vctx, 'update_build', { content: '<!DOCTYPE html><html><body>v2</body></html>' })).modelText);
console.log('archived:', listVersions('web_999999', vid).length, '(expect 2)');
console.log((await call(vctx, 'list_versions', { build_id: vid })).modelText);
console.log('--- revert to v0 (version 2 = oldest archived) ---');
console.log((await call(vctx, 'revert_build', { build_id: vid, version: 2 })).modelText);
console.log('file now:', fs.readFileSync(path.join(dir, vid, 'index.html'), 'utf8').includes('v0') ? 'v0 ✓' : 'NOT v0 ✗');
console.log('--- freeze blocks revert ---');
console.log((await call(vctx, 'lock_build', { action: 'freeze' })).modelText);
console.log((await call(vctx, 'revert_build', { build_id: vid })).modelText);
await call(vctx, 'lock_build', { action: 'unfreeze' });
await call(vctx, 'delete_build', { build_id: vid });
console.log('versions purged on delete:', !fs.existsSync(path.join(dataPath('versions', 'web_999999'), vid)));

console.log('\n===== tasks =====');
const t1 = await taskAdd(TOKEN, 'verify the #420 dossier build');
const t2 = await taskAdd(TOKEN, 'enable telegram privacy mode');
await taskComplete(TOKEN, t2.id);
console.log('open:', (await taskList(TOKEN)).map((t) => `${t.id} ${t.title}`).join(' | '));
console.log('with done:', (await taskList(TOKEN, true)).map((t) => `[${t.status}] ${t.id} ${t.title}`).join(' | '));
console.log((await call(webCtx, 'task_list', {})).modelText);
console.log('(t1 id kept for reference:', t1.id, ')');

console.log('\n===== wallet + market (live reads) =====');
const ownerCtx: ToolContext = { sessionKey: 'web:999999', surface: 'web', tokenId: 452 };
console.log((await call(ownerCtx, 'read_wallet', {})).modelText);
console.log((await call(webCtx, 'market_price', { token_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' })).modelText);

console.log('\n===== looper art =====');
console.log('placeholder count:', looperImageCount('a {{looper-image:452}} b {{looper-image:452}}'), '(expect 2)');
const resolved = await resolveLooperImages('before {{looper-image:452}} after');
console.log('resolved len:', resolved.length, '| contains data:image:', resolved.includes('data:image/'));

console.log('\n===== served substitution (live route) =====');
const sid = '1790000000005-art-check';
fs.mkdirSync(path.join(dir, sid), { recursive: true });
fs.writeFileSync(path.join(dir, sid, 'index.html'), '<!DOCTYPE html><html><body><img src="{{looper-image:452}}"></body></html>');
let served = '';
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    const res = await fetch(`http://127.0.0.1:4520/api/artifact/web_999999/${sid}`);
    served = await res.text();
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log('served contains data:image:', served.includes('data:image/'), '| placeholder left over:', served.includes('{{looper-image'));
fs.rmSync(path.join(dir, sid), { recursive: true, force: true });

console.log('\n===== smart memory (intake + relevance) =====');
console.log(await memoryRemember({ tokenId: TOKEN, note: 'Operator rule: builds stay self-contained — no CDN, no external fetches.' }));
console.log('dup attempt:', await memoryRemember({ tokenId: TOKEN, note: 'Operator rule: builds stay self-contained — no CDN, no external fetches.' }));
console.log('relevance recall:', (await memoryRecall({ tokenId: TOKEN, about: 'external fetches cdn' })).map((e) => e.content.slice(0, 60)));

await purgeTokenMemory(TOKEN);
fs.rmSync(dir, { recursive: true, force: true });
console.log('\n(scratch cleaned)');
