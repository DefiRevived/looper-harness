/**
 * Episodic memory + history search smoke test. Seeds a scratch session
 * (web:999999), verifies search_history sees beyond the 16-message window,
 * distillation stores a recallable episode, marker bookkeeping prevents
 * duplicates, and the reset path distills the tail. Cleans up after itself.
 */
import * as store from '../src/core/store.js';
import { distillMessages } from '../src/core/episodes.js';
import { memoryRecall, purgeTokenMemory } from '../src/core/memory.js';
import { executeToolCall, type ToolContext } from '../src/core/tools.js';

const KEY = 'web:999999';
const TOKEN = 999999;
const ctx: ToolContext = { sessionKey: KEY, surface: 'web', tokenId: TOKEN };
const call = (name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

await purgeTokenMemory(TOKEN);
store.resetSession(KEY);

// Seed 46 messages; the 'PLUMBUS' secret sits at index 6 — well outside the last-16 window.
const base = Date.now() - 120 * 60_000;
for (let i = 0; i < 23; i++) {
  const at = new Date(base + i * 2 * 60_000).toISOString();
  store.appendMessage(KEY, {
    role: 'user',
    content: i === 3 ? 'remember: the secret zoomlens codeword is PLUMBUS — do not lose it.' : `operator message ${i} about topic${i % 4}`,
    at,
  });
  store.appendMessage(KEY, { role: 'assistant', content: `agent reply ${i} covering topic${i % 4}`, at });
}
console.log('seeded messages:', store.getSession(KEY).length, '(expect 46)');

console.log('\n===== search_history (beyond the 16-message window) =====');
console.log((await call('search_history', { query: 'PLUMBUS' })).modelText);
console.log('---');
console.log((await call('search_history', { query: 'nonexistent-zeppelin' })).modelText);

console.log('\n===== distill (trim mode): keep 16, need 16 fresh =====');
const msgs = store.getSession(KEY);
console.log('first distill:', await distillMessages(TOKEN, KEY, msgs, 16, 16), '(expect true — 30 old messages)');
console.log('second distill (no new):', await distillMessages(TOKEN, KEY, store.getSession(KEY), 16, 16), '(expect false — marker covers them)');

console.log('\n===== episode recall =====');
const rec = await memoryRecall({ tokenId: TOKEN, sessionKey: KEY, limit: 10 });
for (const e of rec) console.log(`[${e.scope}] ${e.content.slice(0, 140).replace(/\n/g, ' | ')}`);
const about = await memoryRecall({ tokenId: TOKEN, about: 'PLUMBUS codeword zoomlens', limit: 5 });
console.log('about-path finds episode:', about.some((e) => e.scope === 'episode'), '(expect true)');

console.log('\n===== reset path (distills the uncovered tail) =====');
const tailAt = new Date(base + 46 * 60_000).toISOString();
store.appendMessage(KEY, { role: 'user', content: 'decision: ship the plumbus build, keep it self-contained', at: tailAt });
store.appendMessage(KEY, { role: 'assistant', content: 'noted — shipping under the self-contained rule', at: tailAt });
const snapshot = store.getSession(KEY);
store.resetSession(KEY);
console.log('reset distill:', await distillMessages(TOKEN, KEY, snapshot, 0, 2), '(expect true — a worthy decision is in the uncovered tail)');
console.log('reset distill again:', await distillMessages(TOKEN, KEY, snapshot, 0, 2), '(expect false — all covered)');
const rec2 = await memoryRecall({ tokenId: TOKEN, sessionKey: KEY, limit: 10 });
console.log('episodes now:', rec2.filter((e) => e.scope === 'episode').length, '(expect 2)');
for (const e of rec2.filter((x) => x.scope === 'episode')) console.log(`- ${e.content.slice(0, 150).replace(/\n/g, ' | ')}`);

store.resetSession(KEY);
await purgeTokenMemory(TOKEN);
console.log('\n(scratch cleaned)');
