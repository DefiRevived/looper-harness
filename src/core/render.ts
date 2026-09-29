import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { config } from './config.js';
import { dataPath } from './settings.js';

/**
 * Headless build rendering — the missing "eyes" for the agent.
 *
 * Text models can't look at pixels, but they CAN read a report of a real
 * render: HTTP status, uncaught JS errors, console messages, which resources
 * actually loaded (e.g. /libs/three.min.js), DOM/canvas inventory, and a pixel
 * analysis of the screenshot (mean luma + how much differs from the dominant
 * color — catches blank/broken pages). The screenshot itself is saved to
 * data/renders/ for the OPERATOR; the agent reads the numbers.
 *
 * Renders the SERVED artifact URL (so placeholders resolve and the sandbox CSP
 * applies exactly like the console preview), in the installed Edge/Chrome via
 * playwright-core — no browser download.
 */

export interface RenderReport {
  url: string;
  status: number | null;
  navigationError?: string;
  title: string;
  textPreview: string;
  consoleErrors: string[];
  consoleWarnings: string[];
  /** ALL console messages (log/info/debug) — a silent test is invisible without these. */
  consoleLogs: string[];
  pageErrors: string[];
  failedRequests: string[];
  loadedFrom: string[];
  counts: { domNodes: number; canvas: number; svg: number; img: number; script: number };
  canvases: Array<{ width: number; height: number }>;
  images: Array<{ src: string; decoded: string }>;
  pixels: { width: number; height: number; meanLuma: number; nonBackgroundPct: number } | null;
  screenshot: string;
  tookMs: number;
  /** Extra viewports rendered after the primary one (multi-viewport capture). */
  viewports: ViewportReport[];
  /** Hand-rolled accessibility probe of the primary viewport (approximate, no deps). */
  a11y: A11yReport | null;
}

export interface ViewportReport {
  label: string;
  width: number;
  height: number;
  screenshot: string;
  pixels: { width: number; height: number; meanLuma: number; nonBackgroundPct: number } | null;
  overflow: { x: boolean; scrollWidth: number; clientWidth: number; offenders: string[] } | null;
  errors: number;
}

export interface A11yReport {
  missingAlt: number;
  namelessControls: string[];
  lowContrast: Array<{ snippet: string; ratio: number; fg: string; bg: string }>;
  textSampled: number;
}

const dirSlug = (sessionKey: string): string =>
  sessionKey.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64) || 'session';

let browserPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    return await chromium.launch({ channel: 'chrome', headless: true });
  }
}

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return browserPromise;
}

interface PixelStats {
  width: number;
  height: number;
  meanLuma: number;
  nonBackgroundPct: number;
}

/** Decode the screenshot back inside the page (the browser has a PNG decoder). */
async function pixelStats(page: import('playwright-core').Page, pngBase64: string): Promise<PixelStats | null> {
  try {
    return await page.evaluate(async (dataUrl: string) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const width = Math.min(400, img.width || 1);
      const height = Math.max(1, Math.round(((img.height || 1) * width) / (img.width || 1)));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      let lumaSum = 0;
      let count = 0;
      const hist = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        lumaSum += 0.299 * r + 0.587 * g + 0.114 * b;
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        hist.set(key, (hist.get(key) ?? 0) + 1);
        count++;
      }
      let dominant = 0;
      for (const v of hist.values()) if (v > dominant) dominant = v;
      return {
        width: img.width,
        height: img.height,
        meanLuma: Math.round(lumaSum / Math.max(1, count)),
        nonBackgroundPct: Math.round((1 - dominant / Math.max(1, count)) * 100),
      };
    }, `data:image/png;base64,${pngBase64}`);
  } catch {
    return null;
  }
}

/**
 * String-form a11y probe (plain JS — see the call site: tsx/esbuild's __name
 * helper breaks serialized function callbacks that contain named inner
 * functions). Keep this self-contained and dependency-free.
 */
const A11Y_PROBE = [
  '(function () {',
  '  var parse = function (c) {',
  '    var m = /rgba?\\((\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)(?:[,\\s\\/]+([\\d.]+))?\\)/.exec(c);',
  '    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;',
  '  };',
  '  var lum = function (rgb) {',
  '    var f = function (v) {',
  '      var x = v / 255;',
  '      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);',
  '    };',
  '    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);',
  '  };',
  '  var ratio = function (a, b) {',
  '    var l1 = Math.max(lum(a), lum(b));',
  '    var l2 = Math.min(lum(a), lum(b));',
  '    return (l1 + 0.05) / (l2 + 0.05);',
  '  };',
  '  var bgOf = function (el) {',
  '    var cur = el;',
  '    while (cur) {',
  '      var c = parse(getComputedStyle(cur).backgroundColor);',
  '      if (c && c[3] > 0.4) return [c[0], c[1], c[2]];',
  '      cur = cur.parentElement;',
  '    }',
  '    return [255, 255, 255];',
  '  };',
  '  var missingAlt = 0;',
  '  var imgs = document.querySelectorAll("img");',
  '  for (var i = 0; i < imgs.length; i++) if (!imgs[i].hasAttribute("alt")) missingAlt++;',
  '  var namelessControls = [];',
  '  var controls = document.querySelectorAll("button, a, input[type=button], input[type=submit]");',
  '  for (var j = 0; j < controls.length; j++) {',
  '    var el2 = controls[j];',
  '    var name = ((el2.textContent || "").trim() || el2.getAttribute("aria-label") || el2.getAttribute("title") || "").trim();',
  '    if (!name && namelessControls.length < 5) namelessControls.push(el2.tagName.toLowerCase() + " (no text/aria-label)");',
  '  }',
  '  var lowContrast = [];',
  '  var textSampled = 0;',
  '  var all = document.querySelectorAll("body *");',
  '  for (var k = 0; k < all.length && textSampled < 120; k++) {',
  '    var el = all[k];',
  '    if (el.children.length !== 0) continue;',
  '    var text = (el.textContent || "").trim();',
  '    if (!text) continue;',
  '    var cs = getComputedStyle(el);',
  '    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.15) continue;',
  '    var fg = parse(cs.color);',
  '    if (!fg) continue;',
  '    var bg = bgOf(el);',
  '    textSampled++;',
  '    var r = ratio([fg[0], fg[1], fg[2]], bg);',
  '    var px = parseFloat(cs.fontSize) || 16;',
  '    var bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;',
  '    var needs = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;',
  '    if (r < needs - 0.05 && lowContrast.length < 6) {',
  '      lowContrast.push({ snippet: el.tagName.toLowerCase() + ": " + text.slice(0, 40), ratio: Math.round(r * 100) / 100, fg: cs.color, bg: "rgb(" + bg.join(", ") + ")" });',
  '    }',
  '  }',
  '  return { missingAlt: missingAlt, namelessControls: namelessControls, lowContrast: lowContrast, textSampled: textSampled };',
  '})()',
].join('\n');

export async function renderBuild(
  parentKey: string,
  buildId: string,
  opts: { viewports?: Array<{ label: string; width: number; height: number }> } = {},
): Promise<RenderReport> {
  const started = Date.now();
  // Trailing slash matters: relative references (css/js/images) in multi-file
  // builds resolve under the build folder URL.
  const url = `http://${config.host}:${config.port}/api/artifact/${dirSlug(parentKey)}/${buildId}/${
    config.apiToken ? `?token=${encodeURIComponent(config.apiToken)}` : ''
  }`;
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const consoleLogs: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const requests = new Set<string>();
  page.on('console', (msg) => {
    const text = msg.text();
    // The browser auto-requests /favicon.ico; its 404 is universal noise, not a build defect.
    if ((msg.location()?.url ?? '').includes('/favicon')) return;
    if (msg.type() === 'error') consoleErrors.push(text.slice(0, 300));
    else if (msg.type() === 'warning') consoleWarnings.push(text.slice(0, 200));
    else if (consoleLogs.length < 40) consoleLogs.push(`[${msg.type()}] ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err).slice(0, 300)));
  page.on('request', (req) => {
    if (!req.url().startsWith('data:')) requests.add(req.url());
  });
  page.on('requestfailed', (req) => {
    if (!req.url().includes('/favicon')) failedRequests.push(`${req.url().slice(0, 160)} — ${req.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('/favicon')) failedRequests.push(`${res.url().slice(0, 160)} — HTTP ${res.status()}`);
  });

  const report: RenderReport = {
    url,
    status: null,
    title: '',
    textPreview: '',
    consoleErrors,
    consoleWarnings,
    consoleLogs,
    pageErrors,
    failedRequests,
    loadedFrom: [],
    counts: { domNodes: 0, canvas: 0, svg: 0, img: 0, script: 0 },
    canvases: [],
    images: [],
    pixels: null,
    screenshot: '',
    tookMs: 0,
    viewports: [],
    a11y: null,
  };

  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 20_000 });
    report.status = resp?.status() ?? null;
  } catch (err) {
    report.navigationError = (err as Error).message.slice(0, 300);
  }

  try {
    await page.waitForTimeout(1600); // let scripts / rAF draw a few frames
    const info = await page.evaluate(() => ({
      title: document.title,
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 500),
      domNodes: document.querySelectorAll('*').length,
      canvases: [...document.querySelectorAll('canvas')].map((c) => ({ width: c.width, height: c.height })),
      images: [...document.querySelectorAll('img')].map((i) => ({
        src: i.src.slice(0, 90),
        decoded: i.complete && i.naturalWidth > 0 ? `${i.naturalWidth}×${i.naturalHeight}` : 'NOT-DECODED',
      })),
      svg: document.querySelectorAll('svg').length,
      img: document.querySelectorAll('img').length,
      script: document.querySelectorAll('script').length,
    }));
    report.title = info.title;
    report.textPreview = info.text;
    report.counts = {
      domNodes: info.domNodes,
      canvas: info.canvases.length,
      svg: info.svg,
      img: info.img,
      script: info.script,
    };
    report.canvases = info.canvases;
    report.images = info.images;
  } catch {
    // page context gone — report whatever we have
  }

  try {
    const shot = await page.screenshot({ type: 'png' });
    const rendersDir = dataPath('renders');
    fs.mkdirSync(rendersDir, { recursive: true });
    const file = `${buildId.replace(/\.(html|svg)$/, '')}-${Date.now()}.png`;
    report.screenshot = path.join(rendersDir, file);
    fs.writeFileSync(report.screenshot, shot);
    report.pixels = await pixelStats(page, shot.toString('base64'));
  } catch {
    // screenshot is best-effort
  }

  // Accessibility probe (approximate, hand-rolled — no deps): missing alts,
  // nameless controls, and sampled text contrast vs the effective background.
  try {
    // STRING-form probe on purpose: esbuild/tsx wraps named functions inside
    // serialized page.evaluate callbacks with a __name helper that does not
    // exist in the browser ("__name is not defined"). Keep A11Y_PROBE plain JS.
    report.a11y = (await page.evaluate(A11Y_PROBE)) as unknown as A11yReport;
  } catch (err) {
    // a11y probe is best-effort — but never silent about why
    console.warn(`[render] a11y probe failed: ${(err as Error).message}`);
  }

  await page.close().catch(() => undefined);

  // Extra viewports — multi-viewport capture + horizontal-overflow check.
  for (const vp of opts.viewports ?? []) {
    const vPage = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    let errors = 0;
    vPage.on('pageerror', () => errors++);
    vPage.on('console', (msg) => {
      if (msg.type() === 'error' && !(msg.location()?.url ?? '').includes('/favicon')) errors++;
    });
    let overflow: ViewportReport['overflow'] = null;
    let vShot = '';
    let vPixels: ViewportReport['pixels'] = null;
    try {
      await vPage.goto(url, { waitUntil: 'load', timeout: 20_000 });
      await vPage.waitForTimeout(1200);
      overflow = await vPage.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = Math.max(doc.scrollWidth, document.body?.scrollWidth ?? 0);
        const clientWidth = window.innerWidth;
        const offenders: string[] = [];
        if (scrollWidth > clientWidth + 1) {
          for (const el of [...document.querySelectorAll('body *')]) {
            const r = el.getBoundingClientRect();
            if (r.right > clientWidth + 1 && r.width > 4 && offenders.length < 3) {
              const cls =
                typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
              offenders.push(`${el.tagName.toLowerCase()}${cls} right=${Math.round(r.right)}px`);
            }
          }
        }
        return { x: scrollWidth > clientWidth + 1, scrollWidth, clientWidth, offenders };
      });
      const shot = await vPage.screenshot({ type: 'png' });
      const rendersDir = dataPath('renders');
      fs.mkdirSync(rendersDir, { recursive: true });
      vShot = path.join(rendersDir, `${buildId.replace(/\.(html|svg)$/, '')}-${vp.width}x${vp.height}-${Date.now()}.png`);
      fs.writeFileSync(vShot, shot);
      vPixels = await pixelStats(vPage, shot.toString('base64'));
    } catch {
      // that viewport failed — report what we know (error count)
    }
    await vPage.close().catch(() => undefined);
    report.viewports.push({ label: vp.label, width: vp.width, height: vp.height, screenshot: vShot, pixels: vPixels, overflow, errors });
  }

  report.loadedFrom = [...requests].slice(0, 20);
  report.tookMs = Date.now() - started;
  return report;
}

/**
 * Downscale a PNG build asset in the headless browser (canvas); longest edge =
 * maxPx. Never upscales; keeps alpha; writes the result back to the same file.
 */
export async function resizePng(
  filePath: string,
  maxPx: number,
): Promise<{ ok: boolean; message: string; width?: number; height?: number; bytesBefore?: number; bytesAfter?: number }> {
  const buf = fs.readFileSync(filePath);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    const res = await page.evaluate(
      async (args: { dataUrl: string; maxPx: number }) => {
        const img = new Image();
        img.src = args.dataUrl;
        await img.decode();
        const w0 = img.naturalWidth || 0;
        const h0 = img.naturalHeight || 0;
        const scale = Math.min(1, args.maxPx / Math.max(w0, h0 || 1));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        return { png: canvas.toDataURL('image/png'), w, h, w0, h0 };
      },
      { dataUrl, maxPx },
    );
    if (!res) return { ok: false, message: 'could not decode the PNG in the browser.' };
    if (res.w === res.w0 && res.h === res.h0) {
      return { ok: false, message: `already at or below ${maxPx}px on the longest edge (${res.w0}×${res.h0}) — nothing to do.` };
    }
    const out = Buffer.from(res.png.slice('data:image/png;base64,'.length), 'base64');
    fs.writeFileSync(filePath, out);
    return {
      ok: true,
      message: `resized ${res.w0}×${res.h0} → ${res.w}×${res.h}`,
      width: res.w,
      height: res.h,
      bytesBefore: buf.length,
      bytesAfter: out.length,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
