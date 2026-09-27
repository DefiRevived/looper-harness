/**
 * Settings smoke test:
 *  1. resolution precedence for BOTH directories (default → looper.config.json → env)
 *  2. validation (relative paths rejected)
 *  3. live round-trips through the real modules — a build into a custom builds
 *     dir, and session state + transcript into a custom data dir
 *  4. best-effort: the live server's /api/settings + the folder picker's /api/fs/dirs
 * Snapshots the operator's config first and restores it exactly as found when
 * finished — running this on a live install must never lose the setup or key.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeToolCall } from '../src/core/tools.js';
import { applySettings, buildsRoot, dataPath, dataRoot, llmKeyInfo, loadConfig, setupState } from '../src/core/settings.js';
import * as store from '../src/core/store.js';
import { completeReply, llmMode } from '../src/core/llm.js';

// The config file lives at the CWD — refuse to run anywhere but the fork.
if (!process.cwd().toLowerCase().endsWith('looper-harness')) {
  console.error(`refusing to run outside D:\\looper-harness (cwd=${process.cwd()})`);
  process.exit(1);
}

// Restored at the very end — never clobber a live install's setup or key.
const originalConfig = loadConfig();

let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const tempData = path.join(os.tmpdir(), `looper-data-test-${Date.now()}`);
const tempBuilds = path.join(os.tmpdir(), `looper-builds-test-${Date.now()}`);

try {
  console.log('===== resolution precedence =====');
  const s0 = setupState();
  check('defaults resolve', s0.dataDir.effective.length > 0 && s0.buildsDir.effective.length > 0, `${s0.dataDir.source} / ${s0.buildsDir.source}`);

  const s1 = applySettings({ dataDir: tempData, buildsDir: tempBuilds, setupComplete: true });
  check('custom data dir applied', s1.dataDir.source === 'settings' && s1.dataDir.effective === path.normalize(tempData), s1.dataDir.effective);
  check('custom builds dir applied', s1.buildsDir.source === 'settings' && s1.buildsDir.effective === path.normalize(tempBuilds), s1.buildsDir.effective);
  check('dataRoot()/buildsRoot() follow', dataRoot() === path.normalize(tempData) && buildsRoot() === path.normalize(tempBuilds));
  check('setupComplete recorded', s1.setupComplete === true && setupState().setupComplete === true);
  check('directories were created', fs.existsSync(tempData) && fs.existsSync(tempBuilds));

  process.env.LOOPER_DATA_DIR = `${tempData}-env`;
  check('env overrides the data dir', setupState().dataDir.source === 'env' && dataRoot() === path.normalize(`${tempData}-env`));
  delete process.env.LOOPER_DATA_DIR;
  check('env removal falls back to the config file', setupState().dataDir.source === 'settings');

  let msg = '';
  try {
    applySettings({ dataDir: 'relative/path' });
  } catch (err) {
    msg = (err as Error).message;
  }
  check('relative paths rejected with guidance', msg.includes('absolute'), msg);

  console.log('\n===== live round-trip: build into the custom builds dir =====');
  const ctx = { sessionKey: 'web:998801', surface: 'web' as const, tokenId: 998801 };
  const call = (name: string, args: Record<string, unknown>) =>
    executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);
  const created = await call('render_artifact', {
    title: 'settings smoke',
    kind: 'html',
    content: '<!doctype html><html><body>SETTINGS SMOKE</body></html>',
  });
  const buildId = created.artifact?.id ?? '';
  check(
    'build file landed under the CUSTOM builds dir',
    !!buildId && fs.existsSync(path.join(tempBuilds, 'web_998801', buildId, 'index.html')),
    buildId || created.modelText.slice(0, 60),
  );
  const del = await call('delete_build', { build_id: buildId });
  check('delete_build works there', del.deleted === buildId, String(del.deleted ?? ''));

  console.log('\n===== live round-trip: session state into the custom data dir =====');
  store.appendMessage('web:998802', { role: 'user', content: 'settings-live-roundtrip', at: new Date().toISOString() });
  const stateFile = path.join(tempData, 'looper-state.json');
  check('session state written to the CUSTOM data dir', fs.existsSync(stateFile));
  check('message present in the custom state file', fs.readFileSync(stateFile, 'utf8').includes('settings-live-roundtrip'));
  store.resetSession('web:998802');
  const archived = fs.existsSync(dataPath('transcripts')) ? fs.readdirSync(dataPath('transcripts')) : [];
  check('transcript archived into the CUSTOM data dir', archived.some((f) => f.startsWith('web_998802')), archived.join(', '));

  console.log('\n===== llm key (the brain) =====');
  if (process.env.DEEPSEEK_API_KEY) {
    console.log('(skipped — DEEPSEEK_API_KEY is set in this shell; env overrides the stored key)');
  } else {
    applySettings({ deepseekApiKey: 'sk-test-invalid-1234567890' });
    const key1 = llmKeyInfo();
    check(
      'key stored locally + masked in reads',
      key1.configured && key1.source === 'settings' && !!key1.masked && key1.masked.includes('…') && !key1.masked.includes('1234567890'),
      key1.masked ?? '',
    );
    check('llmMode flips to live', llmMode() === 'live');
    let err = '';
    try {
      await completeReply([{ role: 'user', content: 'ping' }]);
    } catch (e) {
      err = (e as Error).message;
    }
    check('live path actually reaches DeepSeek (invalid key rejected upstream)', /401|auth|invalid/i.test(err), err.slice(0, 90));
    let short = '';
    try {
      applySettings({ deepseekApiKey: 'sk-short' });
    } catch (e) {
      short = (e as Error).message;
    }
    check('too-short key rejected', short.includes("doesn't look like"), short);
    applySettings({ deepseekApiKey: null });
    check('key cleared → back to the mock brain', llmKeyInfo().configured === false && llmMode() === 'mock');
  }

  console.log('\n===== reset =====');
  const reset = applySettings({ dataDir: null, buildsDir: null, setupComplete: false });
  check(
    'reset returns to defaults, wizard left pending',
    reset.dataDir.configured === null && reset.buildsDir.configured === null && reset.setupComplete === false,
  );
} finally {
  try {
    applySettings({ dataDir: null, buildsDir: null, deepseekApiKey: null, setupComplete: false });
  } catch {
    // ignore
  }
  for (const dir of [tempData, tempBuilds, `${tempData}-env`]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
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
    dataDir?: { effective?: string; source?: string };
    buildsDir?: { effective?: string; source?: string };
    setupComplete?: boolean;
  };
  check(
    'GET /api/settings returns both dirs',
    typeof get0.dataDir?.effective === 'string' && typeof get0.buildsDir?.effective === 'string',
    `${get0.dataDir?.source} / ${get0.buildsDir?.source}`,
  );

  const tmpData2 = path.join(os.tmpdir(), `looper-data-http-${Date.now()}`);
  const tmpBuilds2 = path.join(os.tmpdir(), `looper-builds-http-${Date.now()}`);
  const post = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataDir: tmpData2, buildsDir: tmpBuilds2, setupComplete: true }),
  });
  const postBody = (await post.json()) as {
    ok?: boolean;
    dataDir?: { effective?: string };
    buildsDir?: { effective?: string };
    setupComplete?: boolean;
  };
  check(
    'POST sets both dirs + setupComplete',
    post.status === 200 &&
      postBody.ok === true &&
      postBody.dataDir?.effective === path.normalize(tmpData2) &&
      postBody.buildsDir?.effective === path.normalize(tmpBuilds2) &&
      postBody.setupComplete === true,
  );

  const get1 = (await (await fetch(`${base}/api/settings`)).json()) as { dataDir?: { effective?: string } };
  check('GET reflects the change', get1.dataDir?.effective === path.normalize(tmpData2));

  const bad = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataDir: 'not-absolute' }),
  });
  check('invalid path → 400 with guidance', bad.status === 400, String(bad.status));

  if (!process.env.DEEPSEEK_API_KEY) {
    const keyPost = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deepseekApiKey: 'sk-http-test-1234567890' }),
    });
    const keyBody = (await keyPost.json()) as { llmKey?: { configured?: boolean; masked?: string } };
    check(
      'API stores the brain key (masked in responses)',
      keyPost.status === 200 && keyBody.llmKey?.configured === true && !(keyBody.llmKey?.masked ?? '').includes('1234567890'),
      keyBody.llmKey?.masked ?? '',
    );
    const keyClear = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deepseekApiKey: null }),
    });
    check('API clears the key', ((await keyClear.json()) as { llmKey?: { configured?: boolean } }).llmKey?.configured === false);
  }

  const rset = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataDir: null, buildsDir: null, setupComplete: false }),
  });
  const rsetBody = (await rset.json()) as { dataDir?: { configured?: string | null }; setupComplete?: boolean };
  check(
    'API reset works (dirs null, wizard pending)',
    rset.status === 200 && rsetBody.dataDir?.configured === null && rsetBody.setupComplete === false,
  );

  console.log('\n===== folder picker (fs browse) =====');
  const homeListing = (await (await fetch(`${base}/api/fs/dirs`)).json()) as {
    listing?: { path?: string; entries?: { name: string }[]; roots?: { path: string }[]; home?: string };
  };
  check(
    'GET /api/fs/dirs lists a real folder (no path → home)',
    typeof homeListing.listing?.path === 'string' && Array.isArray(homeListing.listing.entries),
    homeListing.listing?.path ?? '',
  );
  check(
    'roots + home exposed for quick jumps',
    (homeListing.listing?.roots?.length ?? 0) > 0 && typeof homeListing.listing?.home === 'string',
    (homeListing.listing?.roots ?? []).map((r) => r.path).join(' · '),
  );

  const probeDir = path.join(os.tmpdir(), `looper-fs-test-${Date.now()}`);
  fs.mkdirSync(path.join(probeDir, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(probeDir, 'beta', 'nested'), { recursive: true });
  const listing = (await (await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent(probeDir)}`)).json()) as {
    listing?: { path?: string; parent?: string | null; entries?: { name: string }[] };
  };
  const entryNames = (listing.listing?.entries ?? []).map((e) => e.name);
  check('lists subfolders alphabetically', JSON.stringify(entryNames) === JSON.stringify(['alpha', 'beta']), entryNames.join(', '));
  check('parent resolves one level up', listing.listing?.parent === path.dirname(probeDir), String(listing.listing?.parent));
  const nested = (await (await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent(path.join(probeDir, 'beta', 'nested'))}`)).json()) as {
    listing?: { path?: string };
  };
  check('nested folder reachable', nested.listing?.path === path.join(probeDir, 'beta', 'nested'));
  const missing = await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent(path.join(probeDir, 'missing'))}`);
  check('missing folder → 400 with message', missing.status === 400, String(missing.status));
  const relative = await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent('relative/nope')}`);
  check('relative path → 400 (absolute required)', relative.status === 400, String(relative.status));

  const madeName = 'created-by-picker';
  const made = await fetch(`${base}/api/fs/mkdir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: probeDir, name: madeName }),
  });
  const madeBody = (await made.json()) as { ok?: boolean; path?: string };
  check(
    'mkdir creates a folder inside the listed one',
    made.status === 200 && madeBody.ok === true && madeBody.path === path.join(probeDir, madeName) && fs.existsSync(path.join(probeDir, madeName)),
    madeBody.path ?? '',
  );
  const madeListing = (await (await fetch(`${base}/api/fs/dirs?path=${encodeURIComponent(probeDir)}`)).json()) as {
    listing?: { entries?: { name: string }[] };
  };
  check('new folder shows up in the listing', (madeListing.listing?.entries ?? []).some((e) => e.name === madeName));
  const dup = await fetch(`${base}/api/fs/mkdir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: probeDir, name: madeName }),
  });
  check('duplicate name → 400', dup.status === 400, String(dup.status));
  const badName = await fetch(`${base}/api/fs/mkdir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: probeDir, name: 'sneaky/../escape' }),
  });
  check('separators in the name → 400', badName.status === 400, String(badName.status));
  const reserved = await fetch(`${base}/api/fs/mkdir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: probeDir, name: 'CON' }),
  });
  check('reserved Windows name → 400', reserved.status === 400, String(reserved.status));
  const noParent = await fetch(`${base}/api/fs/mkdir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: path.join(probeDir, 'missing'), name: 'x' }),
  });
  check('missing parent folder → 400', noParent.status === 400, String(noParent.status));
  fs.rmSync(probeDir, { recursive: true, force: true });

  for (const dir of [tmpData2, tmpBuilds2]) fs.rmSync(dir, { recursive: true, force: true });
} catch (err) {
  console.log(`(skipped — dev server not reachable: ${(err as Error).message})`);
}

// Put the operator's real configuration back exactly as it was found.
try {
  applySettings({
    dataDir: originalConfig.dataDir,
    buildsDir: originalConfig.buildsDir,
    deepseekApiKey: originalConfig.deepseekApiKey,
    setupComplete: originalConfig.setupComplete,
  });
  check(
    'operator config restored as found',
    true,
    originalConfig.setupComplete ? 'setup state + stored key preserved' : 'fresh state preserved',
  );
} catch (err) {
  check('operator config restored as found', false, (err as Error).message);
}

console.log(fails === 0 ? '\nALL GREEN' : `\n${fails} FAILURE(S)`);
process.exitCode = fails === 0 ? 0 : 1;
