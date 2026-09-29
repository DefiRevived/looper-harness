/**
 * Text + tree diffing for builds (diff_build): compact line diffs with context,
 * pure functions, no dependencies. Caps keep huge or minified files from eating
 * memory: common prefix/suffix are trimmed first, and if the middle is still
 * enormous the file is summarized instead of diffed.
 */

export interface TextDiffResult {
  lines: string[];
  added: number;
  removed: number;
  truncated: boolean;
  summaryOnly?: string;
}

const MAX_MIDDLE_LINES = 2400; // combined middle (after prefix/suffix trim) we will diff
const MAX_HUNK_LINES = 160; // emitted diff lines per file

function clipLine(s: string): string {
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** Line diff (LCS) with 3 context lines around change blocks. */
export function diffText(aText: string, bText: string): TextDiffResult {
  const a = aText.split('\n');
  const b = bText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (!midA.length && !midB.length) return { lines: [], added: 0, removed: 0, truncated: false };
  if (midA.length + midB.length > MAX_MIDDLE_LINES) {
    return {
      lines: [],
      added: midB.length,
      removed: midA.length,
      truncated: true,
      summaryOnly: `change too large for a line diff (${midA.length} lines → ${midB.length} lines)`,
    };
  }

  const n = midA.length;
  const m = midB.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] =
        midA[i] === midB[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }

  interface Op {
    kind: ' ' | '-' | '+';
    text: string;
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ kind: ' ', text: midA[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
      ops.push({ kind: '-', text: midA[i] });
      i++;
    } else {
      ops.push({ kind: '+', text: midB[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: '-', text: midA[i] });
    i++;
  }
  while (j < m) {
    ops.push({ kind: '+', text: midB[j] });
    j++;
  }

  const added = ops.reduce((c, o) => c + (o.kind === '+' ? 1 : 0), 0);
  const removed = ops.reduce((c, o) => c + (o.kind === '-' ? 1 : 0), 0);

  const ctx = 3;
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].kind === ' ') continue;
    for (let x = Math.max(0, k - ctx); x <= Math.min(ops.length - 1, k + ctx); x++) keep[x] = true;
  }
  const out: string[] = [];
  let truncated = false;
  let skipping = false;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) {
      skipping = true;
      continue;
    }
    if (skipping) {
      out.push('  …');
      skipping = false;
    }
    const o = ops[k];
    out.push(`${o.kind === ' ' ? ' ' : o.kind} ${clipLine(o.text)}`);
    if (out.length >= MAX_HUNK_LINES) {
      truncated = true;
      out.push('  … [diff truncated]');
      break;
    }
  }
  return { lines: out, added, removed, truncated };
}

const TEXT_EXT = new Set(['html', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md', 'csv']);

function isText(rel: string, buf: Buffer): boolean {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
  if (!TEXT_EXT.has(ext)) return false;
  return !buf.subarray(0, 4096).includes(0);
}

export interface TreeFileDiff {
  rel: string;
  status: 'added' | 'removed' | 'changed' | 'binary';
  added: number;
  removed: number;
  bytesFrom: number;
  bytesTo: number;
  text?: TextDiffResult;
}

/** Per-file diff between two build snapshots (file maps). */
export function diffTrees(
  from: Map<string, Buffer>,
  to: Map<string, Buffer>,
): { files: TreeFileDiff[]; added: number; removed: number; changed: number; binary: number } {
  const rels = [...new Set([...from.keys(), ...to.keys()])].sort();
  const files: TreeFileDiff[] = [];
  for (const rel of rels) {
    const a = from.get(rel);
    const b = to.get(rel);
    if (a && !b) {
      files.push({ rel, status: 'removed', added: 0, removed: a.toString('utf8').split('\n').length, bytesFrom: a.length, bytesTo: 0 });
      continue;
    }
    if (!a && b) {
      files.push({ rel, status: 'added', added: b.toString('utf8').split('\n').length, removed: 0, bytesFrom: 0, bytesTo: b.length });
      continue;
    }
    if (!a || !b || a.equals(b)) continue;
    if (!isText(rel, a) || !isText(rel, b)) {
      files.push({ rel, status: 'binary', added: 0, removed: 0, bytesFrom: a.length, bytesTo: b.length });
      continue;
    }
    const d = diffText(a.toString('utf8'), b.toString('utf8'));
    files.push({ rel, status: 'changed', added: d.added, removed: d.removed, bytesFrom: a.length, bytesTo: b.length, text: d });
  }
  return {
    files,
    added: files.filter((f) => f.status === 'added').length,
    removed: files.filter((f) => f.status === 'removed').length,
    changed: files.filter((f) => f.status === 'changed').length,
    binary: files.filter((f) => f.status === 'binary').length,
  };
}
