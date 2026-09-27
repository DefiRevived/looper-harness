import fs from 'node:fs';
import path from 'node:path';

/**
 * Vendored local library set for agent builds.
 *
 * `scripts/fetch-libs.mjs` downloads pinned library files into ./libs and
 * writes libs/manifest.json; the server exposes that folder at /libs/* (no
 * API token, CORS-open, because sandboxed artifact previews load from an
 * opaque origin). Builds reference libraries with plain
 * `<script src="/libs/<file>">` tags — local, offline-safe, and consistent
 * with the no-CDN / no-external-fetches house rule.
 */

export interface LibEntry {
  name: string;
  version: string;
  file: string;
  global?: string;
  description: string;
  usage: string;
  bytes: number;
  sha256: string;
  source: string;
}

const manifestPath = path.resolve('libs', 'manifest.json');
let cache: { mtimeMs: number; libs: LibEntry[] } | null = null;

/** Vendored libraries from the manifest (cached by mtime; [] when not vendored). */
export function libManifest(): LibEntry[] {
  try {
    const stat = fs.statSync(manifestPath);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.libs;
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { libs?: LibEntry[] };
    const libs = Array.isArray(parsed.libs) ? parsed.libs : [];
    cache = { mtimeMs: stat.mtimeMs, libs };
    return libs;
  } catch {
    return cache?.libs ?? [];
  }
}

/** One-liner for prompt context: "three 0.159.0, gsap 3.12.5, …". */
export function libSummary(): string {
  const libs = libManifest();
  return libs.length ? libs.map((l) => `${l.name} ${l.version}`).join(', ') : 'none vendored';
}
