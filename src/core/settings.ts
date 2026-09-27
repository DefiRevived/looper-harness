/**
 * Operator settings — persisted to `data/settings.json`, editable from the
 * console's ⚙ settings panel or over the API.
 *
 * Precedence for the builds directory (where builds and npm projects live):
 *   LOOPER_BUILDS_DIR (env)  >  settings.json `buildsDir`  >  <dataDir>/artifacts
 *
 * The file is re-read whenever its mtime/size changes, so edits made by another
 * process (or the API of a running server) are picked up without a restart.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';

export interface Settings {
  buildsDir: string | null;
}

const SETTINGS_FILE = path.join(config.dataDir, 'settings.json');

let cache: { stamp: string; value: Settings } | null = null;

function stampOf(file: string): string {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

export function loadSettings(): Settings {
  const stamp = stampOf(SETTINGS_FILE);
  if (cache && cache.stamp === stamp) return cache.value;
  let value: Settings = { buildsDir: null };
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as { buildsDir?: unknown };
    if (typeof parsed.buildsDir === 'string' && parsed.buildsDir.trim()) {
      value = { buildsDir: parsed.buildsDir.trim() };
    }
  } catch {
    // missing or malformed — defaults
  }
  cache = { stamp, value };
  return value;
}

function writeSettings(value: Settings): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(value, null, 2)}\n`);
  cache = { stamp: stampOf(SETTINGS_FILE), value };
}

/** Expand `~`, then require an absolute path. Returns null when invalid. */
export function resolveUserPath(raw: string): string | null {
  let value = String(raw ?? '').trim();
  if (!value) return null;
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1));
  }
  if (!path.isAbsolute(value)) return null;
  return path.normalize(value);
}

export function defaultBuildsDir(): string {
  return path.join(config.dataDir, 'artifacts');
}

export function envBuildsDir(): string | null {
  const raw = process.env.LOOPER_BUILDS_DIR?.trim();
  return raw ? resolveUserPath(raw) : null;
}

/** Effective builds directory (env > settings > default). */
export function buildsRoot(): string {
  return envBuildsDir() ?? loadSettings().buildsDir ?? defaultBuildsDir();
}

export interface BuildsDirInfo {
  effective: string;
  configured: string | null;
  envOverride: string | null;
  defaultPath: string;
  source: 'env' | 'settings' | 'default';
}

export function buildsDirInfo(): BuildsDirInfo {
  const env = envBuildsDir();
  const configured = loadSettings().buildsDir;
  const def = defaultBuildsDir();
  return {
    effective: env ?? configured ?? def,
    configured,
    envOverride: env,
    defaultPath: def,
    source: env ? 'env' : configured ? 'settings' : 'default',
  };
}

/**
 * Validate + create + persist a new builds directory.
 * Pass null/'' to reset to the default. Throws with a friendly message.
 */
export function setBuildsDir(raw: string | null): BuildsDirInfo {
  const value = String(raw ?? '').trim();
  if (!value) {
    writeSettings({ ...loadSettings(), buildsDir: null });
    return buildsDirInfo();
  }
  const resolved = resolveUserPath(value);
  if (!resolved) {
    throw new Error('use an absolute path (e.g. D:\\looper-builds or /home/you/looper-builds)');
  }
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const probe = path.join(resolved, `.looper-write-test-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (err) {
    throw new Error(`can't use that directory: ${(err as Error).message}`);
  }
  writeSettings({ ...loadSettings(), buildsDir: resolved });
  return buildsDirInfo();
}
