/**
 * pack-build — package one build as a self-sufficient static site folder,
 * one folder per build, ready for hosting (e.g. `vercel deploy --prod`).
 *
 *   npm run pack-build -- <build-id> [--session web:<tokenId>]
 *
 * What it does:
 *   1. reads the build folder from the builds directory (default data/artifacts)
 *   2. copies the WHOLE project tree (multi-file builds: index.html + css/ +
 *      js/ + assets/…; single-document builds work the same), resolving
 *      {{looper-image:ID}} placeholders IN-PROCESS in every text file (same
 *      resolver as the runtime — the packaged site needs no runtime at all)
 *   3. strips the wallet shim tag if present (hosting gets a real page, not a
 *      sandboxed preview)
 *   4. extracts every embedded image data URI into a real file (deduplicated
 *      by content hash) and rewrites references relative to each file
 *   5. copies every /libs/<file> any file references into <out>/libs/
 *
 * Output: deploy/<slug>/ mirroring the project tree + libs/.
 * The folder PERSISTS across packs (it may hold .vercel/ project link state);
 * only files the packer owns (the project tree, img-*, referenced libs) are
 * written, and stale packer files are pruned. Deploy from inside the folder —
 * the folder name is the Vercel project name.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveLooperImages } from '../src/core/looperAssets.js';
import { sessionDirName } from '../src/core/tools.js';
import { config } from '../src/core/config.js';
import { buildsRoot } from '../src/core/settings.js';

const args = process.argv.slice(2);
const sessionIdx = args.indexOf('--session');
const session =
  sessionIdx >= 0 ? (args[sessionIdx + 1] ?? '') : config.defaultTokenId > 0 ? `web:${config.defaultTokenId}` : '';
const buildId = args.find((a, i) => !a.startsWith('--') && (sessionIdx < 0 || i !== sessionIdx + 1));

if (!buildId || !/^[0-9]+-[a-z0-9-]{1,80}$/.test(buildId)) {
  console.error('usage: npm run pack-build -- <build-id> [--session web:<tokenId>]');
  console.error('       (build-id looks like 1790381091094-my-build — a folder under the builds directory; see the ⚙ settings + builds tab)');
  process.exit(1);
}
if (!session) {
  console.error('no session — set LOOPER_TOKEN_ID in .env or pass --session web:<tokenId>');
  process.exit(1);
}

const dirName = sessionDirName(session);
const folder = path.join(buildsRoot(), dirName, buildId);
// Node project builds (package.json) are hosted from their BUILT dist/.
const isProject = fs.existsSync(path.join(folder, 'package.json'));
const siteRoot = isProject ? path.join(folder, 'dist') : folder;
const buildHtml = path.join(siteRoot, 'index.html');
if (!fs.existsSync(buildHtml)) {
  console.error(
    isProject
      ? `${buildId} is a Node project with no built dist/ — run project_build first (missing ${buildHtml}).`
      : fs.existsSync(path.join(folder, 'index.svg'))
        ? `${buildId} is an SVG build — hosting wants an HTML entry point; not packaged.`
        : `not found: ${buildHtml}`,
  );
  process.exit(1);
}

const slug = buildId.replace(/^[0-9]+-/, '');
const outDir = path.resolve('deploy', slug);
fs.mkdirSync(outDir, { recursive: true });

const TEXT_EXT = new Set(['html', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md', 'csv']);
const EXT: Record<string, string> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp', 'svg+xml': 'svg' };

/** Walk files under a root → relative paths. */
function walk(root: string, base = root): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, e.name);
    if (e.isDirectory()) out.push(...walk(root, full));
    else if (e.isFile()) out.push(path.relative(root, full));
  }
  return out;
}

/** Packer-owned files written this run (anything else in the output folder is pruned). */
const written = new Set<string>();
const assets = new Map<string, { file: string; bytes: number; buf: Buffer }>();
const libRefs = new Set<string>();
const fileList = walk(siteRoot);

console.log(`packing ${buildId} — ${fileList.length} file${fileList.length === 1 ? '' : 's'}${isProject ? ' (node project · dist/)' : ''}`);

for (const rel of fileList) {
  const src = path.join(siteRoot, rel);
  const relPosix = rel.split(path.sep).join('/');
  const ext = path.extname(rel).slice(1).toLowerCase();
  const dest = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (!TEXT_EXT.has(ext)) {
    fs.copyFileSync(src, dest); // binary file — copied raw
    written.add(relPosix);
    continue;
  }

  let body = fs.readFileSync(src, 'utf8');

  // 1. resolve {{looper-image:ID}} placeholders IN-PROCESS (same resolver as the runtime).
  if (body.includes('{{looper-image:')) body = await resolveLooperImages(body);

  // 2. a hosted page must not load the preview wallet shim (it would postMessage into nowhere).
  body = body.replace(/\n?<script src="\/looper-wallet\.js[^"]*"><\/script>/g, '');

  // 3. images: dedupe by content hash → real files at the pack root, rewriting the
  //    reference RELATIVE to the file that contained it (css/ needs "../img-…").
  const depth = relPosix.split('/').length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  body = body.replace(/data:image\/([a-z0-9+]+);base64,([A-Za-z0-9+/=]+)/gi, (_m, subtype: string, b64: string) => {
    const buf = Buffer.from(b64, 'base64');
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10);
    const assetExt = EXT[subtype.toLowerCase()] ?? 'bin';
    const file = `img-${hash}.${assetExt}`;
    if (!assets.has(hash)) assets.set(hash, { file, bytes: buf.length, buf });
    return `${prefix}${file}`;
  });

  // 4. note every /libs/<file> reference (copied after the walk, when the set is complete).
  for (const m of body.matchAll(/\/libs\/([A-Za-z0-9_.-]+)/g)) libRefs.add(m[1]);

  fs.writeFileSync(dest, body);
  written.add(relPosix);
}

// extracted images at the pack root
for (const a of assets.values()) {
  fs.writeFileSync(path.join(outDir, a.file), a.buf);
  written.add(a.file);
}

// 5. copy every referenced /libs/<file> that actually exists.
const copiedLibs: string[] = [];
const missingLibs: string[] = [];
for (const f of libRefs) {
  if (fs.existsSync(path.resolve('libs', f))) {
    fs.mkdirSync(path.join(outDir, 'libs'), { recursive: true });
    fs.copyFileSync(path.resolve('libs', f), path.join(outDir, 'libs', f));
    written.add(`libs/${f}`);
    copiedLibs.push(f);
  } else {
    missingLibs.push(f);
  }
}

// prune stale packer-owned files (previous tree files, old img-*, libs) while
// keeping dotfiles such as .vercel/ project link state.
function prune(base: string, relBase = ''): void {
  for (const e of fs.readdirSync(base, { withFileTypes: true })) {
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    const full = path.join(base, e.name);
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      prune(full, rel);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } else if (!written.has(rel)) {
      fs.unlinkSync(full);
    }
  }
}
prune(outDir);

const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`;
console.log('');
for (const rel of fileList) {
  console.log(`  ${rel.split(path.sep).join('/')}  ${kb(fs.statSync(path.join(siteRoot, rel)).size)}`);
}
for (const a of assets.values()) console.log(`  ${a.file}  ${kb(a.bytes)}  (extracted from a data URI)`);
for (const f of copiedLibs) console.log(`  libs/${f}  ${kb(fs.statSync(path.resolve('libs', f)).size)}`);
if (missingLibs.length) console.log(`  ⚠ referenced but not vendored: ${missingLibs.join(', ')} — run \`npm run libs\` or fix the page`);
// 6. fail loudly if any REAL placeholder survived — a hosted page cannot resolve
//    {{looper-image:…}} at runtime, so a residual one ships as a broken image.
const unresolved: string[] = [];
for (const rel of written) {
  if (!TEXT_EXT.has(path.extname(rel).slice(1).toLowerCase())) continue;
  try {
    const body = fs.readFileSync(path.join(outDir, rel), 'utf8');
    const n = (body.match(/\{\{looper-image:\d+\}\}/g) ?? []).length;
    if (n) unresolved.push(`${rel} (${n})`);
  } catch {
    // unreadable — not our problem here
  }
}
if (unresolved.length) {
  console.log(`  ⚠ UNRESOLVED placeholders survived the pack: ${unresolved.join(', ')} — those images will be broken on the host; repack (token id missing or fetch failed at pack time)`);
}
console.log(`\npacked ${buildId} → ${path.relative(process.cwd(), outDir)}\\ (${written.size} files)`);
console.log(`\nhost it:\n  cd ${path.relative(process.cwd(), outDir)}\n  vercel deploy --prod --yes\n`);
