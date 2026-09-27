import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Verbatim transcript archive — the last line of defense for conversation text.
 *
 * The raw session store keeps only the last 60 messages per thread and wipes
 * threads on reset (episodes keep a terse digest of what happened, never the
 * words themselves). Before ANY message is dropped — a trim at the 60-cap or a
 * reset wipe — it is appended here verbatim as JSONL:
 *
 *   data/transcripts/<session-slug>.jsonl
 *
 * Line shapes:
 *   { sessionKey, archivedAt, reason: 'trim'|'reset', role, at, content }
 *   { marker: 'reset', sessionKey, archivedAt, count }   ← wipe boundary
 *
 * Reconstruct a thread by concatenating the message lines in file order
 * (trims stream out chronologically as they happen; resets append the whole
 * remaining snapshot). Append-only, best-effort: archiving must never break a
 * turn or a reset. Search with scripts/search-transcripts.ts.
 */

const root = path.join(config.dataDir, 'transcripts');

interface ArchivedMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

function slug(sessionKey: string): string {
  return sessionKey.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'session';
}

export function transcriptPath(sessionKey: string): string {
  return path.join(root, `${slug(sessionKey)}.jsonl`);
}

export function archiveTranscript(sessionKey: string, messages: ArchivedMessage[], reason: 'reset' | 'trim'): void {
  if (!messages.length) return;
  try {
    fs.mkdirSync(root, { recursive: true });
    const archivedAt = new Date().toISOString();
    const lines: string[] = [];
    if (reason === 'reset') {
      lines.push(JSON.stringify({ marker: 'reset', sessionKey, archivedAt, count: messages.length }));
    }
    for (const m of messages) {
      lines.push(JSON.stringify({ sessionKey, archivedAt, reason, role: m.role, at: m.at, content: m.content }));
    }
    fs.appendFileSync(transcriptPath(sessionKey), `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // best-effort — a failed archive must never break the store
  }
}

// --- console archive view ----------------------------------------------------

export interface TranscriptSessionInfo {
  session: string;
  file: string;
  events: number;
  messages: number;
  resets: number;
  bytes: number;
  updatedAt: string;
}

export interface TranscriptLine {
  marker?: string;
  sessionKey?: string;
  role?: 'user' | 'assistant';
  at?: string;
  archivedAt?: string;
  reason?: 'trim' | 'reset';
  content?: string;
  count?: number;
}

/** Every archived session, newest activity first. */
export function listTranscripts(): TranscriptSessionInfo[] {
  try {
    fs.mkdirSync(root, { recursive: true });
    const infos: TranscriptSessionInfo[] = [];
    for (const name of fs.readdirSync(root).filter((f) => f.endsWith('.jsonl'))) {
      const full = path.join(root, name);
      const stat = fs.statSync(full);
      const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
      let session = name.replace(/\.jsonl$/, '');
      let messages = 0;
      let resets = 0;
      let updatedAt = stat.mtime.toISOString();
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as TranscriptLine;
          if (rec.marker === 'reset') resets++;
          else messages++;
          if (rec.sessionKey) session = rec.sessionKey;
          if (rec.archivedAt) updatedAt = rec.archivedAt;
        } catch {
          // skip a corrupt line, keep the rest
        }
      }
      infos.push({ session, file: name, events: lines.length, messages, resets, bytes: stat.size, updatedAt });
    }
    return infos.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** One session's archived lines (oldest first), capped to the last `cap` lines. */
export function readTranscript(sessionRaw: string, cap = 2000): { session: string; events: TranscriptLine[]; truncated: boolean } | null {
  const file = transcriptPath(sessionRaw);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const truncated = lines.length > cap;
  const slice = truncated ? lines.slice(-cap) : lines;
  const events: TranscriptLine[] = [];
  for (const line of slice) {
    try {
      events.push(JSON.parse(line) as TranscriptLine);
    } catch {
      // skip a corrupt line, keep the rest
    }
  }
  const session = events.find((e) => e.sessionKey)?.sessionKey ?? sessionRaw;
  return { session, events, truncated };
}
