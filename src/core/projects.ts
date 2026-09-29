/**
 * Node-project toolchain for builds — the "real project" tier above static
 * builds. A build folder that contains a package.json is a Node project:
 *
 *   package.json      dependencies (curated allowlist), scripts.build
 *   index.html        Vite entry at the root
 *   src/…             real ES-module source (import * as THREE from 'three')
 *   public/…          static assets copied by the bundler
 *   node_modules/     created by project_install — MANAGED, never served
 *   dist/             created by project_build  — the built site that is
 *                     served, rendered, verified and packed
 *
 * Policy (professional-harness defaults):
 *  - every dependency must come from PROJECT_ALLOWLIST (extend it here);
 *  - installs run with --ignore-scripts (no postinstall code execution);
 *  - one heavy job (install/build) at a time, serialized process-wide;
 *  - npm runs via the Node CLI (no shell) with the build folder as cwd;
 *  - builds run `npm run build -- --base ./` so the output works both under
 *    the artifact route and inside packed deploys (relative asset URLs).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Curated package allowlist. Names only — the agent picks sane majors.
 * Extending the platform = adding a name here (and keeping this list honest).
 */
export const PROJECT_ALLOWLIST: string[] = [
  // bundler + framework plugins
  'vite',
  'esbuild',
  '@vitejs/plugin-react',
  '@vitejs/plugin-vue',
  '@sveltejs/vite-plugin-svelte',
  // frameworks / views
  'react',
  'react-dom',
  'preact',
  'vue',
  'svelte',
  // web3 (Base)
  'ethers',
  'viem',
  'wagmi',
  '@wagmi/core',
  '@wagmi/connectors',
  // 3D + motion + media
  'three',
  'gsap',
  'framer-motion',
  'animejs',
  'howler',
  'p5',
  'matter-js',
  // data + charts
  'd3',
  'chart.js',
  'echarts',
  'lodash-es',
  'lodash',
  'dayjs',
  'clsx',
  'zustand',
  '@tanstack/react-query',
  // UI
  'tailwindcss',
  '@tailwindcss/vite',
  'lucide-react',
];

/** Short summary for prompts/messages. */
export function allowlistSummary(): string {
  const head = PROJECT_ALLOWLIST.slice(0, 16).join(', ');
  return `${head}, … (${PROJECT_ALLOWLIST.length} packages total)`;
}

const INSTALL_TIMEOUT_MS = 300_000;
const BUILD_TIMEOUT_MS = 240_000;
const VERSION_RE = /^(?:\^|~)?\d+(?:\.\d+){0,2}$/;

export function isProjectFolder(folder: string): boolean {
  return fs.existsSync(path.join(folder, 'package.json'));
}

interface PackageCheck {
  ok: boolean;
  problem?: string;
  deps: Array<{ name: string; range: string; dev: boolean }>;
  hasBuildScript: boolean;
}

/** Parse + validate a project's package.json (existence, deps, allowlist, build script). */
export function checkPackage(folder: string): PackageCheck {
  const file = path.join(folder, 'package.json');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: false, problem: 'no package.json in this build folder.', deps: [], hasBuildScript: false };
  }
  let pkg: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(raw) as typeof pkg;
  } catch (err) {
    return { ok: false, problem: `package.json is not valid JSON: ${(err as Error).message}`, deps: [], hasBuildScript: false };
  }
  const deps: Array<{ name: string; range: string; dev: boolean }> = [];
  for (const [list, dev] of [
    [pkg.dependencies ?? {}, false],
    [pkg.devDependencies ?? {}, true],
  ] as const) {
    for (const [name, range] of Object.entries(list)) {
      if (typeof range !== 'string') {
        return { ok: false, problem: `dependency "${name}" has a non-string version.`, deps: [], hasBuildScript: false };
      }
      if (!PROJECT_ALLOWLIST.includes(name)) {
        return {
          ok: false,
          problem: `dependency "${name}" is not in the project allowlist. Allowed: ${allowlistSummary()}. Remove it, or ask the operator to extend the allowlist (src/core/projects.ts).`,
          deps: [],
          hasBuildScript: false,
        };
      }
      if (!VERSION_RE.test(range.trim())) {
        return {
          ok: false,
          problem: `dependency "${name}" has unsupported version range "${range}" — use ^major[.minor[.patch]], ~… or an exact version (no git/file/url deps).`,
          deps: [],
          hasBuildScript: false,
        };
      }
      deps.push({ name, range, dev });
    }
  }
  const buildScript = typeof pkg.scripts?.build === 'string' ? pkg.scripts.build : '';
  if (!buildScript) {
    return { ok: false, problem: 'package.json needs a "build" script (e.g. "scripts": { "build": "vite build" }).', deps, hasBuildScript: false };
  }
  return { ok: true, deps, hasBuildScript: true };
}

/** Node-bundled npm CLI (avoids .cmd shell quirks on Windows). */
function npmCliPath(): string | null {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(cli) ? cli : null;
}

interface NpmResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

function runNpm(args: string[], cwd: string, timeoutMs: number, onOutput?: (chunk: string) => void): Promise<NpmResult> {
  return new Promise((resolve) => {
    const cli = npmCliPath();
    const child = cli
      ? spawn(process.execPath, [cli, ...args], { cwd, env: process.env })
      : spawn('npm', args, { cwd, env: process.env, shell: true });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const cap = (chunk: Buffer): void => {
      const text = chunk.toString('utf8');
      out += text;
      if (onOutput) onOutput(text);
      if (out.length > 200_000) out = out.slice(-200_000);
    };
    child.stdout?.on('data', cap);
    child.stderr?.on('data', cap);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output: out, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `could not start npm: ${err.message}`, timedOut: false });
    });
  });
}

function outputTail(output: string, lines = 25): string {
  const kept = output.trim().split('\n').slice(-lines).join('\n');
  return kept.length > 3000 ? `${kept.slice(-3000)}` : kept;
}

/** One heavy toolchain job at a time across the whole runtime. */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

// --- job registry (background installs/builds + job_status) -----------------

export interface JobSnapshot {
  id: string;
  kind: 'install' | 'build';
  state: 'queued' | 'running' | 'done';
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  ok?: boolean;
  message?: string;
  tail: string;
  /** How many not-yet-finished jobs were created before this one. */
  queueAhead: number;
}

interface JobInternal extends JobSnapshot {
  folder: string;
}

const jobs = new Map<string, JobInternal>();
let jobSeq = 0;

function newJob(kind: JobSnapshot['kind'], folder: string): JobInternal {
  const job: JobInternal = {
    id: `${kind}-${Date.now().toString(36)}-${(++jobSeq).toString(36)}`,
    kind,
    state: 'queued',
    createdAt: Date.now(),
    tail: '',
    queueAhead: 0,
    folder,
  };
  jobs.set(job.id, job);
  pruneJobs();
  return job;
}

function pruneJobs(): void {
  const finished = [...jobs.values()].filter((j) => j.state === 'done').sort((a, b) => b.createdAt - a.createdAt);
  for (const stale of finished.slice(12)) jobs.delete(stale.id);
}

function snapshotOf(job: JobInternal): JobSnapshot {
  const ahead = [...jobs.values()].filter((j) => j.state !== 'done' && j.createdAt < job.createdAt).length;
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    ok: job.ok,
    message: job.message,
    tail: job.tail,
    queueAhead: job.state === 'queued' ? ahead : 0,
  };
}

/** Snapshot of one job (or the latest one), plus active + recent lists. */
export function jobStatus(id?: string): { job?: JobSnapshot; active: JobSnapshot[]; recent: JobSnapshot[] } {
  const all = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  return {
    job: id ? (jobs.has(id) ? snapshotOf(jobs.get(id) as JobInternal) : undefined) : all.length ? snapshotOf(all[0]) : undefined,
    active: all.filter((j) => j.state !== 'done').map(snapshotOf),
    recent: all.filter((j) => j.state === 'done').slice(0, 4).map(snapshotOf),
  };
}

/** Run a heavy job either in the background (job id returned immediately) or awaited. */
function enqueueJob<T extends { ok: boolean; message: string }>(
  kind: JobSnapshot['kind'],
  folder: string,
  background: boolean,
  run: (tail: (chunk: string) => void) => Promise<T>,
): Promise<{ result: T | null; job: JobInternal }> {
  const job = newJob(kind, folder);
  const tail = (chunk: string): void => {
    job.tail = `${job.tail}${chunk}`.slice(-5000);
  };
  const started = serialize(async () => {
    job.state = 'running';
    job.startedAt = Date.now();
    try {
      const result = await run(tail);
      job.state = 'done';
      job.ok = result.ok;
      job.message = result.message;
      job.endedAt = Date.now();
      return result;
    } catch (err) {
      job.state = 'done';
      job.ok = false;
      job.message = `job crashed: ${(err as Error).message}`;
      job.endedAt = Date.now();
      return { ok: false, message: job.message } as unknown as T;
    }
  });
  if (background) {
    void started.then(() => undefined);
    return Promise.resolve({ result: null, job });
  }
  return started.then((result) => ({ result, job }));
}

/** Human-readable job status (job_status tool). */
export function jobStatusText(id?: string): string {
  const { job, active, recent } = jobStatus(id);
  const fmt = (j: JobSnapshot): string => {
    const elapsed = (j.state === 'done' ? (j.endedAt ?? Date.now()) : Date.now()) - (j.startedAt ?? j.createdAt);
    const state = j.state === 'done' ? (j.ok ? 'done ✓' : 'FAILED ✗') : j.state;
    const queue = j.state === 'queued' && j.queueAhead ? ` · ${j.queueAhead} ahead in queue` : '';
    return `- ${j.id} [${state}] ${Math.max(0, Math.round(elapsed / 1000))}s${queue}`;
  };
  if (id && !job) {
    return `job_status: no job with id "${id}" in this process (jobs are in-memory — a server restart clears them).`;
  }
  if (!job && !active.length && !recent.length) {
    return 'No toolchain jobs yet. project_install / project_build create one — run them with background:true to get the job id immediately.';
  }
  const lines: string[] = [];
  if (job) {
    lines.push(`JOB ${job.id} (${job.kind})`, fmt(job));
    if (job.state === 'done' && job.message) lines.push(`- result: ${job.message}`);
    if (job.tail && job.state !== 'done') {
      const tail = job.tail.trim().split('\n').slice(-15);
      if (tail.length) lines.push(`- output tail:\n${tail.join('\n')}`);
    }
    if (!id && job.state === 'done' && job.tail) {
      const tail = job.tail.trim().split('\n').slice(-8);
      if (tail.length) lines.push(`- last output:\n${tail.join('\n')}`);
    }
  }
  const others = active.filter((j) => j.id !== job?.id);
  if (others.length) lines.push('active jobs:', ...others.map(fmt));
  if (!id && recent.length) lines.push('recent:', ...recent.map(fmt));
  return lines.join('\n');
}

function countInstalled(folder: string): number {
  let count = 0;
  const nm = path.join(folder, 'node_modules');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(nm, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (e.name.startsWith('@')) {
      try {
        count += fs.readdirSync(path.join(nm, e.name)).length;
      } catch {
        // scope unreadable — skip
      }
    } else {
      count++;
    }
  }
  return count;
}

/** Walk a folder into relative paths + sizes (recursive). */
function walk(root: string, base = root): Array<{ rel: string; bytes: number }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<{ rel: string; bytes: number }> = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(base, e.name);
    if (e.isDirectory()) out.push(...walk(root, full));
    else if (e.isFile()) {
      try {
        out.push({ rel: path.relative(root, full).split(path.sep).join('/'), bytes: fs.statSync(full).size });
      } catch {
        // vanished mid-walk
      }
    }
  }
  return out;
}

/** Built output summary (null when dist/ is missing). */
export function projectDistInfo(folder: string): { files: Array<{ rel: string; bytes: number }>; total: number } | null {
  const dist = path.join(folder, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) return null;
  const files = walk(dist);
  return { files, total: files.reduce((n, f) => n + f.bytes, 0) };
}

/** The most recent ACTIVE job for a folder — lets the preview dedupe auto-builds. */
export function activeJobFor(folder: string): JobSnapshot | null {
  const active = [...jobs.values()]
    .filter((j) => j.folder === folder && j.state !== 'done')
    .sort((a, b) => b.createdAt - a.createdAt);
  return active.length ? snapshotOf(active[0]) : null;
}

/** The most recent FINISHED job for a folder — the preview page reports its outcome. */
export function lastJobFor(folder: string): JobSnapshot | null {
  const done = [...jobs.values()]
    .filter((j) => j.folder === folder && j.state === 'done')
    .sort((a, b) => b.createdAt - a.createdAt);
  return done.length ? snapshotOf(done[0]) : null;
}

/**
 * Warning lines from build output. A build can succeed while still shipping a
 * real defect (an invalid CSS selector that browsers silently drop, a dangling
 * import) — those only ever showed up in the raw log, which the agent never
 * read. Surface them alongside the success.
 */
export function buildWarnings(output: string): string[] {
  const seen = new Set<string>();
  for (const line of output.split('\n')) {
    const t = line.trim();
    if (!t || !/\[WARNING\]|^\(!\)|warning:/i.test(t)) continue;
    seen.add(t.slice(0, 160));
  }
  return [...seen].slice(0, 6);
}

/** project_install — validate deps against the allowlist, then npm install them. */
export async function projectInstall(
  folder: string,
  opts: { background?: boolean } = {},
): Promise<{ ok: boolean; message: string; jobId?: string }> {
  const check = checkPackage(folder);
  if (!check.ok) return { ok: false, message: `project_install rejected: ${check.problem}` };
  if (!check.deps.length) return { ok: false, message: 'project_install rejected: package.json lists no dependencies to install.' };

  const { result, job } = await enqueueJob('install', folder, opts.background === true, async (tail) => {
    const res = await runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], folder, INSTALL_TIMEOUT_MS, tail);
    if (res.timedOut) {
      return { ok: false, message: `project_install timed out after ${INSTALL_TIMEOUT_MS / 1000}s and was killed. Check the dependency versions, or retry.` };
    }
    if (res.code !== 0) {
      return { ok: false, message: `project_install failed (npm exit ${res.code}). Nothing usable was installed:\n${outputTail(res.output)}` };
    }
    const installed = countInstalled(folder);
    const list = check.deps.map((d) => `${d.name}${d.range.startsWith('^') ? '' : `@${d.range}`}`).join(', ');
    return {
      ok: true,
      message: `Installed ${installed} packages into node_modules/ (npm install --ignore-scripts): ${list}. Next: project_build bundles the site into dist/.`,
    };
  });
  if (!result) {
    return {
      ok: true,
      message: `project_install started in the background (job ${job.id}). Poll job_status for progress and output — the final result shows up there.`,
      jobId: job.id,
    };
  }
  return result;
}

/** project_build — run the project's build (vite) with a relative base; dist/ is the site. */
export async function projectBuild(
  folder: string,
  opts: { background?: boolean } = {},
): Promise<{ ok: boolean; message: string; jobId?: string }> {
  const check = checkPackage(folder);
  if (!check.ok) return { ok: false, message: `project_build rejected: ${check.problem}` };
  if (!fs.existsSync(path.join(folder, 'node_modules'))) {
    return { ok: false, message: 'project_build rejected: node_modules/ is missing — run project_install first.' };
  }

  const { result, job } = await enqueueJob('build', folder, opts.background === true, async (tail) => {
    const res = await runNpm(['run', 'build', '--', '--base', './'], folder, BUILD_TIMEOUT_MS, tail);
    if (res.timedOut) {
      return { ok: false, message: `project_build timed out after ${BUILD_TIMEOUT_MS / 1000}s and was killed. Fix the build error (or simplify) and retry.` };
    }
    if (res.code !== 0) {
      return { ok: false, message: `project_build failed (exit ${res.code}) — fix the source and run it again:\n${outputTail(res.output)}` };
    }
    const dist = projectDistInfo(folder);
    if (!dist) {
      return {
        ok: false,
        message: `project_build finished but produced no dist/index.html. Is the build script really a site build (e.g. "vite build")? Output:\n${outputTail(res.output, 12)}`,
      };
    }
    const kb = (n: number): string => (n < 10 * 1024 ? `${n} B` : `${(n / 1024).toFixed(1)}KB`);
    const lines = dist.files.slice(0, 12).map((f) => `  ${f.rel} ${kb(f.bytes)}`);
    if (dist.files.length > 12) lines.push(`  … +${dist.files.length - 12} more`);
    const warnings = buildWarnings(res.output);
    return {
      ok: true,
      message:
        `Built dist/ (${dist.files.length} files, ${kb(dist.total)}) — this is the site the preview, verify_render and hosting use:\n${lines.join('\n')}\n` +
        (warnings.length
          ? `⚠ build warnings — the site built, but these are usually REAL defects, not noise (fix them, then rebuild):\n${warnings.map((w) => `  ${w}`).join('\n')}\n`
          : '') +
        'Run check_build (static) and verify_render (real render) on it now.',
    };
  });
  if (!result) {
    return {
      ok: true,
      message: `project_build started in the background (job ${job.id}). Poll job_status — when it reports done ✓ the new dist/ is being served and you can check_build / verify_render.`,
      jobId: job.id,
    };
  }
  return result;
}
