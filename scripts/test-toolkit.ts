/**
 * Smoke test for the expanded toolkit: check_build (static scan),
 * remember/recall (long-term memory roundtrip, isolated token id), and
 * delete_build (scratch session — never touches real builds).
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall } from '../src/core/tools.js';

const ctx = { sessionKey: 'web:452', surface: 'web' as const, tokenId: 452 };
const call = (name: string, args: Record<string, unknown>) =>
  executeToolCall({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }, ctx);

console.log('===== check_build: static scan =====');
const sampleBuild = process.env.SMOKE_BUILD_ID ?? '';
if (sampleBuild) {
  console.log((await call('check_build', { build_id: sampleBuild })).modelText);
} else {
  console.log('(set SMOKE_BUILD_ID=<a build id from list_builds> to scan a real build — skipping)');
}

console.log('\n===== remember/recall =====');
console.log('(now ReMEM-backed — covered by scripts/test-memory-locks.ts)');

console.log('\n===== delete_build roundtrip (scratch session) =====');
const dir = path.join('data', 'artifacts', 'web_smoke');
fs.mkdirSync(dir, { recursive: true });
const tempId = '1790000000000-smoke-test';
fs.mkdirSync(path.join(dir, tempId), { recursive: true });
fs.writeFileSync(path.join(dir, tempId, 'index.html'), '<!DOCTYPE html><html><body>smoke</body></html>');
const sctx = { sessionKey: 'web:smoke', surface: 'web' as const, tokenId: 999999 };
const del = await executeToolCall(
  { id: 'del', type: 'function', function: { name: 'delete_build', arguments: JSON.stringify({ build_id: tempId }) } },
  sctx,
);
console.log(`${del.modelText} | deleted field = ${del.deleted}`);
console.log('file exists after delete:', fs.existsSync(path.join(dir, tempId)));
fs.rmSync(dir, { recursive: true, force: true });
console.log('(cleaned up scratch session dir)');
