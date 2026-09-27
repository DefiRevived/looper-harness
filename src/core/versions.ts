import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Build version archive — the undo net for the artifact system. Every
 * revision (update_build / edit_build / write_build_file / delete_build_file /
 * revert_build) archives the CURRENT state of the whole build folder first, so
 * nothing an operator approved is ever silently lost.
 * Keeps the most recent MAX_VERSIONS states per build.
 *
 * A version is a folder snapshot (<versions>/<session>/<buildId>/<ts>/ with the
 * whole file tree). Legacy single-file versions (<ts>.html / <ts>.svg) from the
 * one-document era are still listed, previewed and restorable.
 */
const versionsRoot = path.join(config.dataDir, 'versions');
const MAX_VERSIONS = 10;

/** Project-toolchain dirs — never snapshotted (node_modules is heavy; dist is derived from source). */
const MANAGED_NAMES = new Set(['node_modules', '.git', 'dist']);

function versionDir(sessionDir: string, buildId: string): string {
  return path.join(versionsRoot, sessionDir, buildId);
}

/** Walk files under a root → relative paths (recursive, managed dirs skipped). */
function walkFiles(root: string, base = root): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (MANAGED_NAMES.has(e.name)) continue;
    const full = path.join(base, e.name);
    if (e.isDirectory()) out.push(...walkFiles(root, full));
    else if (e.isFile()) out.push(path.relative(root, full));
  }
  return out;
}

function folderBytes(dir: string): number {
  return walkFiles(dir).reduce((sum, rel) => {
    try {
      return sum + fs.statSync(path.join(dir, rel)).size;
    } catch {
      return sum;
    }
  }, 0);
}

interface VersionEntry {
  ts: number;
  bytes: number;
  path: string;
  kind: 'file' | 'dir';
}

function versionEntries(sessionDir: string, buildId: string): VersionEntry[] {
  const dir = versionDir(sessionDir, buildId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: VersionEntry[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && /^\d+\.(html|svg)$/.test(e.name)) {
      const stat = fs.statSync(full);
      out.push({ ts: Number.parseInt(e.name, 10) || Math.round(stat.mtimeMs), bytes: stat.size, path: full, kind: 'file' });
    } else if (e.isDirectory() && /^\d+$/.test(e.name)) {
      out.push({ ts: Number.parseInt(e.name, 10), bytes: folderBytes(full), path: full, kind: 'dir' });
    }
  }
  return out.sort((a, b) => b.ts - a.ts); // newest first
}

/** Snapshot the build FOLDER as the next archived version (prunes to MAX_VERSIONS). */
export function archiveVersion(sessionDir: string, buildId: string, folder: string): void {
  const dir = versionDir(sessionDir, buildId);
  fs.mkdirSync(dir, { recursive: true });
  let ts = Date.now();
  while (fs.existsSync(path.join(dir, String(ts)))) ts++;
  const snapshot = path.join(dir, String(ts));
  fs.mkdirSync(snapshot, { recursive: true });
  for (const rel of walkFiles(folder)) {
    const dest = path.join(snapshot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(folder, rel), dest);
  }
  const entries = versionEntries(sessionDir, buildId);
  for (const stale of entries.slice(MAX_VERSIONS)) {
    fs.rmSync(stale.path, { recursive: true, force: true });
  }
}

export interface ArchivedVersion {
  ts: number;
  bytes: number;
}

/** Archived versions, newest first (index 1 in tooling = most recent prior state). */
export function listVersions(sessionDir: string, buildId: string): ArchivedVersion[] {
  return versionEntries(sessionDir, buildId).map((e) => ({ ts: e.ts, bytes: e.bytes }));
}

/** The full file set of archived version `index` (1-based, newest first). */
export function readVersionTree(sessionDir: string, buildId: string, index: number): Map<string, Buffer> | null {
  const entry = versionEntries(sessionDir, buildId)[index - 1];
  if (!entry) return null;
  const files = new Map<string, Buffer>();
  if (entry.kind === 'file') {
    try {
      files.set(entry.path.endsWith('.svg') ? 'index.svg' : 'index.html', fs.readFileSync(entry.path));
    } catch {
      return null;
    }
    return files;
  }
  for (const rel of walkFiles(entry.path)) {
    try {
      files.set(rel, fs.readFileSync(path.join(entry.path, rel)));
    } catch {
      // unreadable file — skip rather than fail the whole restore
    }
  }
  return files.size ? files : null;
}

/** Entry document of an archived version, for the console preview. */
export function readVersionEntry(
  sessionDir: string,
  buildId: string,
  index: number,
): { content: string; kind: 'file' | 'dir' } | null {
  const entry = versionEntries(sessionDir, buildId)[index - 1];
  if (!entry) return null;
  const tree = readVersionTree(sessionDir, buildId, index);
  if (!tree) return null;
  const name = tree.has('index.html')
    ? 'index.html'
    : tree.has('index.svg')
      ? 'index.svg'
      : [...tree.keys()].find((k) => /\.(html|svg)$/i.test(k)) ?? null;
  if (!name) return null;
  return { content: (tree.get(name) as Buffer).toString('utf8'), kind: entry.kind };
}

/** Snapshot dir of a folder version (for serving its subresources); null for legacy single-file versions. */
export function versionSnapshotDir(sessionDir: string, buildId: string, index: number): string | null {
  const entry = versionEntries(sessionDir, buildId)[index - 1];
  return entry && entry.kind === 'dir' ? entry.path : null;
}

/** Overwrite the build folder with a version's file tree — source files only; installed deps and dist are left in place. */
export function applyVersionTree(folder: string, tree: Map<string, Buffer>): void {
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    if (MANAGED_NAMES.has(e.name)) continue;
    fs.rmSync(path.join(folder, e.name), { recursive: true, force: true });
  }
  for (const [rel, buf] of tree) {
    const dest = path.join(folder, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
}

export function purgeVersions(sessionDir: string, buildId: string): void {
  fs.rmSync(versionDir(sessionDir, buildId), { recursive: true, force: true });
}
