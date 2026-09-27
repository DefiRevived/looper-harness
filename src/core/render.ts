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
  pageErrors: string[];
  failedRequests: string[];
  loadedFrom: string[];
  counts: { domNodes: number; canvas: number; svg: number; img: number; script: number };
  canvases: Array<{ width: number; height: number }>;
  images: Array<{ src: string; decoded: string }>;
  pixels: { width: number; height: number; meanLuma: number; nonBackgroundPct: number } | null;
  screenshot: string;
  tookMs: number;
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

export async function renderBuild(parentKey: string, buildId: string): Promise<RenderReport> {
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
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const requests = new Set<string>();
  page.on('console', (msg) => {
    const text = msg.text();
    // The browser auto-requests /favicon.ico; its 404 is universal noise, not a build defect.
    if ((msg.location()?.url ?? '').includes('/favicon')) return;
    if (msg.type() === 'error') consoleErrors.push(text.slice(0, 300));
    else if (msg.type() === 'warning') consoleWarnings.push(text.slice(0, 200));
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
    pageErrors,
    failedRequests,
    loadedFrom: [],
    counts: { domNodes: 0, canvas: 0, svg: 0, img: 0, script: 0 },
    canvases: [],
    images: [],
    pixels: null,
    screenshot: '',
    tookMs: 0,
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

  await page.close().catch(() => undefined);
  report.loadedFrom = [...requests].slice(0, 20);
  report.tookMs = Date.now() - started;
  return report;
}
