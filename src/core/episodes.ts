import { completeReply, llmMode } from './llm.js';
import { latestEpisodeCoveredAt, storeEpisode } from './memory.js';
import * as store from './store.js';
import type { StoredMessage } from './store.js';

/**
 * Episodic memory: conversations distilled into durable notes BEFORE they are
 * lost — either trimmed off the session store (60-message cap) or wiped by a
 * reset. Raw quotes stay searchable via `search_history` while stored; the
 * episode summaries are what survives, recallable like any other memory.
 *
 * Group chats (tg:-…) are deliberately NOT distilled — guests' chatter does
 * not become operator memory.
 */

const MIN_MESSAGES = 6; // below this, nothing worth keeping
const MAX_TRANSCRIPT_CHARS = 24_000;
const TRIM_TRIGGER = 40; // session length that suggests distillation
const KEEP_RECENT = 16; // never summarize the messages still in context
const MIN_NEW = 16; // needs this many new old messages to re-summarize

function labelFor(sessionKey: string): string {
  if (sessionKey.includes(':build:')) return 'build thread';
  if (sessionKey.startsWith('web:')) return 'console';
  if (sessionKey.startsWith('tg:')) return 'telegram';
  if (sessionKey.startsWith('dc:')) return 'discord';
  return 'session';
}

export { labelFor };

const SUMMARY_SYSTEM = [
  'You are a memory archivist for an autonomous agent. Distill the conversation transcript into AT MOST 6 terse bullet points, each starting with "- ".',
  'Capture ONLY: decisions made, work completed (builds/edits/actions taken), operator preferences or rules stated, open threads or promises. Facts only — no greetings, no pleasantries, no rhetoric.',
  'When a reply contains "[output stopped by operator]", the generation was CUT SHORT mid-stream — record it as stopped/partial, never as completed or delivered. An opening line claiming "twelve paragraphs" or similar describes an intent, not what was produced; the transcript only shows what actually arrived.',
  'If the transcript contains nothing memory-worthy, reply with exactly: (nothing memory-worthy)',
].join('\n');

async function summarize(transcript: string): Promise<string | null> {
  try {
    const reply = (
      await completeReply([
        { role: 'system', content: SUMMARY_SYSTEM },
        { role: 'user', content: `Transcript:\n\n${transcript}` },
      ])
    ).trim();
    if (!reply || reply.toLowerCase().includes('(nothing memory-worthy)')) return null;
    return reply.slice(0, 4000);
  } catch (err) {
    console.warn(`[episodes] summarization failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Distill the older part of a session into an episode note. `keepRecent` is
 * how many trailing messages stay untouched (0 = whole thread, for resets);
 * `minFresh` is the minimum number of new old messages worth summarizing.
 * Returns true if an episode was stored.
 */
export async function distillMessages(
  tokenId: number,
  sessionKey: string,
  messages: StoredMessage[],
  keepRecent: number,
  minFresh: number,
): Promise<boolean> {
  if (llmMode() !== 'live') return false; // the mock brain cannot summarize honestly
  // A FRESH chat (see fresh.ts) must not WRITE the memory it was never allowed to
  // read — otherwise a throwaway experiment resurfaces as an episode later.
  if (sessionKey.includes(':fresh:')) return false;
  if (messages.length < MIN_MESSAGES) return false;

  const cutoff = Math.max(0, messages.length - keepRecent);
  const block = messages.slice(0, cutoff);
  if (!block.length) return false;

  // Bookkeeping by TIMESTAMP survives the store's head-trim and resets.
  const marker = await latestEpisodeCoveredAt(sessionKey);
  const fresh = marker ? block.filter((m) => m.at > marker) : block;
  if (fresh.length < minFresh) return false;

  const transcript = fresh
    .map(
      (m) =>
        `${m.role === 'user' ? 'OPERATOR' : 'AGENT'} [${m.at}]: ${(m.content.length > 700 ? `${m.content.slice(0, 700)}…` : m.content).replace(/\s+/g, ' ')}`,
    )
    .join('\n')
    .slice(-MAX_TRANSCRIPT_CHARS);

  const summary = await summarize(transcript);
  if (!summary) return false;

  const coveredThroughAt = fresh[fresh.length - 1].at;
  const content = `History — ${labelFor(sessionKey)} session, ${coveredThroughAt.slice(0, 10)}:\n${summary}`;
  await storeEpisode(tokenId, sessionKey, coveredThroughAt, content);
  return true;
}

const inflight = new Set<string>();
const lastAttempt = new Map<string, number>();
const ATTEMPT_COOLDOWN_MS = 10 * 60_000;

/**
 * Trim-time distillation — call (un-awaited) after every persisted turn.
 * Summarizes the older half of a long session before the 60-message cap
 * starts discarding it. Fire-and-forget: never blocks the reply.
 */
export function maybeSummarize(sessionKey: string, tokenId: number): void {
  if (sessionKey.startsWith('tg:-')) return; // group chats are not distilled into memory
  if (inflight.has(sessionKey)) return;
  const messages = store.getSession(sessionKey);
  if (messages.length < TRIM_TRIGGER) return;
  const lastAt = lastAttempt.get(sessionKey) ?? 0;
  if (Date.now() - lastAt < ATTEMPT_COOLDOWN_MS) return;
  lastAttempt.set(sessionKey, Date.now());
  inflight.add(sessionKey);
  void distillMessages(tokenId, sessionKey, messages, KEEP_RECENT, MIN_NEW)
    .catch(() => false)
    .finally(() => inflight.delete(sessionKey));
}
