import fs from 'node:fs';
import path from 'node:path';
import { dataPath } from './settings.js';

/**
 * Activity log — a per-session receipt trail of tool calls, so the operator
 * can audit what the agent actually did even after the chat scrolls away.
 * Best-effort file log (data/activity/<session>.jsonl), capped per session.
 */

const activityRoot = (): string => dataPath('activity');
const MAX_EVENTS = 200;

export interface ActivityEvent {
  at: string;
  tool: string;
}

function fileFor(sessionKey: string): string {
  const slug = sessionKey.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'session';
  return path.join(activityRoot(), `${slug}.jsonl`);
}

export function logActivity(sessionKey: string, tool: string): void {
  try {
    const file = fileFor(sessionKey);
    fs.mkdirSync(activityRoot(), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), tool })}\n`, 'utf8');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > MAX_EVENTS + 50) {
      fs.writeFileSync(file, `${lines.slice(-MAX_EVENTS).join('\n')}\n`, 'utf8');
    }
  } catch {
    // activity log is best-effort — never break a turn over it
  }
}

/** Most recent events first. */
export function listActivity(sessionKey: string, limit = 60): ActivityEvent[] {
  try {
    const capped = Math.min(Math.max(1, limit), MAX_EVENTS);
    const lines = fs
      .readFileSync(fileFor(sessionKey), 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-capped);
    const events: ActivityEvent[] = [];
    for (const line of lines.reverse()) {
      try {
        const parsed = JSON.parse(line) as ActivityEvent;
        if (parsed && typeof parsed.tool === 'string' && typeof parsed.at === 'string') events.push(parsed);
      } catch {
        // skip a corrupt line, keep the rest
      }
    }
    return events;
  } catch {
    return [];
  }
}
