#!/usr/bin/env node
/**
 * Vendor the curated library set into ./libs and write libs/manifest.json.
 *
 * Libraries are downloaded once (pinned versions, sha256 recorded), then served
 * locally from this machine at /libs/* — agent builds can load them with plain
 * <script src="/libs/…"> tags, stay offline-safe, and the "no CDN / no external
 * fetches" house rule holds. Re-run with `npm run libs` (add -- --force to
 * redownload).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LIBS = [
  {
    name: 'three',
    version: '0.159.0',
    file: 'three.min.js',
    url: 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js',
    global: 'THREE',
    description: '3D / WebGL engine (scenes, meshes, materials, lights, renderer)',
    usage: '<script src="/libs/three.min.js"></script> → global THREE · e.g. new THREE.WebGLRenderer({ antialias: true })',
  },
  {
    name: 'gsap',
    version: '3.12.5',
    file: 'gsap.min.js',
    url: 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
    global: 'gsap',
    description: 'animation / timeline tweening for DOM and SVG',
    usage: '<script src="/libs/gsap.min.js"></script> → global gsap · e.g. gsap.to(el, { x: 200, rotation: 45, duration: 1 })',
  },
  {
    name: 'animejs',
    version: '3.2.2',
    file: 'anime.min.js',
    url: 'https://cdn.jsdelivr.net/npm/animejs@3.2.2/lib/anime.min.js',
    global: 'anime',
    description: 'tiny animation engine (CSS transforms, SVG, staggered loops)',
    usage: '<script src="/libs/anime.min.js"></script> → global anime · e.g. anime({ targets: ".dot", translateY: -40, direction: "alternate", loop: true })',
  },
  {
    name: 'chart.js',
    version: '4.4.1',
    file: 'chart.umd.js',
    url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
    global: 'Chart',
    description: 'canvas charts — bar / line / pie / radar and more',
    usage: '<script src="/libs/chart.umd.js"></script> → global Chart · new Chart(canvas, { type: "bar", data, options })',
  },
  {
    name: 'd3',
    version: '7.9.0',
    file: 'd3.min.js',
    url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    global: 'd3',
    description: 'data-driven documents — SVG/data-viz building blocks',
    usage: '<script src="/libs/d3.min.js"></script> → global d3 · d3.select("#chart").selectAll("rect").data(values).join("rect")',
  },
  {
    name: 'matter-js',
    version: '0.20.0',
    file: 'matter.min.js',
    url: 'https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js',
    global: 'Matter',
    description: '2D rigid-body physics (bodies, constraints, collisions)',
    usage: '<script src="/libs/matter.min.js"></script> → global Matter · Engine.create(), Bodies.rectangle(...), Render.create(...)',
  },
  {
    name: 'howler',
    version: '2.2.4',
    file: 'howler.min.js',
    url: 'https://cdn.jsdelivr.net/npm/howler@2.2.4/dist/howler.min.js',
    global: 'Howl',
    description: 'audio playback (WebAudio; needs a data: URI source or a user gesture)',
    usage: '<script src="/libs/howler.min.js"></script> → global Howl · new Howl({ src: ["data:audio/wav;base64,…"] })',
  },
  {
    name: 'p5',
    version: '1.9.4',
    file: 'p5.min.js',
    url: 'https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js',
    global: 'p5',
    description: 'creative-coding sketch environment (canvas drawing, loops, input)',
    usage: '<script src="/libs/p5.min.js"></script> → global mode setup()/draw(), or new p5(sketch)',
  },
  {
    name: 'ethers',
    version: '6.13.4',
    file: 'ethers.umd.min.js',
    url: 'https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js',
    global: 'ethers',
    description: 'Ethereum / Base chain client — ABI encoding, providers, contract calls, wallet signing (tree-shaken UMD build)',
    usage:
      '<script src="/libs/ethers.umd.min.js"></script> → global ethers v6 · reads: new ethers.JsonRpcProvider(url) is NOT allowed — bake values with the runtime tools · wallet: const p = new ethers.BrowserProvider(window.ethereum); const c = new ethers.Contract(addr, abi, await p.getSigner())',
  },
  {
    name: 'lodash',
    version: '4.17.21',
    file: 'lodash.min.js',
    url: 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
    global: '_',
    description: 'utility belt — collections, objects, debounce, throttle, templates',
    usage: '<script src="/libs/lodash.min.js"></script> → global _ · e.g. _.debounce(fn, 200), _.groupBy(list, "team")',
  },
  {
    name: 'dayjs',
    version: '1.11.13',
    file: 'dayjs.min.js',
    url: 'https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js',
    global: 'dayjs',
    description: 'dates + durations, tiny (formatting, relative time, arithmetic)',
    usage: '<script src="/libs/dayjs.min.js"></script> → global dayjs · e.g. dayjs().format("YYYY-MM-DD HH:mm"), dayjs().fromNow()',
  },
  {
    name: 'pixi.js',
    version: '7.4.3',
    file: 'pixi.min.js',
    url: 'https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js',
    global: 'PIXI',
    description: '2D WebGL renderer — sprites, filters, particles, fast canvas-style scenes',
    usage: '<script src="/libs/pixi.min.js"></script> → global PIXI · const app = new PIXI.Application({ resizeTo: window }); document.body.appendChild(app.view)',
  },
  {
    name: 'marked',
    version: '12.0.2',
    file: 'marked.min.js',
    url: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
    global: 'marked',
    description: 'Markdown → HTML (docs, changelogs, rendered text)',
    usage: '<script src="/libs/marked.min.js"></script> → global marked · el.innerHTML = marked.parse(md) — sanitize untrusted input (no DOMPurify vendored)',
  },
  {
    name: 'papaparse',
    version: '5.4.1',
    file: 'papaparse.min.js',
    url: 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js',
    global: 'Papa',
    description: 'CSV parse/unparse — import exported data, build tables, download CSV',
    usage: '<script src="/libs/papaparse.min.js"></script> → global Papa · e.g. Papa.parse(csvText, { header: true }).data',
  },
  {
    name: 'qrcode-generator',
    version: '1.4.4',
    file: 'qrcode.js',
    url: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
    global: 'qrcode',
    description: 'QR codes to canvas / img / data-URL (addresses, links, share cards)',
    usage: '<script src="/libs/qrcode.js"></script> → global qrcode · const qr = qrcode(0, "M"); qr.addData(text); qr.make(); qr.createImgTag() or draw qr.getModuleCount() on a canvas',
  },
  {
    name: 'fuse.js',
    version: '7.0.0',
    file: 'fuse.min.js',
    url: 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js',
    global: 'Fuse',
    description: 'fuzzy search over local data (command palettes, filters, rosters)',
    usage: '<script src="/libs/fuse.min.js"></script> → global Fuse · new Fuse(items, { keys: ["name"] }).search(query)',
  },
  {
    name: 'jszip',
    version: '3.10.1',
    file: 'jszip.min.js',
    url: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    global: 'JSZip',
    description: 'build .zip archives in the browser (exports, bundles, downloads)',
    usage: '<script src="/libs/jszip.min.js"></script> → global JSZip · const zip = new JSZip(); zip.file("a.txt", "hi"); zip.generateAsync({type:"blob"})',
  },
  {
    name: 'lottie-web',
    version: '5.12.2',
    file: 'lottie.min.js',
    url: 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js',
    global: 'lottie',
    description: 'vector animations (Lottie JSON) — plays perfectly scaled, no video files',
    usage: '<script src="/libs/lottie.min.js"></script> → global lottie · lottie.loadAnimation({ container, renderer: "svg", path: "anim.json" }) or animationData inline',
  },
  {
    name: 'tone',
    version: '14.7.77',
    file: 'Tone.js',
    url: 'https://cdn.jsdelivr.net/npm/tone@14.7.77/build/Tone.js',
    global: 'Tone',
    description: 'Web Audio synthesis — synths, samplers, effects, sequenced music',
    usage: '<script src="/libs/Tone.js"></script> → global Tone · await Tone.start(); const s = new Tone.Synth().toDestination(); s.triggerAttackRelease("C4", "8n")',
  },
];

const root = path.resolve('libs');
const force = process.argv.includes('--force');
fs.mkdirSync(root, { recursive: true });

const manifestPath = path.join(root, 'manifest.json');
let prior = { libs: [] };
try {
  prior = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch {
  // fresh vendor — no prior manifest
}

const meta = (lib) => ({
  name: lib.name,
  version: lib.version,
  file: lib.file,
  global: lib.global,
  description: lib.description,
  usage: lib.usage,
  source: lib.url,
});

const out = [];
let failures = 0;

for (const lib of LIBS) {
  const dest = path.join(root, lib.file);
  const prev = (prior.libs ?? []).find((l) => l.file === lib.file && l.version === lib.version);
  if (!force && prev && fs.existsSync(dest) && fs.statSync(dest).size === prev.bytes) {
    console.log(`  ✓ ${lib.name} @${lib.version} — already vendored (${(prev.bytes / 1024).toFixed(0)} KB)`);
    out.push({ ...meta(lib), bytes: prev.bytes, sha256: prev.sha256 });
    continue;
  }
  process.stdout.write(`  ↓ ${lib.name} @${lib.version} … `);
  try {
    const res = await fetch(lib.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1024) throw new Error(`suspiciously small (${buf.byteLength} bytes)`);
    fs.writeFileSync(dest, buf);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    console.log(`ok (${(buf.byteLength / 1024).toFixed(0)} KB, sha256 ${sha256.slice(0, 12)}…)`);
    out.push({ ...meta(lib), bytes: buf.byteLength, sha256 });
  } catch (err) {
    failures++;
    console.log(`FAILED — ${err.message}`);
  }
}

fs.writeFileSync(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), libs: out }, null, 2)}\n`);
console.log(`\n  ${out.length}/${LIBS.length} libraries vendored in ./libs — manifest: libs/manifest.json`);
if (failures) process.exitCode = 1;
