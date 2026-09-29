/**
 * Build-folder reveal smoke test (expects the dev server on :4520).
 *  - GET /api/build-folder resolves a real build's folder (path exists on disk)
 *  - bad ids → 404 (nothing to show/open)
 *  - POST /api/reveal-build with bad ids → 404/400 (and NEVER spawns)
 *  - POST with a valid build actually opens the OS file manager — opt-in only
 *    (REVEAL_SPAWN_TEST=1) so routine runs never pop file-manager windows.
 * Scratch build is created + cleaned up.
 * Run: cd D:\looper-harness; cmd /c node_modules\.bin\tsx.cmd scripts\test-reveal.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { sessionDirName } from '../src/core/tools.js';
import { buildsRoot } from '../src/core/settings.js';

const BASE = `http://127.0.0.1:${process.env.PORT ?? 4520}`;
const SESSION = 'web:999993';
const BUILD = '1790000000011-folder-probe';

let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const folder = path.join(buildsRoot(), sessionDirName(SESSION), BUILD);
fs.rmSync(folder, { recursive: true, force: true });
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><html><body>folder probe</body></html>');

try {
  const r1 = await fetch(`${BASE}/api/build-folder?sessionKey=${encodeURIComponent(SESSION)}&buildId=${BUILD}`);
  const j1 = (await r1.json()) as { path?: string; error?: string };
  check('GET resolves the build folder', r1.ok && j1.path === folder, JSON.stringify(j1));
  check('resolved path exists on disk', Boolean(j1.path) && fs.existsSync(j1.path as string));
  check('resolved path is under the builds root', Boolean(j1.path) && (j1.path as string).startsWith(buildsRoot()));

  const r2 = await fetch(`${BASE}/api/build-folder?sessionKey=${encodeURIComponent(SESSION)}&buildId=nope`);
  check('GET with a bad build id → 404', r2.status === 404);

  const r3 = await fetch(`${BASE}/api/reveal-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionKey: SESSION, buildId: 'nope' }),
  });
  check('reveal(bad build id) → 404 (no spawn)', r3.status === 404);

  const r4 = await fetch(`${BASE}/api/reveal-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  check('reveal(missing fields) → 400 (no spawn)', r4.status === 400);

  if (process.env.REVEAL_SPAWN_TEST === '1') {
    const r5 = await fetch(`${BASE}/api/reveal-build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionKey: SESSION, buildId: BUILD }),
    });
    const j5 = (await r5.json()) as { ok?: boolean; path?: string; error?: string };
    check('reveal(valid build) opens the file manager', r5.ok && j5.ok === true && j5.path === folder, JSON.stringify(j5));
  } else {
    console.log('~ spawn check skipped (set REVEAL_SPAWN_TEST=1 to actually open a file-manager window)');
  }
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
  try {
    if (fs.readdirSync(path.dirname(folder)).length === 0) fs.rmdirSync(path.dirname(folder));
  } catch {
    // other scratch data may share the session dir
  }
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall reveal checks passed');
// Let the event loop drain (undici keep-alive sockets + process.exit on
// Windows can trip a libuv assertion under tsx) — exit code still reflects.
process.exitCode = fails ? 1 : 0;
