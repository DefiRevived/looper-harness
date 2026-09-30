import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataPath } from './settings.js';
import { llmMode, completeReply } from './llm.js';

/**
 * Build lessons — the harness learning from its own failures.
 *
 * A build fails, the agent fixes it, the build passes. That sequence contains a
 * reusable piece of knowledge, and it used to evaporate: the next project hit
 * the same class of error and paid for it again (the invalid-CSS-selector case
 * cost a whole debugging round trip).
 *
 * Retrieval is by ERROR SIGNATURE, deterministically — not by embedding
 * similarity. When a build fails again, the lesson that fixed the same shape of
 * error has to come back reliably; a semantic search that sometimes misses is
 * worse than useless here. Lesson TEXT is written by the model at distillation
 * time (only with a live key — a mock must never invent engineering advice).
 */
export interface Lesson {
  id: string;
  /** Normalized error shape — the retrieval key. */
  signature: string;
  /** The distilled cause → fix, one or two sentences. */
  text: string;
  /** The verbatim error head that produced it. */
  error: string;
  /** Files modified between the failing build and the successful one. */
  files: string[];
  buildId?: string;
  at: number;
  /** How many times this same lesson has been re-derived. */
  seen: number;
}

const file = (): string => dataPath('lessons', 'lessons.jsonl');
const MAX_LESSONS = 200;

function readAll(): Lesson[] {
  try {
    return fs
      .readFileSync(file(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Lesson)
      .filter((l) => l && typeof l.text === 'string');
  } catch {
    return [];
  }
}

function writeAll(lessons: Lesson[]): void {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), lessons.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  } catch {
    // best-effort: learning must never break a build
  }
}

/**
 * The shape of an error, with the specifics filed off: quoted values, numbers
 * and paths replaced so two instances of the same bug land on the same key.
 */
export function signatureOf(errorText: string): string {
  const lines = errorText.split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /error|failed|unexpected|not found|cannot|invalid|missing|✗/i.test(l)) ?? lines[0] ?? '';
  return line
    .toLowerCase()
    .replace(/["'`][^"'`]*["'`]/g, '<v>')
    .replace(/[a-z]:\\[^\s]+|\/[\w./-]{3,}/gi, '<p>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Store a lesson; an identical (signature + text) pair just bumps its count. */
export function recordLesson(input: Omit<Lesson, 'id' | 'seen' | 'at'> & { at?: number }): Lesson | null {
  const lessons = readAll();
  const dup = lessons.find((l) => l.signature === input.signature && l.text.trim() === input.text.trim());
  if (dup) {
    dup.seen += 1;
    dup.at = Date.now();
    writeAll(lessons);
    return dup;
  }
  const lesson: Lesson = {
    id: crypto.randomUUID().slice(0, 8),
    seen: 1,
    at: input.at ?? Date.now(),
    signature: input.signature,
    text: input.text.trim(),
    error: input.error.slice(0, 600),
    files: input.files.slice(0, 12),
    buildId: input.buildId,
  };
  const next = [...lessons, lesson].slice(-MAX_LESSONS);
  writeAll(next);
  return lesson;
}

/** Lessons matching an error, newest first — exact signature, then a loose prefix match. */
export function lessonsFor(errorText: string, limit = 2): Lesson[] {
  const sig = signatureOf(errorText);
  if (!sig) return [];
  const all = readAll().sort((a, b) => b.at - a.at);
  const exact = all.filter((l) => l.signature === sig);
  if (exact.length) return exact.slice(0, limit);
  const head = sig.slice(0, 24);
  return all.filter((l) => l.signature.startsWith(head)).slice(0, limit);
}

export function recentLessons(limit = 3): Lesson[] {
  return readAll()
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export function forgetLesson(id: string): boolean {
  const lessons = readAll();
  const next = lessons.filter((l) => l.id !== id);
  if (next.length === lessons.length) return false;
  writeAll(next);
  return true;
}

/** Injection lines for a fresh failure: "you have fixed this shape before". */
export function lessonLines(errorText: string, limit = 2): string[] {
  return lessonsFor(errorText, limit).map(
    (l) => `- you hit this before and fixed it${l.seen > 1 ? ` (${l.seen}×)` : ''}: ${l.text}`,
  );
}

export function lessonsReport(limit = 10): string {
  const lessons = recentLessons(limit);
  if (!lessons.length) {
    return 'No build lessons yet — they are written automatically when a build that FAILED later succeeds after an edit (needs a live model key).';
  }
  return [
    `BUILD LESSONS (${lessons.length} most recent — learned from real failures that were then fixed):`,
    ...lessons.map((l) => {
      const when = new Date(l.at).toISOString().slice(0, 16).replace('T', ' ');
      const files = l.files.length ? ` [changed: ${l.files.slice(0, 4).join(', ')}]` : '';
      return `- ${l.id} · ${when} · seen ${l.seen}×${files}\n  signature: ${l.signature}\n  ${l.text}`;
    }),
    'These are injected automatically when a build fails on a matching error. Forget one with lessons forget="<id>".',
  ].join('\n');
}

/**
 * Distill a lesson from a recovered failure. Fire-and-forget: it runs after a
 * successful build, never blocking it, and does nothing without a live key
 * (a mock brain must not invent engineering advice).
 */
export async function distillLesson(input: {
  folder: string;
  buildId: string;
  failureDetail: string;
  changedFiles: string[];
}): Promise<string | null> {
  // No key → no invented advice. LOOPER_NO_LESSONS=1 → no spend (tests).
  if (llmMode() === 'mock' || process.env.LOOPER_NO_LESSONS === '1') return null;
  const prompt =
    'A build failed, then the same project built successfully after source edits. Write the reusable lesson.\n\n' +
    `THE ERROR (verbatim):\n${input.failureDetail.slice(0, 1200)}\n\n` +
    `FILES CHANGED BETWEEN THE FAILING BUILD AND THE SUCCESSFUL ONE: ${input.changedFiles.join(', ') || '(none detected)'}\n\n` +
    'Rules: one or two sentences. State cause → fix. Only what the error text supports — if the fix is not evident, say what to inspect instead of guessing. No preamble, no markdown, no quotes.';
  try {
    const raw = await completeReply([
      { role: 'system', content: 'You write terse, factual engineering lessons for a build agent.' },
      { role: 'user', content: prompt },
    ]);
    const text = raw.trim().replace(/^["']|["']$/g, '').slice(0, 400);
    if (!text || text === '(no output)' || text.length < 12) return null;
    const stored = recordLesson({
      signature: signatureOf(input.failureDetail),
      text,
      error: input.failureDetail,
      files: input.changedFiles,
      buildId: input.buildId,
    });
    return stored ? stored.text : null;
  } catch {
    return null;
  }
}
