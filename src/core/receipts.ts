/**
 * Receipt ledger — what has actually been VERIFIED about a build, and whether
 * those verdicts are still fresh. The agent failure mode this file exists to
 * kill: claiming a verification that is missing, failed, or STALE (rendered
 * before the last edit). Receipts come from the per-session activity log
 * (ref = build id, written by brain.ts when a receipt tool runs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { eventsForRef } from './activity.js';
import { listVersions } from './versions.js';

export const RECEIPT_TOOLS: Array<{ tool: string; label: string }> = [
  { tool: 'check_build', label: 'check' },
  { tool: 'verify_render', label: 'render' },
  { tool: 'project_build', label: 'dist build' },
  { tool: 'run_module', label: 'tests' },
  { tool: 'project_install', label: 'install' },
];

export interface ReceiptInfo {
  at: string;
  ok: boolean;
  ms?: number;
}

export interface Receipts {
  receipts: Record<string, ReceiptInfo | undefined>;
  lastWriteMs: number | null;
  staleRender: boolean;
  staleCheck: boolean;
  staleTests: boolean;
  empty: boolean;
}

const MANAGED = new Set(['node_modules', '.git', 'dist']);

/** Newest mtime across the build's SOURCE files (managed dirs skipped). */
function newestSourceMtime(folder: string, base = folder): number {
  let newest = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const e of entries) {
    if (base === folder && MANAGED.has(e.name)) continue;
    const full = path.join(base, e.name);
    if (e.isDirectory()) newest = Math.max(newest, newestSourceMtime(folder, full));
    else if (e.isFile()) {
      try {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      } catch {
        // vanished mid-walk — skip
      }
    }
  }
  return newest;
}

/** Collect the receipt state for one build (activity scan + version/mtime clock). */
export function collectReceipts(opts: { folder: string; sessionDir: string; buildId: string }): Receipts {
  const tools = new Set(RECEIPT_TOOLS.map((t) => t.tool));
  const events = eventsForRef(opts.buildId, tools); // newest first
  const receipts: Receipts['receipts'] = {};
  for (const ev of events) {
    if (!receipts[ev.tool]) receipts[ev.tool] = { at: ev.at, ok: ev.ok !== false, ms: ev.ms };
  }
  const versions = listVersions(opts.sessionDir, opts.buildId);
  // An archived version is a snapshot taken just BEFORE a write — its ts is
  // effectively the last-write clock (entry mtimes confirm it).
  const lastArchived = versions.length ? versions[0].ts : 0;
  const mtime = newestSourceMtime(opts.folder);
  const lastWriteMs = Math.max(lastArchived, mtime) || null;
  const at = (tool: string): number => {
    const rec = receipts[tool];
    return rec ? Date.parse(rec.at) : 0;
  };
  return {
    receipts,
    lastWriteMs,
    staleRender: lastWriteMs !== null && at('verify_render') < lastWriteMs,
    staleCheck: lastWriteMs !== null && at('check_build') < lastWriteMs,
    staleTests: lastWriteMs !== null && at('run_module') < lastWriteMs,
    empty: events.length === 0,
  };
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/** One-line receipt summary injected into the build thread's system context. */
export function receiptsLine(r: Receipts): string {
  if (r.empty) {
    return (
      'no verification receipts on record for this build yet — run check_build / verify_render (and run_module for tests) before claiming anything. ' +
      'Never claim a verdict you do not have a receipt for.'
    );
  }
  const now = Date.now();
  const parts: string[] = [];
  for (const { tool, label } of RECEIPT_TOOLS) {
    const rec = r.receipts[tool];
    if (!rec) {
      parts.push(`${label} —`);
      continue;
    }
    const flag = rec.ok ? '✓' : '✗ FAILED';
    const stale =
      (tool === 'verify_render' && r.staleRender) || (tool === 'check_build' && r.staleCheck) || (tool === 'run_module' && r.staleTests)
        ? ' STALE — the files changed after this receipt; re-run before quoting it'
        : '';
    parts.push(`${label} ${flag} ${ago(now - Date.parse(rec.at))} ago${stale}`);
  }
  return `${parts.join(' · ')}. A receipt older than the last write is STALE — never quote it as current.`;
}

/** Detailed ledger for the build_status tool. */
export function buildStatusReport(opts: { buildId: string; title: string; r: Receipts; versionsCount: number }): string {
  const { r } = opts;
  const lines: string[] = [`BUILD STATUS — "${opts.title}" (${opts.buildId})`];
  lines.push(`- archived versions: ${opts.versionsCount}`);
  lines.push(
    `- last write: ${r.lastWriteMs ? `${new Date(r.lastWriteMs).toISOString()} (${ago(Date.now() - r.lastWriteMs)} ago)` : 'unknown'}`,
  );
  for (const { tool, label } of RECEIPT_TOOLS) {
    const rec = r.receipts[tool];
    lines.push(
      rec
        ? `- ${label}: ${rec.ok ? 'PASSED ✓' : 'FAILED ✗'} at ${rec.at}${rec.ms !== undefined ? ` (took ${Math.round(rec.ms / 1000)}s)` : ''}`
        : `- ${label}: never run`,
    );
  }
  const issues: string[] = [];
  if (!r.receipts['verify_render']) issues.push('no render receipt at all — call verify_render before claiming anything visual');
  else if (r.staleRender) issues.push('the render receipt is older than the last write — the current files were NEVER rendered; re-run verify_render');
  if (!r.receipts['check_build']) issues.push('no static check on record');
  else if (r.staleCheck) issues.push('the check receipt is older than the last write');
  if (r.receipts['verify_render']?.ok === false) issues.push('the last render FAILED — fix before shipping');
  if (r.receipts['check_build']?.ok === false) issues.push('the last check FAILED — fix before shipping');
  if (r.receipts['run_module'] && r.staleTests) issues.push('tests ran before the last write — re-run run_module for current numbers');
  lines.push(
    issues.length
      ? `- verdict: NOT CURRENT — ${issues.join('; ')}.`
      : '- verdict: receipts are current for the latest write. Only receipt tools count; recollection is not evidence.',
  );
  return lines.join('\n');
}
