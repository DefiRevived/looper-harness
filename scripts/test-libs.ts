/**
 * Vendored-library smoke test:
 *   1. manifest + vendored files on disk
 *   2. list_libs tool output
 *   3. check_build — /libs refs allowed, CDN refs still flagged
 *   4. live /libs route (best-effort; needs the dev server up)
 * Run: node_modules\.bin\tsx.cmd scripts\test-libs.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall } from '../src/core/tools.js';
import { libManifest } from '../src/core/libs.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1) manifest + files
const libs = libManifest();
check('manifest lists the vendored set (9)', libs.length === 9, String(libs.length));
for (const l of libs) {
  const p = path.resolve('libs', l.file);
  const ok = fs.existsSync(p) && fs.statSync(p).size === l.bytes && l.bytes > 1024;
  check(`vendored ${l.name} @${l.version} (${(l.bytes / 1024).toFixed(0)}KB)`, ok, l.file);
}

// 2) list_libs tool
const ctx = { sessionKey: 'web:999997', surface: 'web' as const, tokenId: 452 };
const libsResult = await executeToolCall({ id: 't1', type: 'function', function: { name: 'list_libs', arguments: '{}' } }, ctx);
check('list_libs mentions three', libsResult.modelText.includes('three @0.159.0'));
check('list_libs gives the exact script path', libsResult.modelText.includes('/libs/three.min.js'));
check('list_libs states the rule (only scripts + CDN ban)', /ONLY scripts/i.test(libsResult.modelText) && /CDN\/remote URLs/i.test(libsResult.modelText));

// 3) check_build — scratch build with a local lib + a CDN ref, then clean
const dir = path.resolve('data', 'artifacts', 'web_999997');
fs.mkdirSync(dir, { recursive: true });
const buildId = `${Date.now()}-lib-check`;
const folder = path.join(dir, buildId);
fs.mkdirSync(folder, { recursive: true });
const file = path.join(folder, 'index.html');
const checkCall = (name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

fs.writeFileSync(
  file,
  '<!doctype html><html><head><title>lib check</title></head><body><h1>x</h1><script src="/libs/gsap.min.js"></script><script src="https://cdn.jsdelivr.net/npm/nope.js"></script></body></html>',
);
const bad = await checkCall('check_build', { build_id: buildId });
check('check_build flags the CDN ref as NOT self-contained', bad.modelText.includes('NOT self-contained'));
check('check_build reports the local library as allowed', /libraries: \/libs\/gsap\.min\.js/.test(bad.modelText));

fs.writeFileSync(
  file,
  '<!doctype html><html><body><canvas></canvas><script src="/libs/three.min.js"></script><script>const s = new THREE.Scene();</script></body></html>',
);
const good = await checkCall('check_build', { build_id: buildId });
check(
  'clean local-lib build passes (local libraries included)',
  good.modelText.includes('SELF-CONTAINED') && !good.modelText.includes('NOT self-contained') && good.modelText.includes('(local libraries included)'),
);

fs.rmSync(folder, { recursive: true, force: true });
fs.rmSync(dir, { recursive: true, force: true });

// 4) live route (best-effort)
try {
  const res = await fetch('http://127.0.0.1:4520/libs/three.min.js', { method: 'HEAD' });
  check('live /libs route serves three.min.js', res.ok, `status ${res.status}`);
  check('live /libs route is CORS-open', res.headers.get('access-control-allow-origin') === '*');
} catch {
  console.log('warn live /libs check skipped — server not reachable');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exitCode = failures ? 1 : 0;
