// Sandboxed module runner for run_module — spawned as a CHILD process under
// Node's permission model. Keep this file dependency-free and side-effect-light.
// argv: [module-path, ...args]. A default-exported function is called with the
// args; otherwise the module simply executes on import. stdout/stderr are the
// receipts the agent reads.
import { pathToFileURL } from 'node:url';

const target = process.argv[2];
const args = process.argv.slice(3);

try {
  const mod = await import(pathToFileURL(target).href);
  const fn = mod && typeof mod.default === 'function' ? mod.default : null;
  if (fn) {
    const result = await fn(...args);
    if (result !== undefined) {
      console.log('[run_module] returned:', typeof result === 'string' ? result : JSON.stringify(result));
    }
  } else {
    console.log('[run_module] module loaded and executed (no default-exported function to call).');
  }
  console.log('[run_module] exit: ok');
} catch (err) {
  console.error('[run_module] uncaught error:');
  console.error(err && err.stack ? err.stack : String(err));
  console.log('[run_module] exit: error');
  process.exitCode = 1;
}
