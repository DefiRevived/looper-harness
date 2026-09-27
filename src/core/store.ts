import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
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

const statePath = path.join(config.dataDir, 'looper-state.json');
let db: DbShape = load();

function load(): DbShape {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { sessions?: Record<string, StoredMessage[]> };
    // Legacy keys (missions/credEvents) from the removed practice economy are dropped on next write.
    return { sessions: parsed.sessions ?? {} };
  } catch {
    return { sessions: {} };
  }
}

function persist(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, statePath);
}

// The local practice economy (missions/cred/receipts) was removed — the real
// Cred system is Helixa's, read in src/core/cred.ts.

export function getSession(sessionKey: string): StoredMessage[] {
  return db.sessions[sessionKey] ?? [];
}

export function appendMessage(sessionKey: string, message: StoredMessage): void {
  const list = db.sessions[sessionKey] ?? (db.sessions[sessionKey] = []);
  list.push(message);
  if (list.length > MAX_SESSION_MESSAGES) {
    // The cap drops the OLDEST messages — verbatim-archive them before they leave.
    const dropped = list.splice(0, list.length - MAX_SESSION_MESSAGES);
    archiveTranscript(sessionKey, dropped, 'trim');
  }
  persist();
}

export function resetSession(sessionKey: string): void {
  const existing = db.sessions[sessionKey];
  // A wipe must never be the last time the words existed — archive first.
  if (existing?.length) archiveTranscript(sessionKey, existing, 'reset');
  delete db.sessions[sessionKey];
  persist();
}
