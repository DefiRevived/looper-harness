import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildsRoot, dataPath } from './settings.js';

/**
 * Build outcomes, remembered per build folder.
 *
 * Without this, "did it actually build, and what did the compiler say?" has no
 * answer: the agent's turn ends, the operator opens the preview, and a failure
 * dies with the turn that caused it. The record has to OUTLIVE the turn so the
 * agent can be told about it later, and so a failure found by the preview is
 * still visible to the agent on its next pass.
 */
export interface BuildOutcome {
  ok: boolean;
  at: number;
  /** First lines of the failure, or a short success summary. */
  detail: string;
  /** Who produced it: the agent's own call, the turn-close gate, or the preview. */
  via: 'agent' | 'gate' | 'preview';
}

const root = (): string => dataPath('build-state');

const fileFor = (folder: string): string =>
  path.join(root(), `${crypto.createHash('sha1').update(path.resolve(folder)).digest('hex').slice(0, 16)}.json`);

export function recordBuildOutcome(folder: string, outcome: BuildOutcome): void {
  try {
    fs.mkdirSync(root(), { recursive: true });
    fs.writeFileSync(fileFor(folder), JSON.stringify({ folder: path.resolve(folder), ...outcome }), 'utf8');
  } catch {
    // Best-effort by design: bookkeeping must never break a build.
  }
}

export function lastBuildOutcome(folder: string): BuildOutcome | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileFor(folder), 'utf8')) as BuildOutcome;
    return typeof parsed?.ok === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

/** One line for context injection — null when this folder has no record. */
export function buildOutcomeLine(folder: string, label: string): string | null {
  const o = lastBuildOutcome(folder);
  if (!o) return null;
  const head = o.detail.trim().split('\n').slice(0, 4).join(' / ').slice(0, 400);
  return o.ok
    ? `- ${label}: last build OK (${ago(o.at)}, via ${o.via}).`
    : `- ${label}: LAST BUILD FAILED (${ago(o.at)}, via ${o.via}) — fix this before claiming anything works: ${head}`;
}

/** Builds of one session whose last recorded outcome FAILED (newest first). */
export function failingBuilds(sessionDir: string): Array<{ buildId: string; line: string }> {
  const dir = path.join(buildsRoot(), sessionDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<{ buildId: string; line: string }> = [];
  for (const name of names) {
    if (!/^[0-9]+-[a-z0-9-]{1,80}$/.test(name)) continue;
    const o = lastBuildOutcome(path.join(dir, name));
    if (!o || o.ok) continue;
    const head = o.detail.trim().split('\n').slice(0, 3).join(' / ').slice(0, 240);
    out.push({ buildId: name, line: `- ${name}: build FAILED ${ago(o.at)} — ${head}` });
  }
  return out.slice(0, 4);
}
