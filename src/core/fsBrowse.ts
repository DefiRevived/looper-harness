/**
 * Local folder browsing for the console's folder picker.
 *
 * A browser cannot reveal absolute OS paths, so the LOCAL server walks the
 * operator's real filesystem instead — read-only listings, same trust model
 * as /api/settings (local-first; behind the API token when one is set).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUserPath } from './settings.js';

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirListing {
  /** The directory being listed (normalized absolute path). */
  path: string;
  /** Parent directory — null at a filesystem root. */
  parent: string | null;
  /** Subdirectories, case-insensitive alphabetical. */
  entries: DirEntry[];
  /** Quick jumps: existing drive letters (Windows) or '/', plus the home folder. */
  roots: DirEntry[];
  /** The OS home directory. */
  home: string;
  /** True when a very large folder listing was capped. */
  truncated: boolean;
}

const MAX_ENTRIES = 500;

/** Existing drives (Windows) or '/' — the picker's quick jumps. */
function browseRoots(): DirEntry[] {
  const roots: DirEntry[] = [];
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c += 1) {
      const drive = `${String.fromCharCode(c)}:\\`;
      try {
        if (fs.statSync(drive).isDirectory()) roots.push({ name: drive, path: drive });
      } catch {
        // drive not present — skip
      }
    }
  } else {
    roots.push({ name: '/', path: '/' });
  }
  return roots;
}

/**
 * Read-only listing of one folder's subfolders. With no path, starts at the
 * OS home directory. Bad input throws a human-readable message.
 */
export function listDirectories(rawPath?: string): DirListing {
  const raw = String(rawPath ?? '').trim();
  const home = os.homedir();
  let target = home;
  if (raw) {
    const resolved = resolveUserPath(raw);
    if (!resolved) throw new Error('path must be an absolute folder path (or ~ for your home folder)');
    target = resolved;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error(`folder not found: ${target}`);
  }
  if (!stat.isDirectory()) throw new Error(`not a folder: ${target}`);

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    throw new Error(`cannot read ${target} — ${(err as Error).message}`);
  }

  const entries: DirEntry[] = [];
  let truncated = false;
  for (const dirent of dirents) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    let isDir = dirent.isDirectory();
    if (!isDir && dirent.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(target, dirent.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    entries.push({ name: dirent.name, path: path.join(target, dirent.name) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parent = path.dirname(target);
  const roots = browseRoots();
  if (!roots.some((r) => path.normalize(r.path) === path.normalize(home))) {
    roots.push({ name: 'home', path: home });
  }
  return {
    path: target,
    parent: parent === target ? null : parent,
    entries,
    roots,
    home,
    truncated,
  };
}

const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Create ONE folder inside an existing one, for the picker's ＋ new folder
 * action. Single level on purpose (the listed folder IS the parent); names
 * with path separators or Windows-illegal characters are rejected.
 * Returns the new folder's absolute path.
 */
export function createDirectory(rawParent: string, rawName: string): { path: string } {
  const parent = resolveUserPath(String(rawParent ?? '').trim());
  if (!parent) throw new Error('open a folder first — a new one is created inside the folder being listed');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(parent);
  } catch {
    throw new Error(`folder not found: ${parent}`);
  }
  if (!stat.isDirectory()) throw new Error(`not a folder: ${parent}`);

  const name = String(rawName ?? '').trim();
  if (!name) throw new Error('type a folder name first');
  if (name.length > 64) throw new Error('folder names are limited to 64 characters');
  if (name === '.' || name === '..') throw new Error(`"${name}" is not a valid folder name`);
  if (INVALID_NAME_CHARS.test(name)) throw new Error('folder names cannot contain \\ / : * ? " < > | or control characters');
  if (/[. ]$/.test(name)) throw new Error('folder names cannot end with a dot or a space');
  if (RESERVED_WINDOWS_NAME.test(name)) throw new Error(`"${name}" is a reserved Windows name — pick something else`);

  const target = path.join(parent, name);
  try {
    fs.mkdirSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`"${name}" already exists in ${parent}`);
    throw new Error(`couldn't create "${name}" — ${(err as Error).message}`);
  }
  return { path: target };
}
