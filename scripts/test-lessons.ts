/**
 * Lessons: same-shaped errors must map to one signature, a past fix must come
 * back for a new instance, duplicates must collapse, and nothing may be invented
 * or spent in tests.
 */
import fs from 'node:fs';
import path from 'node:path';

const tmp = path.resolve('tmp-lessons-test');
fs.rmSync(tmp, { recursive: true, force: true });
process.env.LOOPER_DATA_DIR = tmp; // must precede core imports
process.env.LOOPER_NO_LESSONS = '1'; // never call the model from a test

const { signatureOf, recordLesson, lessonsFor, lessonLines, recentLessons, forgetLesson, lessonsReport, distillLesson } =
  await import('../src/core/lessons.js');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = ''): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
};

console.log('--- signature: one bug, any specifics → one key ---');
const a = signatureOf('[css-syntax-error] Unexpected "4" [css-syntax-error]\n  <stdin>:159:13');
const b = signatureOf('[css-syntax-error] Unexpected "9" [css-syntax-error]\n  <stdin>:42:2');
check('two instances of the same bug share a signature', a === b, a);
const other = signatureOf('project_build failed (exit 1) — boom: missing thing on line 1');
check('a different failure gets a different signature', other !== a, other);

console.log('\n--- store + retrieve ---');
check('empty state says so', /No build lessons yet/.test(lessonsReport()));
const fix = 'Unquoted numeric attribute selectors are invalid CSS — the whole rule is dropped; quote the value: [data-m="1"].';
const stored = recordLesson({ signature: a, text: fix, error: 'Unexpected "4"', files: ['src/styles.css'] });
check('lesson stored', Boolean(stored?.id), stored?.id ?? '');
const hit = lessonsFor('[css-syntax-error] Unexpected "7"');
check('a new instance of the same error retrieves it', hit.length === 1 && hit[0].id === stored?.id);
check('an unrelated error does not', lessonsFor('ENOENT reading widget.js during startup').length === 0);
const lines = lessonLines('[css-syntax-error] Unexpected "5"');
check(
  'injection line carries the past fix',
  lines.length === 1 && /you hit this before and fixed it/.test(lines[0]) && /quote the value/.test(lines[0]),
  (lines[0] ?? '').slice(0, 100),
);

console.log('\n--- lifecycle ---');
recordLesson({ signature: a, text: fix, error: 'Unexpected "4"', files: [] });
check('the same lesson twice stays one lesson', recentLessons(10).length === 1 && recentLessons(1)[0].seen === 2, `seen=${recentLessons(1)[0].seen}`);
check('report lists it with its count', /seen 2×/.test(lessonsReport()));
check('forget removes it', forgetLesson(stored?.id ?? '') && lessonsFor('[css-syntax-error] Unexpected "7"').length === 0);

console.log('\n--- no key, no spend, no invented advice ---');
const out = await distillLesson({ folder: tmp, buildId: 'x', failureDetail: 'boom', changedFiles: [] });
check('distillation is off without a live turn', out === null && recentLessons(10).length === 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
