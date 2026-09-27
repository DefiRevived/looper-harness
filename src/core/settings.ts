/**
 * Operator configuration — the fixed bootstrap file `looper.config.json` at the
 * app root, plus live path resolution for everything the agent stores.
 *
 * All agent state lives on THIS machine, in the directories chosen at first-run
 * setup (or later via ⚙ settings):
 *   dataDir   — memory db, sessions, transcripts, caches  (LOOPER_DATA_DIR env overrides)
 *   buildsDir — builds and npm projects                   (LOOPER_BUILDS_DIR env overrides)
 *
 * Precedence: env var > looper.config.json > default (./data, <dataDir>/artifacts).
 * The file is re-read whenever its mtime/size changes and every storage module
 * resolves its paths per call — so a live data-directory switch just works, and
 * edits by another process (or a running server's API) are picked up without a
 * restart. The config file itself lives at the app root, never inside dataDir,
 * so it can bootstrap the choice of dataDir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';

export interface AppConfig {
  dataDir: string | null;
  buildsDir: string | null;
  setupComplete: boolean;
}

const CONFIG_FILE = path.resolve('looper.config.json');

let cache: { stamp: string; value: AppConfig } | null = null;

function stampOf(file: string): string {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

export function loadConfig(): AppConfig {
  const stamp = stampOf(CONFIG_FILE);
  if (cache && cache.stamp === stamp) return cache.value;
  let value: AppConfig = { dataDir: null, buildsDir: null, setupComplete: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as {
      dataDir?: unknown;
      buildsDir?: unknown;
      setupComplete?: unknown;
    };
    value = {
      dataDir: typeof parsed.dataDir === 'string' && parsed.dataDir.trim() ? path.normalize(parsed.dataDir.trim()) : null,
      buildsDir: typeof parsed.buildsDir === 'string' && parsed.buildsDir.trim() ? path.normalize(parsed.buildsDir.trim()) : null,
      setupComplete: parsed.setupComplete === true,
    };
  } catch {
    // missing or malformed — defaults
  }
  cache = { stamp, value };
  return value;
}

function writeConfig(value: AppConfig): void {
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(value, null, 2)}\n`);
  cache = { stamp: stampOf(CONFIG_FILE), value };
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

export interface DirInfo {
  effective: string;
  configured: string | null;
  envOverride: string | null;
  defaultPath: string;
  source: 'env' | 'settings' | 'default';
}

// --- data root (memory, sessions, transcripts, caches) -----------------------

/** The no-config default: `./data` (or LOOPER_DATA_DIR when set). */
export function defaultDataDir(): string {
  return config.dataDir;
}

export function envDataDir(): string | null {
  const raw = process.env.LOOPER_DATA_DIR?.trim();
  return raw ? resolveUserPath(raw) : null;
}

/** Effective agent data directory (env > settings > default). */
export function dataRoot(): string {
  return envDataDir() ?? loadConfig().dataDir ?? defaultDataDir();
}

/** Join a path under the CURRENT data root (resolved per call). */
export function dataPath(...segments: string[]): string {
  return path.join(dataRoot(), ...segments);
}

export function dataDirInfo(): DirInfo {
  const env = envDataDir();
  const configured = loadConfig().dataDir;
  const def = defaultDataDir();
  return {
    effective: env ?? configured ?? def,
    configured,
    envOverride: env,
    defaultPath: def,
    source: env ? 'env' : configured ? 'settings' : 'default',
  };
}

// --- builds root (builds + npm projects) -------------------------------------

export function defaultBuildsDir(): string {
  return path.join(dataRoot(), 'artifacts');
}

export function envBuildsDir(): string | null {
  const raw = process.env.LOOPER_BUILDS_DIR?.trim();
  return raw ? resolveUserPath(raw) : null;
}

/** Effective builds directory (env > settings > default). */
export function buildsRoot(): string {
  return envBuildsDir() ?? loadConfig().buildsDir ?? defaultBuildsDir();
}

export function buildsDirInfo(): DirInfo {
  const env = envBuildsDir();
  const configured = loadConfig().buildsDir;
  const def = defaultBuildsDir();
  return {
    effective: env ?? configured ?? def,
    configured,
    envOverride: env,
    defaultPath: def,
    source: env ? 'env' : configured ? 'settings' : 'default',
  };
}

// --- setup + persistence ------------------------------------------------------

export function setupComplete(): boolean {
  return loadConfig().setupComplete;
}

export interface SetupState {
  dataDir: DirInfo;
  buildsDir: DirInfo;
  setupComplete: boolean;
}

export function setupState(): SetupState {
  return { dataDir: dataDirInfo(), buildsDir: buildsDirInfo(), setupComplete: setupComplete() };
}

/** Validate + create + persist a directory choice. null/'' → back to default. */
function validateDir(raw: string, label: string): string {
  const resolved = resolveUserPath(raw);
  if (!resolved) {
    throw new Error(`use an absolute path for the ${label} directory (e.g. D:\\looper-data or /home/you/looper-data)`);
  }
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const probe = path.join(resolved, `.looper-write-test-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (err) {
    throw new Error(`can't use that ${label} directory: ${(err as Error).message}`);
  }
  return resolved;
}

/**
 * Apply a settings change; any subset of the fields may be provided.
 * Pass null to reset a directory to its default; setupComplete:true marks the
 * first-run wizard finished.
 */
export function applySettings(patch: { dataDir?: string | null; buildsDir?: string | null; setupComplete?: boolean }): SetupState {
  const current = loadConfig();
  const next: AppConfig = { ...current };
  if ('dataDir' in patch) next.dataDir = patch.dataDir ? validateDir(patch.dataDir, 'agent data') : null;
  if ('buildsDir' in patch) next.buildsDir = patch.buildsDir ? validateDir(patch.buildsDir, 'builds') : null;
  if ('setupComplete' in patch) next.setupComplete = patch.setupComplete === true;
  writeConfig(next);
  return setupState();
}
