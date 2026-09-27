import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from './settings.js';
import { archiveTranscript } from './transcripts.js';

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

interface DbShape {
  sessions: Record<string, StoredMessage[]>;
}

export const MAX_SESSION_MESSAGES = 60;

const statePath = (): string => path.join(dataRoot(), 'looper-state.json');
let db: DbShape | null = null;
let loadedPath = '';

function load(file: string): DbShape {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { sessions?: Record<string, StoredMessage[]> };
    // Legacy keys (missions/credEvents) from the removed practice economy are dropped on next write.
    return { sessions: parsed.sessions ?? {} };
  } catch {
    return { sessions: {} };
  }
}

/** Loads (or re-loads after a data-directory switch) the state file on demand. */
function ensure(): DbShape {
  const file = statePath();
  if (!db || loadedPath !== file) {
    db = load(file);
    loadedPath = file;
  }
  return db;
}

function persist(): void {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ensure(), null, 2));
  fs.renameSync(tmp, file);
}

// The local practice economy (missions/cred/receipts) was removed — the real
// Cred system is Helixa's, read in src/core/cred.ts.

export function getSession(sessionKey: string): StoredMessage[] {
  return ensure().sessions[sessionKey] ?? [];
}

export function appendMessage(sessionKey: string, message: StoredMessage): void {
  const data = ensure();
  const list = data.sessions[sessionKey] ?? (data.sessions[sessionKey] = []);
  list.push(message);
  if (list.length > MAX_SESSION_MESSAGES) {
    // The cap drops the OLDEST messages — verbatim-archive them before they leave.
    const dropped = list.splice(0, list.length - MAX_SESSION_MESSAGES);
    archiveTranscript(sessionKey, dropped, 'trim');
  }
  persist();
}

export function resetSession(sessionKey: string): void {
  const data = ensure();
  const existing = data.sessions[sessionKey];
  // A wipe must never be the last time the words existed — archive first.
  if (existing?.length) archiveTranscript(sessionKey, existing, 'reset');
  delete data.sessions[sessionKey];
  persist();
}
