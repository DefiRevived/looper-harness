/**
 * Preview self-heal: a REAL npm project whose dist/ was never built must not
 * dead-end the operator on an error. Opening its preview should finish the build
 * and reload into the site.
 *
 * Spawns its own runtime (temp data dir, own port) with a scratch project whose
 * "build" script just writes dist/index.html — no network, no install needed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tmp = path.resolve('tmp-autobuild-test');
const PORT = 4541;
const SESSION = 'web_999992';
const ID = '1790000000001-autobuild-probe';
const BUILD_DIR = path.join(tmp, 'artifacts', SESSION, ID);

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(BUILD_DIR, 'node_modules', 'three'), { recursive: true });
fs.writeFileSync(
  path.join(BUILD_DIR, 'package.json'),
  JSON.stringify(
    {
      name: 'autobuild-probe',
      private: true,
      type: 'module',
      scripts: { build: 'node build.js' },
      dependencies: { three: '^0.159.0' },
    },
    null,
    2,
  ),
);
fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), '<!doctype html><title>shell</title><p>not built yet</p>');
fs.writeFileSync(
  path.join(BUILD_DIR, 'build.js'),
  "import fs from 'node:fs';\nfs.mkdirSync('dist', { recursive: true });\nfs.writeFileSync('dist/index.html', '<!doctype html><title>AUTOBUILT</title><p>auto-built ok</p>');\nconsole.log('scratch build done');\n",
);
fs.writeFileSync(path.join(BUILD_DIR, 'node_modules', 'three', 'package.json'), '{"name":"three","version":"0.159.0"}');

const tsx = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');
const server = spawn(process.execPath, [tsx, 'src/server/index.ts'], {
  cwd: path.resolve('.'),
  env: {
    ...process.env,
    LOOPER_DATA_DIR: tmp,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    LOOPER_REQUIRE_OWNERSHIP: 'false',
    LOOPER_TOKEN_ID: '',
    DEEPSEEK_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d: Buffer) => (serverLog += d.toString()));
server.stderr.on('data', (d: Buffer) => (serverLog += d.toString()));

const url = `http://127.0.0.1:${PORT}/api/artifact/${SESSION}/${ID}/`;
const get = async (): Promise<{ status: number; type: string; body: string }> => {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
};
const until = async (label: string, fn: () => Promise<boolean>, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      // server not up yet
    }
    if (Date.now() > deadline) {
      console.log(`✗ timed out waiting for ${label}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
};

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = ''): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
};

try {
  const up = await until('server boot', async () => (await fetch(`http://127.0.0.1:${PORT}/`)).status === 200, 40_000);
  check('scratch runtime booted', up);
  if (!up) throw new Error(`server never came up:\n${serverLog.slice(-1200)}`);

  console.log('\n--- the state that used to be a dead end ---');
  const first = await get();
  check('unbuilt project serves a BUILD page, not an error', first.status === 200 && /Building this project/.test(first.body), `status=${first.status} type=${first.type}`);
  check('the page reloads itself (no manual step)', /http-equiv="refresh"/.test(first.body), (first.body.match(/content="\d+"/) ?? [''])[0]);
  check('the page names what it is doing', /dependencies:/.test(first.body) && /job|starting the build/.test(first.body));

  console.log('\n--- and it finishes the job ---');
  const built = await until('dist to be served', async () => /AUTOBUILT/.test((await get()).body), 30_000);
  check('preview ends up serving the BUILT site', built);
  const after = await get();
  check('built entry is real html from dist/', after.type.includes('text/html') && /auto-built ok/.test(after.body), `type=${after.type}`);
  check('the build actually wrote dist/index.html', fs.existsSync(path.join(BUILD_DIR, 'dist', 'index.html')));
} catch (err) {
  fail++;
  console.log(`✗ ${(err as Error).message}`);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 600));
  if (process.platform === 'win32' && server.pid) {
    spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  await new Promise((r) => setTimeout(r, 400));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
}
