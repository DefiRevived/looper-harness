/**
 * Thought-stream tests: the live reasoning stream (DeepSeek `reasoning_content`)
 * and the tool lifecycle events must reach the console event generator as they
 * happen — not only after the turn closes.
 *
 * Live checks need a configured API key; without one they are skipped so a
 * fresh clone stays green. Run with a throwaway LOOPER_DATA_DIR to keep your
 * real session store clean, e.g.:
 *   $env:LOOPER_DATA_DIR="$env:TEMP\looper-thought-test"; tsx scripts/test-thought-stream.ts
 */
import { dataDirInfo, llmApiKey } from '../src/core/settings.js';
import { streamAgentReplyWithTools, type AgentEvent } from '../src/core/brain.js';

/** Live-read fixture token — override with LOOPER_TEST_TOKEN to point at your own. */
const TOKEN = Number(process.env.LOOPER_TEST_TOKEN ?? 7777);

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const textOf = (events: AgentEvent[], kind: 'thought' | 'delta'): string =>
  events.filter((e) => e.type === kind).map((e) => (e.type === kind ? e.text : '')).join('');

console.log(`data dir: ${dataDirInfo().effective}`);

if (!llmApiKey()) {
  console.log('\nno API key configured — live checks skipped');
} else {
  console.log('\nturn 1 — reasoning-bait reply: reasoning must stream BEFORE the text');
  // The hybrid model MAY skip its thinking phase on a trivial prompt, and that
  // is not a harness defect — it flipped whole runs red depending on how much
  // context preceded the call. Retry with a FRESH session until the model
  // actually thinks (up to 3); a model that never thinks in three tries is the
  // real failure. Each attempt gets its own session so prior turns can't bias it.
  let events: AgentEvent[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    events = [];
    for await (const event of streamAgentReplyWithTools(
      TOKEN,
      `test:thought-stream-${attempt}`,
      'Think it through step by step, then reply with exactly: 391 — do not use any tools.',
      'web',
    )) {
      events.push(event);
    }
    if (events.some((e) => e.type === 'thought' && e.text.trim())) break;
    if (attempt < 3) console.log(`  … attempt ${attempt}: model skipped its thinking phase (not a defect) — retrying`);
  }
  const firstThought = events.findIndex((e) => e.type === 'thought' && e.text.trim());
  const firstDelta = events.findIndex((e) => e.type === 'delta' && e.text.trim());
  const thoughtCount = events.filter((e) => e.type === 'thought').length;
  const thoughtText = textOf(events, 'thought');
  const reply = textOf(events, 'delta').trim();

  check('reasoning events reached the stream', firstThought >= 0, `${thoughtCount} events, ${thoughtText.length} chars`);
  check(
    'reasoning arrived before reply text',
    firstThought >= 0 && (firstDelta === -1 || firstThought < firstDelta),
    `first thought #${firstThought}, first text #${firstDelta}`,
  );
  check('reply still lands intact', /391/.test(reply), JSON.stringify(reply.slice(0, 60)));
  const snippet = thoughtText.trim().replace(/\s+/g, ' ').slice(0, 140);
  if (snippet) console.log(`    thought snippet: “${snippet}…”`);

  console.log('\nturn 2 — one forced tool: start → done receipts');
  const events2: AgentEvent[] = [];
  for await (const event of streamAgentReplyWithTools(TOKEN, 'test:thought-stream', 'Call the list_builds tool exactly once (no other tools), then reply done.', 'web')) {
    events2.push(event);
  }
  const starts = events2.filter((e) => e.type === 'tool');
  const dones = events2.filter((e) => e.type === 'tool_done');
  check(
    'tool start events streamed with a name',
    starts.length > 0,
    `${starts.length} start(s): ${starts.map((e) => (e.type === 'tool' ? e.name : '')).join(', ')}`,
  );
  check('every started tool finished with a receipt', dones.length > 0 && dones.length === starts.length, `${dones.length} done event(s)`);
  check(
    'receipts carry duration + result note',
    dones.every((e) => e.type === 'tool_done' && Number.isFinite(e.ms) && e.ms >= 0),
    dones.map((e) => (e.type === 'tool_done' ? `${e.name} ${e.ms}ms ok=${e.ok}` : '')).join(' | '),
  );
}

console.log(`\n${fail === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
