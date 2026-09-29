/**
 * Large-write path: a truncated tool call must report the real cause instead of
 * looking like a JSON bug, a bare-timestamp build id must resolve, and the
 * console must be able to add files to a build ONE AT A TIME — which is how a
 * project too big for a single response actually gets landed.
 */
import fs from 'node:fs';
import path from 'node:path';

const tmp = path.resolve('tmp-largewrites-test');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
process.env.LOOPER_DATA_DIR = tmp; // must precede any core import (config resolves at load)

const { executeToolCall } = await import('../src/core/tools.js');
const { config } = await import('../src/core/config.js');

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = ''): void => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? ` — ${note}` : ''}`);
};

const ctx = { sessionKey: 'web:999991', surface: 'web' as const, tokenId: 999991 };
const call = (name: string, args: Record<string, unknown>) => ({
  id: 't',
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});

console.log('--- configured ceiling ---');
check('output ceiling is explicit and generous', config.deepseek.maxOutputTokens >= 16384, `maxOutputTokens=${config.deepseek.maxOutputTokens}`);

console.log('\n--- console can scaffold, then write file by file ---');
const scaffold = await executeToolCall(call('render_artifact', { title: 'large write probe', kind: 'html', content: '<!doctype html><title>probe</title><p>probe</p>' }), ctx);
const buildId = scaffold.artifact?.id ?? '';
check('scaffold build from the console', Boolean(buildId), scaffold.modelText.slice(0, 70));
const ts = buildId.split('-')[0] ?? '';
const buildDir = path.join(tmp, 'artifacts', 'web_999991', buildId);

const wrote = await executeToolCall(call('write_build_file', { build_id: ts, file: 'src/app.js', content: 'export const answer = 42;\n' }), ctx);
check(
  'write_build_file from console via BARE timestamp',
  fs.existsSync(path.join(buildDir, 'src', 'app.js')) && !/failed/.test(wrote.modelText),
  wrote.modelText.slice(0, 110),
);

const listed = await executeToolCall(call('list_build_files', { build_id: ts }), ctx);
check('list_build_files accepts the bare timestamp', listed.modelText.includes('src/app.js'), listed.modelText.split('\n')[0] ?? '');

const searched = await executeToolCall(call('search_build', { build_id: ts, query: 'answer' }), ctx);
check('search_build (shared resolver) accepts it too', /1 match/.test(searched.modelText), searched.modelText.split('\n')[0] ?? '');

const second = await executeToolCall(call('write_build_file', { build_id: ts, file: 'src/extra.js', content: 'export const extra = true;\n' }), ctx);
check('a SECOND file lands separately (the large-project path)', fs.existsSync(path.join(buildDir, 'src', 'extra.js')) && !/failed/.test(second.modelText));

console.log('\n--- failures must name the real cause ---');
const truncated = {
  id: 't2',
  type: 'function' as const,
  truncated: true,
  function: { name: 'render_artifact', arguments: '{"title":"huge","kind":"html","content":"' + 'x'.repeat(9000) },
};
const cut = await executeToolCall(truncated, ctx);
check(
  'truncated call refused with the real cause + the fix',
  /NOT executed/.test(cut.modelText) && /output ceiling/.test(cut.modelText) && /write_build_file/.test(cut.modelText),
  cut.modelText.slice(0, 130),
);
check('truncated call reports how much arrived', /KB/.test(cut.modelText));

const cutStream = await executeToolCall(
  {
    id: 't3',
    type: 'function' as const,
    truncated: true,
    truncatedReason: 'stream' as const,
    function: { name: 'write_build_file', arguments: '{"file":"a.js","content":"partial' },
  },
  ctx,
);
check(
  'a cut STREAM is reported as a cut stream, not a ceiling',
  /ENDED EARLY/.test(cutStream.modelText) && /under ~8KB/.test(cutStream.modelText),
  cutStream.modelText.slice(0, 120),
);

const missing = await executeToolCall(call('write_build_file', { file: 'a.js', content: 'a' }), ctx);
check('missing id says what to pass', /pass build_id/.test(missing.modelText), missing.modelText.slice(0, 110));

const unknown = await executeToolCall(call('write_build_file', { build_id: '1799999999999', file: 'x.js', content: 'x' }), ctx);
check('unknown id says it does not exist (not "provide build_id")', /no build matches/.test(unknown.modelText), unknown.modelText.slice(0, 110));

console.log('\n--- cleanup ---');
const removed = await executeToolCall(call('delete_build', { build_id: buildId }), ctx);
check('scratch build deleted', !fs.existsSync(buildDir), removed.modelText.slice(0, 80));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
