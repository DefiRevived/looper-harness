/**
 * Fresh sessions: a chat with no memory must be mechanically memory-free —
 * no recollection tools, no episodes written, and a brief that actually differs
 * between two fresh chats (the whole point: two "surprise me" asks converged).
 */
import fs from 'node:fs';
import path from 'node:path';

const tmp = path.resolve('tmp-fresh-test');
fs.rmSync(tmp, { recursive: true, force: true });
process.env.LOOPER_DATA_DIR = tmp;

const { isFreshSession, newFreshSessionKey, freshBrief, freshDirective } = await import('../src/core/fresh.js');
const { toolSpecsForSurface } = await import('../src/core/tools.js');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = ''): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
};

console.log('--- session detection ---');
check('a normal console session is not fresh', !isFreshSession('web:2684'));
check('a fresh key is fresh', isFreshSession('web:2684:fresh:abc123'));
check('a build thread inside a fresh chat is fresh too', isFreshSession('web:2684:fresh:abc123:build:1790-x'));
const generated = newFreshSessionKey('web:2684');
check('new keys are namespaced under the parent', generated.startsWith('web:2684:fresh:') && isFreshSession(generated), generated);

console.log('\n--- the brief must differ between chats (that was the bug) ---');
const keys = Array.from({ length: 6 }, (_unused, i) => `web:2684:fresh:seed${i}`);
const briefs = keys.map((k) => freshBrief(k));
check('the same chat keeps the same brief', freshBrief(keys[0]) === briefs[0]);
check('six fresh chats → six different briefs', new Set(briefs).size === 6, `${new Set(briefs).size}/6 distinct`);
check('the brief names its axes', /genre:/.test(briefs[0]) && /visual mood/.test(briefs[0]) && /twist:/.test(briefs[0]));
const directive = freshDirective(keys[0]);
check('the directive says what it is', /FRESH SESSION — NO MEMORY/.test(directive));
check('it forbids reusing earlier work', /not reachable|Do not try to inspect/.test(directive));
check('it suspends the house palette', /usual house palette does NOT apply/.test(directive));
check('it carries the drawn brief', directive.includes(briefs[0]));

console.log('\n--- the tool surface enforces it ---');
const freshSpecs = toolSpecsForSurface('web', { fresh: true }).map((s) => s.function.name);
const normalSpecs = toolSpecsForSurface('web').map((s) => s.function.name);
for (const hidden of ['recall', 'lessons', 'list_builds', 'read_build', 'search_build', 'diff_build', 'build_status']) {
  check(`fresh hides ${hidden}`, !freshSpecs.includes(hidden), '');
}
check('the normal console still has them', normalSpecs.includes('recall') && normalSpecs.includes('list_builds'));
check(
  'fresh keeps the building tools',
  ['render_artifact', 'write_build_file', 'project_install', 'project_build', 'check_build', 'verify_render', 'remember'].every((t) => freshSpecs.includes(t)),
  `${freshSpecs.length} tools offered`,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
