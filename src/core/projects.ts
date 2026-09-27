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

function runNpm(args: string[], cwd: string, timeoutMs: number): Promise<NpmResult> {
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
      out += chunk.toString('utf8');
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

/** project_install — validate deps against the allowlist, then npm install them. */
export async function projectInstall(folder: string): Promise<{ ok: boolean; message: string }> {
  const check = checkPackage(folder);
  if (!check.ok) return { ok: false, message: `project_install rejected: ${check.problem}` };
  if (!check.deps.length) return { ok: false, message: 'project_install rejected: package.json lists no dependencies to install.' };

  return serialize(async () => {
    const res = await runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], folder, INSTALL_TIMEOUT_MS);
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
}

/** project_build — run the project's build (vite) with a relative base; dist/ is the site. */
export async function projectBuild(folder: string): Promise<{ ok: boolean; message: string }> {
  const check = checkPackage(folder);
  if (!check.ok) return { ok: false, message: `project_build rejected: ${check.problem}` };
  if (!fs.existsSync(path.join(folder, 'node_modules'))) {
    return { ok: false, message: 'project_build rejected: node_modules/ is missing — run project_install first.' };
  }

  return serialize(async () => {
    const res = await runNpm(['run', 'build', '--', '--base', './'], folder, BUILD_TIMEOUT_MS);
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
    return {
      ok: true,
      message:
        `Built dist/ (${dist.files.length} files, ${kb(dist.total)}) — this is the site the preview, verify_render and hosting use:\n${lines.join('\n')}\n` +
        'Run check_build (static) and verify_render (real render) on it now.',
    };
  });
}
