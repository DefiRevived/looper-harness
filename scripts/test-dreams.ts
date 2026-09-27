/**
 * Dream-pass smoke test: backfill mirrors if needed, run a real dream (unless
 * one already landed today via the scheduler), verify storage, recall and the
 * schedule logic. Run: node_modules\.bin\tsx.cmd scripts\test-dreams.ts
 */
import { dreamDue, runDream } from '../src/core/dreams.js';
import { backfillLayers, listDreams, memoryRecall } from '../src/core/memory.js';

/** Live-read fixture token — override with LOOPER_TEST_TOKEN to point at your own. */
const TOKEN = Number(process.env.LOOPER_TEST_TOKEN ?? 7777);
let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const bf = await backfillLayers(TOKEN);
check('layered store populated (mirrored or already had entries)', bf.mirrored >= 3 || bf.skipped, JSON.stringify(bf));

const before = (await listDreams(TOKEN)).length;
const due = await dreamDue(TOKEN);
if (due === 'already') {
  console.log('note: a dream already exists today (scheduler or earlier run) — verifying it instead of a live run');
} else {
  console.log(`dreamDue says: ${due} — running a live dream pass...`);
  const result = await runDream(TOKEN, 'manual');
  check('dream pass produced a result', result.ok, result.skipped ?? '');
  if (result.ok && result.dream) {
    check(
      'dream has title + content + sources',
      result.dream.title.length > 2 && result.dream.content.length > 40 && result.dream.sourceCount > 0,
      `${result.dream.sourceCount} sources, model=${result.dream.modelUsed ?? 'fallback'}`,
    );
    console.log(`\n--- "${result.dream.title}"`);
    console.log(result.dream.content.slice(0, 1000));
    if (result.dream.themes.length) console.log(`themes: ${result.dream.themes.join(' · ')}`);
    if (result.dream.actions.length) console.log(`next moves: ${result.dream.actions.join(' · ')}`);
    console.log('');
  }
}

const dreams = await listDreams(TOKEN);
check('at least one dream stored', dreams.length >= 1, `${dreams.length} total (before: ${before})`);

const dueAfter = await dreamDue(TOKEN);
check('schedule now reports "already" for today', dueAfter === 'already', dueAfter);

const earlyDate = new Date();
earlyDate.setHours(1, 0, 0, 0);
const early = await dreamDue(TOKEN, earlyDate);
check('schedule reports "early" before the dream hour', early === 'early', early);

const recalled = await memoryRecall({ tokenId: TOKEN, sessionKey: `web:${TOKEN}`, limit: 30 });
check('recall surfaces the dream (scope dream)', recalled.some((e) => e.scope === 'dream'));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall green');
process.exitCode = fails ? 1 : 0;
