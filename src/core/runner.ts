/**
 * run_module — sandboxed execution of a build's own JS module ("receipts" for
 * tests and pure logic). Design verified on Node 24/Windows: the child runs
 * under Node's permission model with the filesystem scoped to the build
 * folder (reads AND writes), so harness secrets (looper.config.json, data
 * dir, .env) are unreadable; child processes, workers and native addons are
 * denied; the environment is scrubbed. Network sockets are NOT covered by the
 * permission model — but with the fs scoped there are no secrets to
 * exfiltrate, and the tool description says exactly that. If the sandbox
 * cannot be enforced on this platform/Node build, runBuildModule REFUSES by
 * default (fail closed); LOOPER_RUN_UNSANDBOXED=true is the operator's
 * explicit override.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const SANDBOX_FILE = ((): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const local = path.join(here, 'runSandbox.mjs');
  if (fs.existsSync(local)) return local;
  return path.join(process.cwd(), 'src', 'core', 'runSandbox.mjs');
})();

export const MAX_RUN_OUTPUT_CHARS = 64_000;
export const DEFAULT_TIMEOUT_S = 15;
export const MAX_TIMEOUT_S = 60;

interface SandboxSupport {
  flag: string | null;
  enforced: boolean;
}

let cached: SandboxSupport | null = null;

let esmDefaultFlagProbed: string | null | undefined;
/** Node's --experimental-default-type=module flag (lets ESM syntax live in .js). */
function esmDefaultFlag(): string | null {
  if (esmDefaultFlagProbed !== undefined) return esmDefaultFlagProbed;
  try {
    const res = spawnSync(process.execPath, ['--experimental-default-type=module', '-e', 'console.log("OK")'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    esmDefaultFlagProbed = out.includes('OK') && !/bad option/i.test(out) ? '--experimental-default-type=module' : null;
  } catch {
    esmDefaultFlagProbed = null;
  }
  return esmDefaultFlagProbed;
}

/** Probe once: does Node's permission model exist here, and does it actually enforce? */
export function sandboxSupport(): SandboxSupport {
  if (cached) return cached;
  const probe =
    "try{require('node:fs').readFileSync(process.execPath);console.log('NOT_ENFORCED')}catch(e){console.log('ENFORCED:'+(e.code||e.message))}";
  cached = { flag: null, enforced: false };
  for (const flag of ['--permission', '--experimental-permission']) {
    let res;
    try {
      res = spawnSync(process.execPath, [flag, '-e', probe], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    } catch {
      continue;
    }
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    if (/bad option/i.test(out)) continue; // this Node doesn't know the flag — try the other name
    if (out.includes('ENFORCED:')) {
      cached = { flag, enforced: true };
      break;
    }
    if (out.includes('NOT_ENFORCED')) break; // flag accepted but not enforced (platform) — fail closed
  }
  return cached;
}

export interface RunModuleResult {
  ok: boolean;
  refused?: string;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  ranMs: number;
  sandbox: 'enforced' | 'unguarded';
}

export function runBuildModule(folder: string, file: string, args: string[], timeoutS: number): Promise<RunModuleResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const support = sandboxSupport();
    if (!support.enforced && !config.runUnsandboxed) {
      resolve({
        ok: false,
        refused:
          'the Node sandbox (permission model) cannot be enforced on this platform/node build, so run_module refuses by default. ' +
          'The operator can allow unguarded runs with LOOPER_RUN_UNSANDBOXED=true in .env (accepting the risk).',
        exitCode: null,
        output: '',
        timedOut: false,
        ranMs: 0,
        sandbox: 'unguarded',
      });
      return;
    }
    const target = path.resolve(folder, file);
    const rel = path.relative(folder, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      resolve({ ok: false, refused: 'module path escapes the build folder.', exitCode: null, output: '', timedOut: false, ranMs: 0, sandbox: 'enforced' });
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      resolve({
        ok: false,
        refused: `no module "${file}" in this build — write it first (write_build_file).`,
        exitCode: null,
        output: '',
        timedOut: false,
        ranMs: 0,
        sandbox: 'enforced',
      });
      return;
    }
    if (!fs.existsSync(SANDBOX_FILE)) {
      resolve({ ok: false, refused: `sandbox runner missing on the host (${SANDBOX_FILE}).`, exitCode: null, output: '', timedOut: false, ranMs: 0, sandbox: 'enforced' });
      return;
    }

    const tmp = path.join(folder, '.tmp-run');
    fs.mkdirSync(tmp, { recursive: true });
    // ESM syntax inside a plain .js of a classic build (no package.json): Node
    // would treat it as CommonJS and fail on `import`/`export` — auto-switch.
    let esmExtra: string[] = [];
    if (/\.js$/i.test(file)) {
      try {
        if (/^\s*(import|export)\b/m.test(fs.readFileSync(target, 'utf8'))) {
          const flag = esmDefaultFlag();
          if (flag) esmExtra = [flag];
        }
      } catch {
        // unreadable file — the run below will report it
      }
    }
    const flags = support.enforced
      ? [support.flag as string, `--allow-fs-read=${folder}`, `--allow-fs-read=${SANDBOX_FILE}`, `--allow-fs-write=${folder}`, ...esmExtra]
      : esmExtra;
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      windir: process.env.windir ?? '',
      ComSpec: process.env.ComSpec ?? '',
      TEMP: tmp,
      TMP: tmp,
      NODE_OPTIONS: '',
      NODE_NO_WARNINGS: '1',
    };
    const child = spawn(process.execPath, [...flags, SANDBOX_FILE, target, ...args], {
      cwd: folder,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let timedOut = false;
    const cap = (chunk: Buffer): void => {
      out += chunk.toString('utf8');
      if (out.length > MAX_RUN_OUTPUT_CHARS) {
        out = `${out.slice(0, MAX_RUN_OUTPUT_CHARS / 2)}\n… [output truncated] …\n${out.slice(-MAX_RUN_OUTPUT_CHARS / 2)}`;
      }
    };
    child.stdout?.on('data', cap);
    child.stderr?.on('data', cap);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1, Math.round(timeoutS)) * 1000);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: -1,
        output: `could not start node: ${err.message}`,
        timedOut: false,
        ranMs: Date.now() - started,
        sandbox: support.enforced ? 'enforced' : 'unguarded',
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        output: out.trim(),
        timedOut,
        ranMs: Date.now() - started,
        sandbox: support.enforced ? 'enforced' : 'unguarded',
      });
    });
  });
}
