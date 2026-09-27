/**
 * Headless-render smoke test. Proves the agent's new eyes work:
 *  1. verify_render on a known-good visual build → HTTP 200, no JS errors,
 *     clean verdict, pixel stats, screenshot saved to disk.
 *  2. verify_render on a deliberately broken build (throws on load) → the
 *     uncaught error is DETECTED and the verdict flags issues.
 * Run (dev server must be up on :4520): node_modules\.bin\tsx.cmd scripts\test-render.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { executeToolCall, listArtifacts } from '../src/core/tools.js';
import { config } from '../src/core/config.js';
import { buildsRoot } from '../src/core/settings.js';
import type { ToolCall } from '../src/core/llm.js';

const TOKEN = 452;
const PARENT = `web:${TOKEN}`;
let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

const call = (name: string, args: Record<string, unknown>): Promise<{ modelText: string }> =>
  executeToolCall(
    { id: 'test', type: 'function', function: { name, arguments: JSON.stringify(args) } } as ToolCall,
    { sessionKey: PARENT, surface: 'web', tokenId: TOKEN },
  );

// --- 1. a real build the operator has: prefer the WebGL torus, else snake, else any html.
const builds = listArtifacts(PARENT);
const pick =
  builds.find((b) => b.kind === 'html' && /torus/i.test(b.title)) ??
  builds.find((b) => b.kind === 'html' && /snake/i.test(b.title)) ??
  builds.find((b) => b.kind === 'html');
check('found an html build to render', Boolean(pick), pick ? `${pick.id} (${pick.title})` : 'none');
if (!pick) process.exit(1);

const good = await call('verify_render', { build_id: pick.id });
console.log('\n--- verify_render: known-good build ---');
console.log(good.modelText);
console.log('');
check('good build: loaded (HTTP 200)', /HTTP 200/.test(good.modelText));
check('good build: no uncaught JS errors', /uncaught JS errors: NONE/.test(good.modelText));
check('good build: clean verdict', /RENDERED CLEAN/.test(good.modelText));
check('good build: pixel stats present', /% of the frame differs from the dominant color/.test(good.modelText));
const shot = good.modelText.match(/screenshot saved for the operator: (.+\.png)/);
check('good build: screenshot exists on disk', Boolean(shot) && fs.existsSync(shot![1]), shot?.[1] ?? 'no path in report');

// --- 2. a deliberately broken build: must be caught, not reported clean.
const dir = path.join(buildsRoot(), `web_${TOKEN}`);
const brokenId = `${Date.now()}-broken-render-test`;
const brokenFolder = path.join(dir, brokenId);
fs.mkdirSync(brokenFolder, { recursive: true });
fs.writeFileSync(
  path.join(brokenFolder, 'index.html'),
  '<!doctype html><html><head><title>broken render test</title></head><body><h1>should be visible</h1><script>throw new Error("boom-render-test");</script></body></html>',
);
const bad = await call('verify_render', { build_id: brokenId });
console.log('--- verify_render: deliberately broken build ---');
console.log(bad.modelText);
console.log('');
check('broken build: uncaught error detected', /boom-render-test/.test(bad.modelText));
check('broken build: verdict flags issues', /RENDERED WITH ISSUES/.test(bad.modelText));
check('broken build: not reported clean', !/RENDERED CLEAN/.test(bad.modelText));
fs.rmSync(brokenFolder, { recursive: true, force: true });

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall render checks passed');
process.exit(fails ? 1 : 0);
