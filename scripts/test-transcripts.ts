/**
 * Transcript-archive smoke test: trimming at the 60-message cap and resetting
 * a session must preserve every dropped message verbatim in
 * data/transcripts/<slug>.jsonl. Uses a scratch session key, cleans up after.
 * Run: node_modules\.bin\tsx.cmd scripts\test-transcripts.ts
 */
import fs from 'node:fs';
import * as store from '../src/core/store.js';
import { transcriptPath } from '../src/core/transcripts.js';

interface ArchivedLine {
  marker?: string;
  sessionKey?: string;
  role?: string;
  at?: string;
  content?: string;
  reason?: string;
  count?: number;
}

const KEY = 'web:999996';
const file = transcriptPath(KEY);

// Clean slate: wipe any leftover scratch session first, then remove its archive.
store.resetSession(KEY);
fs.rmSync(file, { force: true });

let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const readArchive = (): ArchivedLine[] =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ArchivedLine)
    : [];

// 70 messages force the 60-cap to drop the first 10.
for (let i = 1; i <= 70; i++) {
  store.appendMessage(KEY, {
    role: i % 2 ? 'user' : 'assistant',
    content: `transcript-test message ${i} — keep every word 🗝️`,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  });
}

const afterTrim = readArchive();
const trimmed = afterTrim.filter((r) => r.reason === 'trim');
check('exactly 10 messages archived by trim', trimmed.length === 10, String(trimmed.length));
check('first message preserved verbatim', trimmed[0]?.content === 'transcript-test message 1 — keep every word 🗝️');
check('store itself capped at 60', store.getSession(KEY).length === 60);

// Reset archives the remaining snapshot plus a wipe marker.
const beforeReset = store.getSession(KEY).length;
store.resetSession(KEY);
const afterReset = readArchive();
const marker = afterReset.find((r) => r.marker === 'reset');
check('reset marker archived with count', Boolean(marker) && marker.count === beforeReset, `count=${marker?.count}/${beforeReset}`);
const resetMsgs = afterReset.filter((r) => r.reason === 'reset');
check('reset archived the full snapshot', resetMsgs.length === beforeReset, `${resetMsgs.length}/${beforeReset}`);
check('store is empty after reset', store.getSession(KEY).length === 0);
check('newest message intact after reset', resetMsgs[resetMsgs.length - 1]?.content === 'transcript-test message 70 — keep every word 🗝️');
check('all 70 messages recoverable from archive', [...trimmed, ...resetMsgs].length === 70, `${trimmed.length + resetMsgs.length}/70`);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall green');
process.exitCode = fails ? 1 : 0;
