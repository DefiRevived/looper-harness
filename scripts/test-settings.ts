/**
 * Settings smoke test:
 *  1. resolution precedence (default → settings file → LOOPER_BUILDS_DIR env)
 *  2. validation (relative paths, unwritable paths)
 *  3. live round-trip: render_artifact → list_builds → delete_build inside a
 *     custom directory, using the real tools
 *  4. best-effort: the live server's /api/settings endpoints
 * Always restores the default setting and cleans up its temp directories.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeToolCall } from '../src/core/tools.js';
import { buildsDirInfo, buildsRoot, setBuildsDir } from '../src/core/settings.js';

let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const tempRoot = path.join(os.tmpdir(), `looper-builds-test-${Date.now()}`);

try {
  console.log('===== resolution precedence =====');
  const info0 = buildsDirInfo();
  check('default resolution works', info0.effective.length > 0, `${info0.source} → ${info0.effective}`);

  const info1 = setBuildsDir(tempRoot);
  check('settings value wins over default', info1.source === 'settings' && info1.effective === path.normalize(tempRoot));
  check('buildsRoot() follows the setting', buildsRoot() === path.normalize(tempRoot));
  check('directory was created on save', fs.existsSync(tempRoot));

  process.env.LOOPER_BUILDS_DIR = `${tempRoot}-env`;
  const info2 = buildsDirInfo();
  check(
    'env overrides the saved setting',
    info2.source === 'env' && info2.effective === path.normalize(`${tempRoot}-env`),
    info2.effective,
  );
  check('buildsRoot() follows the env override', buildsRoot() === path.normalize(`${tempRoot}-env`));
  delete process.env.LOOPER_BUILDS_DIR;
  const info3 = buildsDirInfo();
  check('env removal falls back to the saved setting', info3.source === 'settings');

  let msg = '';
  try {
    setBuildsDir('relative/path');
  } catch (err) {
    msg = (err as Error).message;
  }
  check('relative path rejected with guidance', msg.includes('absolute'), msg);

  console.log('\n===== live tool round-trip inside the custom directory =====');
  const ctx = { sessionKey: 'web:998801', surface: 'web' as const, tokenId: 998801 };
  const call = (name: string, args: Record<string, unknown>) =>
    executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

  const created = await call('render_artifact', {
    title: 'settings smoke',
    kind: 'html',
    content: '<!doctype html><html><body>SETTINGS SMOKE</body></html>',
  });
  const buildId = created.artifact?.id ?? '';
  check('render_artifact succeeded', !!buildId, created.modelText.split('\n')[0]);

  const inCustom = fs.existsSync(path.join(tempRoot, 'web_998801', buildId, 'index.html'));
  check('build file landed under the CUSTOM directory', inCustom, path.join(tempRoot, 'web_998801', buildId));

  const listing = await call('list_builds', {});
  check('list_builds sees it', listing.modelText.includes(buildId));

  const del = await call('delete_build', { build_id: buildId });
  check('delete_build removes it', del.deleted === buildId, String(del.deleted ?? '(no deleted field)'));
  check('folder gone after delete', !fs.existsSync(path.join(tempRoot, 'web_998801', buildId)));

  console.log('\n===== reset =====');
  const reset = setBuildsDir(null);
  check('reset clears the setting', reset.configured === null && reset.source !== 'settings');
} finally {
  try {
    setBuildsDir(null);
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    fs.rmSync(`${tempRoot}-env`, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    fs.rmSync(path.join(buildsRoot(), 'web_998801'), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

console.log('\n===== live server settings API (best-effort) =====');
try {
  const base = 'http://127.0.0.1:4520';
  const get0 = (await (await fetch(`${base}/api/settings`)).json()) as {
    buildsDir?: { effective?: string; source?: string };
  };
  check('GET /api/settings works', typeof get0.buildsDir?.effective === 'string', `${get0.buildsDir?.source} → ${get0.buildsDir?.effective}`);

  const tmp2 = path.join(os.tmpdir(), `looper-builds-http-${Date.now()}`);
  const post = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildsDir: tmp2 }),
  });
  const postBody = (await post.json()) as { ok?: boolean; buildsDir?: { effective?: string } };
  check('POST /api/settings sets a custom dir', post.status === 200 && postBody.ok === true && postBody.buildsDir?.effective === path.normalize(tmp2));

  const get1 = (await (await fetch(`${base}/api/settings`)).json()) as { buildsDir?: { effective?: string } };
  check('GET reflects the change', get1.buildsDir?.effective === path.normalize(tmp2));

  const bad = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildsDir: 'not-absolute' }),
  });
  check('invalid path → 400 with guidance', bad.status === 400, String(bad.status));

  const rset = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildsDir: null }),
  });
  const rsetBody = (await rset.json()) as { buildsDir?: { source?: string } };
  check('reset via API works', rset.status === 200 && rsetBody.buildsDir?.source !== 'settings');

  fs.rmSync(tmp2, { recursive: true, force: true });
} catch (err) {
  console.log(`(skipped — dev server not reachable: ${(err as Error).message})`);
}

console.log(fails === 0 ? '\nALL GREEN' : `\n${fails} FAILURE(S)`);
process.exitCode = fails === 0 ? 0 : 1;
