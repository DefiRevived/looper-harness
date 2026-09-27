/**
 * Real-project toolchain E2E on a scratch session (cleaned up afterwards):
 *   scaffold (bad dep → rejected) → fix deps → project_install → project_build
 *   → dist serving → check_build project mode → verify_render → list → delete.
 * Requires the dev server on 127.0.0.1:4520 for the serve/render checks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall, type ToolContext } from '../src/core/tools.js';

const call = (ctx: ToolContext, name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

const TOKEN = 997766;
const SESSION = `web:${TOKEN}`;
const DIR = path.join('data', 'artifacts', `web_${TOKEN}`);
const BASE = 'http://127.0.0.1:4520';
let failures = 0;
const expect = (cond: boolean, label: string): void => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
};

const consoleCtx: ToolContext = { sessionKey: SESSION, surface: 'web', tokenId: TOKEN };

console.log('===== scaffold (package.json with an off-allowlist dep) =====');
fs.rmSync(DIR, { recursive: true, force: true });
const created = await call(consoleCtx, 'render_artifact', {
  title: 'project smoke',
  kind: 'html',
  content:
    '<!doctype html><html><head><meta charset="utf-8"><title>project smoke</title></head><body><h1 id="h">.</h1><script type="module" src="/src/main.js"></script></body></html>',
  files: [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: 'project-smoke',
          private: true,
          type: 'module',
          scripts: { build: 'vite build' },
          devDependencies: { vite: '^5' },
          dependencies: { 'left-pad': '^1' },
        },
        null,
        2,
      ),
    },
    { path: 'src/main.js', content: "console.log('placeholder');" },
  ],
});
const buildId = created.artifact?.id ?? '';
console.log(created.modelText.split('\n')[0]);
const threadCtx: ToolContext = { sessionKey: `${SESSION}:build:${buildId}`, surface: 'web', tokenId: TOKEN, buildId };
expect(/^[0-9]+-project-smoke$/.test(buildId), `build id issued (${buildId})`);

console.log('\n===== project_install rejects off-allowlist deps =====');
const badInstall = await call(threadCtx, 'project_install', {});
console.log(badInstall.modelText.split('\n')[0]);
expect(badInstall.modelText.includes('not in the project allowlist'), 'left-pad rejected');

console.log('\n===== fix deps → write guards → project_install =====');
const nodeModGuard = await call(threadCtx, 'write_build_file', { file: 'node_modules/evil.js', content: 'x' });
expect(nodeModGuard.modelText.includes('rejected'), 'node_modules writes blocked');
await call(threadCtx, 'write_build_file', {
  file: 'package.json',
  content: JSON.stringify(
    {
      name: 'project-smoke',
      private: true,
      type: 'module',
      scripts: { build: 'vite build' },
      devDependencies: { vite: '^5' },
      dependencies: { gsap: '^3' },
    },
    null,
    2,
  ),
});
await call(threadCtx, 'write_build_file', {
  file: 'src/main.js',
  content:
    "import gsap from 'gsap';\nimport './style.css';\nconst h = document.getElementById('h');\nh.textContent = 'PROJ SMOKE ' + gsap.version;\nconsole.log('proj-ok ' + gsap.version);\n",
});
await call(threadCtx, 'write_build_file', {
  file: 'src/style.css',
  content: 'body { background: #101418; color: #d7dde8; font-family: monospace; padding: 24px; } h1 { color: #ffb648; }\n',
});
console.log('(installing — npm install vite + gsap, may take a minute)');
const install = await call(threadCtx, 'project_install', {});
console.log(install.modelText.split('\n')[0]);
expect(install.modelText.startsWith('Installed'), 'install succeeded');
expect(fs.existsSync(path.join(DIR, buildId, 'node_modules')), 'node_modules created');

console.log('\n===== project_build =====');
const build = await call(threadCtx, 'project_build', {});
console.log(build.modelText);
expect(build.modelText.startsWith('Built dist/'), 'build succeeded');
const distHtml = path.join(DIR, buildId, 'dist', 'index.html');
expect(fs.existsSync(distHtml), 'dist/index.html exists');
const distSrc = fs.readFileSync(distHtml, 'utf8');
expect(distSrc.includes('./assets/') || distSrc.includes('assets/'), 'dist uses relative asset refs');
expect(distSrc.includes('PROJ SMOKE') === false, 'entry html is the vite-built one (no post-bundle text)');

console.log('\n===== check_build (project mode) =====');
const check = await call(threadCtx, 'check_build', { build_id: buildId });
console.log(check.modelText);
expect(check.modelText.includes('PROJECT OK ✓'), 'project verdict clean');

console.log('\n===== dist is what HTTP serves =====');
try {
  const entry = await fetch(`${BASE}/api/artifact/web_${TOKEN}/${buildId}/`);
  const html = await entry.text();
  const asset = /(?:src|href)="\.?\/*(assets\/[^"]+)"/.exec(html)?.[1];
  const assetRes = asset ? await fetch(`${BASE}/api/artifact/web_${TOKEN}/${buildId}/${asset}`) : null;
  expect(entry.status === 200 && html.includes('assets/'), 'entry serves built dist');
  expect(Boolean(assetRes?.ok), `hashed asset serves (${asset ?? 'not found'})`);
  const srcLeak = await fetch(`${BASE}/api/artifact/web_${TOKEN}/${buildId}/src/main.js`);
  expect(srcLeak.status === 404, 'source files are NOT served for project builds');
} catch (err) {
  expect(false, `serve check failed: ${(err as Error).message}`);
}

console.log('\n===== verify_render (headless, served dist) =====');
const render = await call(threadCtx, 'verify_render', { build_id: buildId });
const renderHead = render.modelText.split('\n').slice(0, 14).join('\n');
console.log(renderHead);
expect(render.modelText.includes('RENDERED CLEAN'), 'headless render clean');
expect(render.modelText.includes('proj-ok') === false, 'render report does not echo console text (expected)');

console.log('\n===== list_build_files shows toolchain state =====');
const list = await call(threadCtx, 'list_build_files', {});
expect(list.modelText.includes('dist/: built ✓'), 'dist reported built');
expect(list.modelText.includes('installed ✓'), 'node_modules reported installed');

console.log('\n===== delete (removes node_modules too) =====');
const del = await call(threadCtx, 'delete_build', { build_id: buildId });
console.log(del.modelText.split('\n')[0]);
expect(!fs.existsSync(path.join(DIR, buildId)), 'build folder removed');
fs.rmSync(DIR, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall project-toolchain checks passed');
process.exit(failures ? 1 : 0);
