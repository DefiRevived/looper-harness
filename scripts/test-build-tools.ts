/**
 * Smoke test for the build tools: a listing pass on token 452 (may be empty on
 * a fresh install), then a full multi-file round-trip (scaffold → file ops →
 * check → versions → revert → delete) on a scratch session that is cleaned up
 * afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall, type ToolContext } from '../src/core/tools.js';

const call = (ctx: ToolContext, name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

const scratchToken = 998877;
const scratchSession = `web:${scratchToken}`;
const consoleCtx: ToolContext = { sessionKey: scratchSession, surface: 'web', tokenId: scratchToken };
const scratchDir = path.join('data', 'artifacts', `web_${scratchToken}`);
let failures = 0;
function expect(cond: boolean, label: string): void {
  console.log(`  ${cond ? '✓' : '✗ FAIL'} ${label}`);
  if (!cond) failures++;
}

/** 1×1 transparent PNG. */
const PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

console.log('===== list_builds (web:452) — sample listing (head) =====');
const list = await call({ sessionKey: 'web:452', surface: 'web', tokenId: 452 }, 'list_builds', {});
console.log(list.modelText.split('\n').slice(0, 5).join('\n'));

console.log('\n===== multi-file scaffold (scratch) =====');
fs.rmSync(scratchDir, { recursive: true, force: true });
const created = await call(consoleCtx, 'render_artifact', {
  title: 'scaffold smoke',
  kind: 'html',
  content:
    '<!DOCTYPE html><html><head><link rel="stylesheet" href="css/style.css"></head><body><h1>TIP</h1><script src="js/app.js"></script></body></html>',
  files: [
    { path: 'css/style.css', content: 'h1 { color: gold; }' },
    { path: 'js/app.js', content: 'document.querySelector("h1").dataset.ready = "1";' },
  ],
});
console.log(created.modelText.split('\n')[0]);
const buildId = created.artifact?.id ?? '';
const threadCtx: ToolContext = { sessionKey: `${scratchSession}:build:${buildId}`, surface: 'web', tokenId: scratchToken, buildId };
expect(/^[0-9]+-scaffold-smoke$/.test(buildId), `build id issued (${buildId})`);
expect(created.artifact?.files === 3, 'artifact reports 3 files');
expect(created.artifact?.url?.endsWith(`/${buildId}/`), 'artifact URL ends with a slash (relative refs resolve)');

console.log('\n===== write / read / list files =====');
const wrote = await call(threadCtx, 'write_build_file', { file: 'assets/pixel.png', content: PIXEL_PNG_B64, encoding: 'base64' });
console.log(wrote.modelText.split('\n')[0]);
expect(wrote.modelText.includes('assets/pixel.png'), 'binary file written');
const listFiles = await call(threadCtx, 'list_build_files', {});
console.log(listFiles.modelText);
expect(listFiles.modelText.includes('css/style.css') && listFiles.modelText.includes('assets/pixel.png'), 'list shows project files');
const readCss = await call(threadCtx, 'read_build', { build_id: buildId, file: 'css/style.css' });
expect(readCss.modelText.includes('color: gold'), 'read_build file= returns the css');

console.log('\n===== check_build: clean, broken, fixed =====');
const check1 = await call(threadCtx, 'check_build', { build_id: buildId });
console.log(check1.modelText);
expect(check1.modelText.includes('SELF-CONTAINED ✓'), 'clean project passes self-contained check');
const editBad = await call(threadCtx, 'edit_build', {
  file: 'css/style.css',
  edits: [{ old_text: 'color: gold;', new_text: 'color: gold; background: url(../img/missing.png);' }],
});
expect(editBad.modelText.includes('Applied'), 'targeted css edit applied');
const check2 = await call(threadCtx, 'check_build', { build_id: buildId });
expect(check2.modelText.includes('broken local reference'), 'broken local reference detected');
const editFix = await call(threadCtx, 'edit_build', {
  file: 'css/style.css',
  edits: [{ old_text: ' background: url(../img/missing.png);', new_text: '' }],
});
expect(editFix.modelText.includes('Applied'), 'css fixed');

console.log('\n===== versions: whole-folder snapshot + revert =====');
const jsEdit = await call(threadCtx, 'edit_build', {
  file: 'js/app.js',
  edits: [{ old_text: '= "1";', new_text: '= "2";' }],
});
expect(jsEdit.modelText.includes('Applied'), 'js edit applied');
const versions = await call(threadCtx, 'list_versions', { build_id: buildId });
console.log(versions.modelText);
const revert = await call(threadCtx, 'revert_build', { build_id: buildId, version: 1 });
console.log(revert.modelText);
expect(revert.modelText.includes('Reverted'), 'reverted');
const cssNow = fs.readFileSync(path.join(scratchDir, buildId, 'css', 'style.css'), 'utf8');
expect(cssNow.includes('color: gold') && !cssNow.includes('missing.png'), 'css state restored by the folder snapshot');
expect(fs.existsSync(path.join(scratchDir, buildId, 'assets', 'pixel.png')), 'binary file restored by the folder snapshot');
const jsNow = fs.readFileSync(path.join(scratchDir, buildId, 'js', 'app.js'), 'utf8');
expect(jsNow.includes('"1"'), 'js restored to pre-edit state');

console.log('\n===== delete file + entry guard =====');
const delFile = await call(threadCtx, 'delete_build_file', { file: 'assets/pixel.png' });
console.log(delFile.modelText.split('\n')[0]);
expect(!fs.existsSync(path.join(scratchDir, buildId, 'assets')), 'file deleted and its empty dir pruned');
const delEntry = await call(threadCtx, 'delete_build_file', { file: 'index.html' });
expect(delEntry.modelText.includes('refused'), 'entry deletion refused');

console.log('\n===== delete build =====');
const del = await call(threadCtx, 'delete_build', { build_id: buildId });
console.log(del.modelText);
expect(!fs.existsSync(path.join(scratchDir, buildId)), 'build folder removed');
fs.rmSync(scratchDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall build-tool checks passed');
process.exit(failures ? 1 : 0);

