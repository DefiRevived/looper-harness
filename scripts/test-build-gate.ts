/**
 * The turn-close gate's engine: verifyBuilds() must build every project it is
 * given, record the outcome, and report the compiler's actual words — including
 * failures, which is the whole point (an agent that never builds cannot know it
 * broke something).
 */
import fs from 'node:fs';
import path from 'node:path';

const tmp = path.resolve('tmp-buildgate-test');
fs.rmSync(tmp, { recursive: true, force: true });
process.env.LOOPER_DATA_DIR = tmp; // must precede core imports
// The fail → fix → ok sequence triggers lesson distillation; keep tests (and the
// operator's credits) out of it.
process.env.LOOPER_NO_LESSONS = '1';

const { verifyBuilds } = await import('../src/core/projects.js');
const { lastBuildOutcome, failingBuilds, buildOutcomeLine } = await import('../src/core/buildState.js');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = ''): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
};

const project = path.join(tmp, 'artifacts', 'web_999993', '1790000000002-gate-probe');
fs.mkdirSync(path.join(project, 'node_modules', 'three'), { recursive: true });
fs.writeFileSync(
  path.join(project, 'package.json'),
  JSON.stringify({ name: 'gate-probe', private: true, type: 'module', scripts: { build: 'node build.js' }, dependencies: { three: '^0.159.0' } }, null, 2),
);
fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html><title>gate</title>');
const buildScript = (body: string): void => fs.writeFileSync(path.join(project, 'build.js'), body);
buildScript(
  "import fs from 'node:fs';\nfs.mkdirSync('dist', { recursive: true });\nfs.writeFileSync('dist/index.html', '<!doctype html><title>OK</title>');\nconsole.log('wrote dist');\n",
);

// A classic build (no package.json) must be skipped, not built.
const classic = path.join(tmp, 'artifacts', 'web_999993', '1790000000003-classic-probe');
fs.mkdirSync(classic, { recursive: true });
fs.writeFileSync(path.join(classic, 'index.html'), '<p>classic</p>');

console.log('--- a project that builds ---');
const good = await verifyBuilds([project], 'gate');
check('reports ok', good.ok === true, `ok=${good.ok} verified=${good.verified}`);
check('actually built dist/', fs.existsSync(path.join(project, 'dist', 'index.html')));
check('report says so', /built ok/.test(good.report), good.report.split('\n')[0]);
const rec1 = lastBuildOutcome(project);
check('outcome recorded as success', rec1?.ok === true && rec1?.via === 'gate', `via=${rec1?.via}`);

console.log('\n--- a project that does NOT build ---');
buildScript("console.error('boom: missing thing on line 1');\nprocess.exit(1);\n");
fs.rmSync(path.join(project, 'dist'), { recursive: true, force: true });
const bad = await verifyBuilds([project], 'gate');
check('reports failure', bad.ok === false);
check('report carries the error, not a shrug', /BUILD FAILED/.test(bad.report) && /boom|exit/i.test(bad.report), bad.report.split('\n').slice(0, 2).join(' | ').slice(0, 150));
const rec2 = lastBuildOutcome(project);
check('outcome recorded as FAILURE', rec2?.ok === false, `detail=${(rec2?.detail ?? '').split('\n')[0].slice(0, 80)}`);

console.log('\n--- classic builds are not touched ---');
const skipped = await verifyBuilds([classic], 'gate');
check('classic build skipped (nothing to build)', skipped.verified === 0 && skipped.ok === true);

console.log('\n--- what the agent is told on its next turn ---');
const failing = failingBuilds('web_999993');
check('the failed build is listed for the console session', failing.some((f) => f.buildId.includes('gate-probe')), failing[0]?.line.slice(0, 90) ?? '(none)');
check('and it says FAILED with the error', /FAILED/.test(failing[0]?.line ?? ''));
const line = buildOutcomeLine(project, 'this build');
check('a build thread gets the same warning', /LAST BUILD FAILED/.test(line ?? ''), (line ?? '').slice(0, 100));

console.log('\n--- a fixed project builds again ---');
buildScript("import fs from 'node:fs';\nfs.mkdirSync('dist', { recursive: true });\nfs.writeFileSync('dist/index.html', '<!doctype html><title>FIXED</title>');\n");
const fixed = await verifyBuilds([project], 'gate');
check('recovery is recorded', fixed.ok === true && lastBuildOutcome(project)?.ok === true);
check('dist is back', /FIXED/.test(fs.readFileSync(path.join(project, 'dist', 'index.html'), 'utf8')));
check('a fixed build clears the console warning', !failingBuilds('web_999993').some((f) => f.buildId.includes('gate-probe')));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
