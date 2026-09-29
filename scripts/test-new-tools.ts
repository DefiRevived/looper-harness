/**
 * Smoke suite for the tool expansion: list_allowlist, run_module (sandbox:
 * stdout capture, fs scoping, subprocess denial, env scrub, timeout),
 * search_build, diff_build, snapshot_build (labels), build_status (receipt
 * ledger + staleness), job_status, list_versions labels, read_looper_traits
 * and contract_evidence (live reads, best-effort).
 *
 * Uses a scratch build under the builds root; cleans up after itself.
 * Run: cd D:\looper-harness; cmd /c node_modules\.bin\tsx.cmd scripts\test-new-tools.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall, sessionDirName } from '../src/core/tools.js';
import { buildsRoot, dataPath } from '../src/core/settings.js';
import { logActivity } from '../src/core/activity.js';
import { sandboxSupport } from '../src/core/runner.js';

const SCRATCH_SESSION = 'web:999991';
const SCRATCH_ID = '1790000000001-tools-probe';
const LOOPERS = '0x1649CD37f4748807b4882FC48765bA0B2aFfa94a';

const ctx = { sessionKey: SCRATCH_SESSION, surface: 'web' as const, tokenId: 7777 };

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await executeToolCall(
    { id: 't', type: 'function', function: { name, arguments: JSON.stringify(args) } } as never,
    ctx as never,
  );
  return res.modelText;
}

async function main(): Promise<void> {
  const root = buildsRoot();
  const sessionDir = path.join(root, sessionDirName(SCRATCH_SESSION));
  const folder = path.join(sessionDir, SCRATCH_ID);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'index.html'),
    '<!doctype html><html><body><h1>probe v1</h1><div id="marker">ALPHA_TOKEN</div></body></html>\n',
    'utf8',
  );

  console.log('== sandbox capability ==');
  const support = sandboxSupport();
  check('node permission model is enforceable here', support.enforced, JSON.stringify(support));

  console.log('== list_allowlist ==');
  const allow = await call('list_allowlist', {});
  check('lists npm packages (vite + three)', allow.includes('vite') && allow.includes('three'));
  check('mentions the vendored /libs set', allow.includes('/libs') && allow.includes('list_libs'));

  console.log('== run_module ==');
  fs.writeFileSync(
    path.join(folder, 'test-run.mjs'),
    'console.log("MODULE-RAN", 6 * 7);\nexport default async function (arg) { console.log("GOT-ARG", arg); }\n',
    'utf8',
  );
  const runOut = await call('run_module', { build_id: SCRATCH_ID, file: 'test-run.mjs', args: ['hello'] });
  check('captures stdout', runOut.includes('MODULE-RAN 42'), runOut.slice(0, 200));
  check('calls default export with args', runOut.includes('GOT-ARG hello'));
  check('exit code 0 + ok verdict', runOut.includes('exit code: 0') && runOut.includes('ok \u2713'));

  fs.writeFileSync(
    path.join(folder, 'test-js-esm.js'),
    'export const answer = 42;\nconsole.log("ESM-JS-RAN", answer);\n',
    'utf8',
  );
  const esmJs = await call('run_module', { build_id: SCRATCH_ID, file: 'test-js-esm.js' });
  check('ESM syntax inside .js auto-detected', esmJs.includes('ESM-JS-RAN 42'), esmJs.slice(0, 200));

  fs.writeFileSync(
    path.join(folder, 'test-escape.mjs'),
    [
      'import fs from "node:fs";',
      'import { execSync } from "node:child_process";',
      'try { fs.readFileSync("C:/Windows/win.ini"); console.log("ESCAPE-READ-ALLOWED"); }',
      'catch (e) { console.log("ESCAPE-BLOCKED", e.code || e.message); }',
      'try { execSync("echo hi"); console.log("SPAWN-ALLOWED"); }',
      'catch (e) { console.log("SPAWN-BLOCKED", e.code || e.message); }',
      'console.log("ENV-KEY", typeof process.env.DEEPSEEK_API_KEY);',
      '',
    ].join('\n'),
    'utf8',
  );
  const esc = await call('run_module', { build_id: SCRATCH_ID, file: 'test-escape.mjs' });
  if (support.enforced) {
    check('outside-folder read blocked (ERR_ACCESS_DENIED)', esc.includes('ESCAPE-BLOCKED') && esc.includes('ERR_ACCESS_DENIED'), esc.slice(0, 200));
    check('subprocess spawn blocked', esc.includes('SPAWN-BLOCKED') && esc.includes('ERR_ACCESS_DENIED'));
    check('env scrubbed (no deepseek key)', esc.includes('ENV-KEY undefined'));
  } else {
    console.log('  ~ sandbox not enforced on this node — denial checks skipped');
  }

  fs.writeFileSync(path.join(folder, 'test-hang.js'), 'console.log("HANGING");\nsetInterval(() => {}, 1000);\n', 'utf8');
  const hang = await call('run_module', { build_id: SCRATCH_ID, file: 'test-hang.js', timeout_s: 2 });
  check('timeout kills the run', hang.includes('TIMED OUT after 2s'), hang.slice(0, 200));

  console.log('== search_build ==');
  const s1 = await call('search_build', { build_id: SCRATCH_ID, query: 'ALPHA_TOKEN' });
  check('finds a literal match with file:line', s1.includes('index.html:1:') && s1.includes('ALPHA_TOKEN'), s1.slice(0, 200));
  const s2 = await call('search_build', { build_id: SCRATCH_ID, query: 'ALPHA_\\w+', regex: true });
  check('regex mode works', s2.includes('ALPHA_TOKEN'));

  console.log('== snapshot + diff + versions label ==');
  const snap = await call('snapshot_build', { build_id: SCRATCH_ID, label: 'probe v1 snapshot' });
  check('snapshot saved with label', snap.includes('probe v1 snapshot'));
  fs.writeFileSync(
    path.join(folder, 'index.html'),
    '<!doctype html><html><body><h1>probe v2</h1><div id="marker">BETA_TOKEN</div></body></html>\n',
    'utf8',
  );
  const diff = await call('diff_build', { build_id: SCRATCH_ID, from: '1' });
  check('diff shows the removed line', diff.includes('- ') && diff.includes('ALPHA_TOKEN'), diff.slice(0, 260));
  check('diff shows the added line', diff.includes('BETA_TOKEN') && diff.includes('index.html'));
  const lv = await call('list_versions', { build_id: SCRATCH_ID });
  check('label visible in list_versions', lv.includes('probe v1 snapshot'));

  console.log('== build_status (receipt ledger) ==');
  logActivity(SCRATCH_SESSION, 'verify_render', { ok: true, ref: SCRATCH_ID, ms: 4200 });
  logActivity(SCRATCH_SESSION, 'check_build', { ok: true, ref: SCRATCH_ID, ms: 80 });
  logActivity(SCRATCH_SESSION, 'run_module', { ok: true, ref: SCRATCH_ID, ms: 900 });
  const bs = await call('build_status', { build_id: SCRATCH_ID });
  check('ledger lists receipts', bs.includes('render: PASSED \u2713') && bs.includes('check: PASSED \u2713') && bs.includes('tests: PASSED \u2713'), bs.slice(0, 400));
  check('missing receipt flagged', bs.includes('install: never run'));
  // Touch the build → every receipt is now stale.
  fs.appendFileSync(path.join(folder, 'index.html'), '<!-- touched -->\n');
  const bs2 = await call('build_status', { build_id: SCRATCH_ID });
  check('staleness detected after a write', /older than the last write|STALE/i.test(bs2), bs2.slice(0, 400));

  console.log('== job_status ==');
  const js = await call('job_status', {});
  check('idle message with no jobs', js.includes('No toolchain jobs'), js.slice(0, 160));

  console.log('== live reads (best-effort) ==');
  const traits = await call('read_looper_traits', { token_id: 7777 });
  if (traits.includes('failed for #')) {
    console.log('  ~ read_looper_traits live check skipped (network)');
  } else {
    check('traits block is verbatim-structured', traits.includes('TRAITS \u2014 Looper #7777') && /attributes|selected visual traits/.test(traits));
  }
  const ce = await call('contract_evidence', { address: LOOPERS });
  if (ce.includes('failed:')) {
    console.log('  ~ contract_evidence live check skipped (network)');
  } else {
    check('evidence block + ownerOf check', ce.includes('CONTRACT EVIDENCE') && ce.includes('ownerOf(7777)'), ce.slice(0, 300));
  }

  // Cleanup: scratch build, its versions, its activity trail.
  fs.rmSync(folder, { recursive: true, force: true });
  try {
    if (fs.readdirSync(sessionDir).length === 0) fs.rmdirSync(sessionDir);
  } catch {
    // leave it if not empty (other scratch data)
  }
  fs.rmSync(path.join(dataPath('versions'), sessionDirName(SCRATCH_SESSION)), { recursive: true, force: true });
  fs.rmSync(path.join(dataPath('activity'), `${sessionDirName(SCRATCH_SESSION)}.jsonl`), { force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

void main();
