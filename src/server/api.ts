import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { config } from '../core/config.js';
import { invalidateLooper, loadLooper } from '../core/codex.js';
import { readAgentBindings, readWalletBalances } from '../core/chain.js';
import { readHelixaCred } from '../core/cred.js';
import { llmMode } from '../core/llm.js';
import { fetchArweave } from '../core/arweave.js';
import { resolveLooperImages } from '../core/looperAssets.js';
import { isProjectFolder } from '../core/projects.js';
import { streamAgentReply, streamAgentReplyWithTools } from '../core/brain.js';
import { isBuildId, listArtifacts, parseBuildThread, revertBuild, sessionDirName } from '../core/tools.js';
import { distillMessages, labelFor } from '../core/episodes.js';
import { listVersions, readVersionEntry, versionSnapshotDir } from '../core/versions.js';
import { allLocks, forgetEntry, listMemoryEntries, lockRemove, taskComplete, taskList } from '../core/memory.js';
import { listActivity } from '../core/activity.js';
import { runDream } from '../core/dreams.js';
import { createChallenge, validateProof, verifyOwnership } from '../core/ownership.js';
import { buildsDirInfo, buildsRoot, setBuildsDir } from '../core/settings.js';
import { inspectTransaction, parseChain, READ_RPC_METHODS, rpcRead } from '../core/web3.js';
import { listTranscripts, readTranscript } from '../core/transcripts.js';
import * as store from '../core/store.js';
import { chatRateLimit, requireApiToken } from './security.js';

export const apiRouter = Router();

/**
 * Web3 preview endpoints are called from SANDBOXED (opaque-origin) iframes —
 * CORS-open like /libs, with the API token still enforced (query form) when
 * configured. Preflight must pass before the token gate: browsers never send
 * tokens on OPTIONS.
 */
apiRouter.use('/web3', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-looper-token');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// --- build files: static preview assets (served WITHOUT the token gate) -----
// Like /libs and /looper-wallet.js, build files are static assets: multi-file
// builds load relative subresources (css/js/images) from sandboxed iframes and
// headless renders that cannot attach headers. Read-only GETs only — every
// mutation (delete, revert, chat…) stays behind the API gate below. The entry
// URL ends with "/" so relative references resolve inside the build folder.

function artifactPath(sessionRaw: string, idRaw: string): string | null {
  if (!/^[a-z0-9_-]{1,64}$/.test(sessionRaw) || !/^[0-9]+-[a-z0-9-]{1,80}$/.test(idRaw)) return null;
  const root = path.join(buildsRoot(), sessionRaw);
  const folder = path.resolve(root, idRaw);
  return folder.startsWith(root + path.sep) ? folder : null;
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
};
const TEXT_SERVE_EXTS = new Set(['html', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md', 'csv']);

function extOfServe(file: string): string {
  const i = file.lastIndexOf('.');
  return i < 0 ? '' : file.slice(i + 1).toLowerCase();
}

/**
 * Dapp previews get the wallet shim — but only pages that actually reference a
 * wallet provider, and only in documents WE serve (a downloaded build stays
 * clean, and where a real wallet exists the shim stands down). Reads then flow
 * to /api/web3/rpc; wallet actions route to the console host bridge, which
 * shows the operator a decoded + simulated confirmation before anything signs.
 */
function injectWalletShim(html: string): string {
  if (html.includes('/looper-wallet.js')) return html;
  if (!/window\.ethereum|ethereum\.request|BrowserProvider/.test(html)) return html;
  const src = `/looper-wallet.js${config.apiToken ? `?token=${encodeURIComponent(config.apiToken)}` : ''}`;
  const tag = `<script src="${src}"></script>`;
  // Into <head> when possible — the shim must exist BEFORE any build script
  // runs, so `ethereum` is defined for code that touches it at load time.
  const head = html.search(/<head[^>]*>/i);
  if (head >= 0) {
    const at = html.indexOf('>', head) + 1;
    return `${html.slice(0, at)}\n${tag}${html.slice(at)}`;
  }
  const close = html.lastIndexOf('</body>');
  return close >= 0 ? `${html.slice(0, close)}${tag}\n${html.slice(close)}` : `${tag}\n${html}`;
}

/** Serve one build file: type, sandbox headers, placeholders resolved, shim on html. */
async function serveBuildFile(res: Response, file: string, opts: { shim: boolean }): Promise<void> {
  const ext = extOfServe(file);
  const type = CONTENT_TYPES[ext];
  if (!type) {
    res.status(404).json({ error: 'unsupported file type' });
    return;
  }
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  // CORS-open like /libs: served documents live in an opaque (CSP-sandboxed)
  // origin, so module scripts and crossorigin-tagged assets are CORS-mode
  // requests — without this header every bundled asset 404s as "origin null".
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (ext === 'html' || ext === 'svg') {
    // Sandbox the document: scripts may run, but in an opaque origin — it can
    // never reach the console's origin, storage, or APIs, even in a new tab.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
  }
  if (TEXT_SERVE_EXTS.has(ext)) {
    let body = fs.readFileSync(file, 'utf8');
    // {{looper-image:ID}} placeholders → real token art as data URIs, at serve time.
    if (body.includes('{{looper-image:')) body = await resolveLooperImages(body);
    if (opts.shim && ext === 'html') body = injectWalletShim(body);
    res.send(body);
  } else {
    res.send(fs.readFileSync(file));
  }
}

/**
 * Resolve a path inside a build folder (entry when rel is empty). Node project
 * builds (package.json present) serve their BUILT dist/ — node_modules and
 * source files are never reachable over HTTP.
 */
function resolveBuildPath(folder: string, rel: string): string | null {
  const root = path.resolve(folder);
  const siteRoot = isProjectFolder(root) ? path.join(root, 'dist') : root;
  if (!rel) {
    return ['index.html', 'index.svg'].map((f) => path.join(siteRoot, f)).find((f) => fs.existsSync(f)) ?? null;
  }
  if (rel.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(rel)) return null;
  const file = path.resolve(siteRoot, rel);
  if (!file.startsWith(siteRoot + path.sep)) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function splatToRel(raw: unknown): string {
  if (Array.isArray(raw)) return raw.filter((s) => typeof s === 'string' && s).join('/');
  return typeof raw === 'string' ? raw : '';
}

apiRouter.get('/artifact/:session/:id{/*rest}', async (req, res) => {
  const folder = artifactPath(String(req.params.session ?? ''), String(req.params.id ?? ''));
  if (!folder) {
    res.status(400).json({ error: 'invalid artifact path' });
    return;
  }
  const file = resolveBuildPath(folder, splatToRel((req.params as Record<string, unknown>).rest));
  if (!file) {
    res.status(404).json({ error: 'artifact file not found' });
    return;
  }
  await serveBuildFile(res, file, { shim: true });
});

// Archived-version subresources: the version browser rewrites an archived
// entry's relative refs to these URLs so the snapshot renders (css/js/images),
// not the live build. Read-only; no wallet shim on archives.
apiRouter.get('/version-artifact/:session/:buildId/:index{/*rest}', async (req, res) => {
  const sessionRaw = String(req.params.session ?? '');
  const buildId = String(req.params.buildId ?? '');
  const index = Number(req.params.index ?? 0);
  if (!/^[a-z0-9_-]{1,64}$/.test(sessionRaw) || !/^[0-9]+-[a-z0-9-]{1,80}$/.test(buildId) || !Number.isInteger(index) || index < 1) {
    res.status(400).json({ error: 'invalid version path' });
    return;
  }
  const dir = versionSnapshotDir(sessionRaw, buildId, index);
  if (!dir) {
    res.status(404).json({ error: 'version not found' });
    return;
  }
  const file = resolveBuildPath(dir, splatToRel((req.params as Record<string, unknown>).rest));
  if (!file) {
    res.status(404).json({ error: 'version file not found' });
    return;
  }
  await serveBuildFile(res, file, { shim: false });
});

/** Optional token gate — active only when LOOPER_API_TOKEN is set. */
apiRouter.use(requireApiToken);

function parseTokenId(raw: unknown): number {
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0 && n <= 1_000_000) return n;
  return config.defaultTokenId > 0 ? config.defaultTokenId : 0;
}

/** Routes that need a real Looper fail with a clear hint while none is configured. */
function requireToken(res: Response, tokenId: number): boolean {
  if (tokenId > 0) return true;
  res.status(400).json({ error: 'no token selected — set LOOPER_TOKEN_ID in .env, or pass a tokenId (1–7777)' });
  return false;
}

/**
 * Ownership gate (LOOPER_REQUIRE_OWNERSHIP): token-scoped routes demand an
 * activation proof obtained through the wallet check — proof that the caller
 * holds the token. Disabled → every request passes (local/demo posture).
 */
function requireProof(req: Request, res: Response, tokenId: number): boolean {
  if (!config.requireOwnership) return true;
  const header = req.headers['x-looper-proof'];
  const proof = String(Array.isArray(header) ? header[0] : (header ?? req.query.proof ?? ''));
  if (proof && validateProof(proof, tokenId)) return true;
  res.status(403).json({
    error: 'ownership proof required — activate this token with the wallet that owns it',
    code: 'OWNERSHIP_REQUIRED',
  });
  return false;
}

// --- ownership verification (SIWE-style; no transaction, no gas) -------------

apiRouter.post('/ownership/challenge', (req, res) => {
  const tokenId = parseTokenId(req.body?.tokenId);
  if (!requireToken(res, tokenId)) return;
  const address = String(req.body?.address ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    res.status(400).json({ error: 'a 0x wallet address is required' });
    return;
  }
  res.json({ tokenId, ...createChallenge(tokenId, address) });
});

apiRouter.post('/ownership/verify', async (req, res) => {
  const nonce = String(req.body?.nonce ?? '');
  const signature = String(req.body?.signature ?? '');
  if (!nonce || !signature) {
    res.status(400).json({ error: 'nonce and signature are required' });
    return;
  }
  const result = await verifyOwnership(nonce, signature);
  if (!result.ok) {
    const message =
      result.code === 'not-owner'
        ? `the signature is valid, but this wallet does not own Looper #${result.tokenId} (owner: ${result.owner ?? 'unknown'})`
        : result.code === 'bad-signature'
          ? 'the signature did not verify against the wallet address'
          : 'ownership challenge is unknown or expired — try again';
    res.status(403).json({ error: message, code: result.code });
    return;
  }
  res.json({ ok: true, tokenId: result.tokenId, address: result.address, proof: result.proof });
});

// --- operator settings (builds directory etc.) -------------------------------

apiRouter.get('/settings', (_req, res) => {
  res.json({ buildsDir: buildsDirInfo(), dataDir: config.dataDir });
});

apiRouter.post('/settings', (req, res) => {
  const body = (req.body ?? {}) as { buildsDir?: unknown };
  if (!('buildsDir' in body)) {
    res.status(400).json({ error: 'buildsDir is required (pass a path, or null to reset to the default)' });
    return;
  }
  if (body.buildsDir !== null && typeof body.buildsDir !== 'string') {
    res.status(400).json({ error: 'buildsDir must be a path string or null' });
    return;
  }
  try {
    const info = setBuildsDir((body.buildsDir as string | null) ?? null);
    res.json({ ok: true, buildsDir: info });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Wallet reads hit an RPC and the vitals panel polls — cache per address briefly.
const walletCache = new Map<string, { fetchedAt: number; data: { eth: string; usdc: string; at: string } }>();

async function cachedWallet(address: string): Promise<{ eth: string; usdc: string; at: string } | null> {
  const key = address.toLowerCase();
  const hit = walletCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < 60_000) return hit.data;
  try {
    const data = await readWalletBalances(address);
    walletCache.set(key, { fetchedAt: Date.now(), data });
    return data;
  } catch {
    return hit ? hit.data : null;
  }
}

apiRouter.get('/looper/:tokenId', async (req, res) => {
  const tokenId = parseTokenId(req.params.tokenId);
  if (!requireToken(res, tokenId)) return;
  if (!requireProof(req, res, tokenId)) return;
  const bundle = await loadLooper(tokenId);
  const bindings = await readAgentBindings(tokenId);
  const helixaCred = bindings.agentId ? await readHelixaCred(bindings.agentId) : null;
  res.json({
    ...bundle,
    bindings,
    helixaCred,
    mode: { llm: llmMode(), model: config.deepseek.model },
    contract: config.contract,
    network: 'base',
  });
});

apiRouter.post('/looper/:tokenId/refresh', async (req, res) => {
  const tokenId = parseTokenId(req.params.tokenId);
  if (!requireToken(res, tokenId)) return;
  if (!requireProof(req, res, tokenId)) return;
  invalidateLooper(tokenId);
  await loadLooper(tokenId);
  res.json({ ok: true, tokenId });
});

apiRouter.get('/image/:tokenId', async (req, res) => {
  const tokenId = parseTokenId(req.params.tokenId);
  if (!requireToken(res, tokenId)) return;
  const bundle = await loadLooper(tokenId);
  const image = bundle.metadata.image;
  if (!image) {
    res.status(404).json({ error: 'metadata has no image' });
    return;
  }
  const { bytes, contentType } = await fetchArweave(image);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(bytes);
});

apiRouter.get('/chat/history', (req, res) => {
  const key = String(req.query.sessionKey ?? '');
  res.json({ messages: key ? store.getSession(key) : [] });
});

apiRouter.post('/chat/reset', (req, res) => {
  const key = String(req.body?.sessionKey ?? '');
  if (key) {
    const snapshot = store.getSession(key);
    store.resetSession(key);
    if (snapshot.length >= 6) {
      const match = /web:(\d+)/.exec(key);
      const tokenId = parseTokenId(req.body?.tokenId ?? (match ? Number(match[1]) : undefined));
      // Distill BEFORE the transcript is only a memory of a memory — fire-and-forget.
      void distillMessages(tokenId, key, snapshot, 0, 2);
    }
  }
  res.json({ ok: true });
});

apiRouter.post('/chat', chatRateLimit, async (req, res) => {
  const tokenId = parseTokenId(req.body?.tokenId);
  if (!requireToken(res, tokenId)) return;
  if (!requireProof(req, res, tokenId)) return;
  const sessionKey = String(req.body?.sessionKey ?? `web:${tokenId}`);
  const message = String(req.body?.message ?? '').trim();
  if (!message) {
    res.status(400).json({ error: 'message required' });
    return;
  }
  if (message.length > config.maxMessageChars) {
    res.status(413).json({ error: `message too long (${message.length} > ${config.maxMessageChars} chars)` });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // A model turn can spend minutes generating a tool call (e.g. a full build
  // revision) with nothing to stream yet — heartbeat the SSE so the browser
  // connection stays alive and the client knows the turn is still running.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  // Stop button: the client closing the connection aborts the generation
  // itself, so the upstream LLM stream is cut (and the partial turn is saved
  // with a marker instead of being lost).
  const stopCtrl = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) stopCtrl.abort(new Error('stopped by operator'));
  });

  try {
    if (sessionKey.startsWith('web:')) {
      for await (const event of streamAgentReplyWithTools(tokenId, sessionKey, message, 'web', { signal: stopCtrl.signal })) {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } else {
      for await (const delta of streamAgentReply(tokenId, sessionKey, message, { signal: stopCtrl.signal })) {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
      }
    }
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (err) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'error', message: (err as Error).message })}\n\n`);
  } finally {
    clearInterval(heartbeat);
  }
  if (!res.writableEnded) res.end();
});

// --- operator panels: ledger (tasks + locks), memory, versions, vitals ------

// --- operator panels: ledger (tasks + locks), memory, versions, vitals ------

apiRouter.get('/tasks', async (req, res) => {
  const tokenId = parseTokenId(req.query.tokenId);
  const includeDone = String(req.query.includeDone ?? '') === '1';
  res.json({ tasks: await taskList(tokenId, includeDone) });
});

apiRouter.post('/tasks/complete', async (req, res) => {
  const tokenId = parseTokenId(req.body?.tokenId);
  const taskId = String(req.body?.taskId ?? '').trim();
  if (!taskId) {
    res.status(400).json({ error: 'taskId required' });
    return;
  }
  res.json({ ok: await taskComplete(tokenId, taskId) });
});

apiRouter.get('/locks', async (req, res) => {
  const tokenId = parseTokenId(req.query.tokenId);
  res.json({ locks: await allLocks(tokenId) });
});

apiRouter.post('/locks/remove', async (req, res) => {
  const id = String(req.body?.id ?? '').trim();
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  res.json({ ok: await lockRemove(id) });
});

apiRouter.get('/memory', async (req, res) => {
  const tokenId = parseTokenId(req.query.tokenId);
  const entries = await listMemoryEntries(tokenId);
  res.json({
    entries: entries.map((e) => ({ ...e, sessionLabel: e.scope === 'episode' && e.sessionKey ? labelFor(e.sessionKey) : undefined })),
  });
});

apiRouter.post('/memory/forget', async (req, res) => {
  const id = String(req.body?.id ?? '').trim();
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  res.json({ ok: await forgetEntry(id) });
});

apiRouter.get('/versions', (req, res) => {
  const sessionKey = String(req.query.sessionKey ?? '');
  const buildId = String(req.query.buildId ?? '');
  if (!sessionKey || !isBuildId(buildId)) {
    res.status(400).json({ error: 'sessionKey and a valid buildId are required' });
    return;
  }
  res.json({ versions: listVersions(sessionDirName(sessionKey), buildId) });
});

apiRouter.get('/version-file', (req, res) => {
  const sessionKey = String(req.query.sessionKey ?? '');
  const buildId = String(req.query.buildId ?? '');
  const index = Number(req.query.index ?? 1);
  if (!sessionKey || !isBuildId(buildId) || !Number.isInteger(index) || index < 1) {
    res.status(400).json({ error: 'sessionKey, a valid buildId and index are required' });
    return;
  }
  const dirName = sessionDirName(sessionKey);
  const entry = readVersionEntry(dirName, buildId, index);
  if (entry === null) {
    res.status(404).json({ error: 'version not found' });
    return;
  }
  let content = entry.content;
  if (entry.kind === 'dir') {
    // Rewrite relative refs to the snapshot's subresource route so the srcdoc
    // preview renders the version's css/js/images, not the live build's.
    const base = `/api/version-artifact/${dirName}/${buildId}/${index}/`;
    content = content.replace(
      /(\s(?:src|href)\s*=\s*["'])(?!https?:|data:|blob:|#|mailto:|tel:|javascript:|\/|\{\{)([^"']+)(["'])/gi,
      (_m, pre: string, ref: string, post: string) => `${pre}${base}${ref}${post}`,
    );
  }
  res.setHeader('Content-Type', content.trimStart().startsWith('<svg') ? 'image/svg+xml' : 'text/html');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox allow-scripts');
  res.send(content);
});

apiRouter.post('/versions/revert', async (req, res) => {
  const tokenId = parseTokenId(req.body?.tokenId);
  const sessionKey = String(req.body?.sessionKey ?? '');
  const buildId = String(req.body?.buildId ?? '');
  const version = Number(req.body?.version ?? 1);
  if (!sessionKey || !isBuildId(buildId) || !Number.isInteger(version) || version < 1) {
    res.status(400).json({ error: 'sessionKey, a valid buildId and version are required' });
    return;
  }
  res.json(await revertBuild(sessionKey, tokenId, buildId, version));
});

apiRouter.get('/vitals', async (req, res) => {
  const tokenId = parseTokenId(req.query.tokenId);
  if (!requireProof(req, res, tokenId)) return;
  const sessionKey = String(req.query.sessionKey ?? `web:${tokenId}`);
  const parentKey = parseBuildThread(sessionKey)?.parentKey ?? sessionKey;
  let owner: string | null = null;
  let wallet: { eth: string; usdc: string; at: string } | null = null;
  try {
    const bundle = await loadLooper(tokenId);
    owner = bundle.identity.owner;
    if (owner) wallet = await cachedWallet(owner);
  } catch {
    // vitals are best-effort — the panel shows dashes on failure
  }
  const [entries, tasks, locks] = await Promise.all([listMemoryEntries(tokenId), taskList(tokenId, true), allLocks(tokenId)]);
  res.json({
    owner,
    wallet,
    counts: {
      memory: entries.length,
      episodes: entries.filter((e) => e.scope === 'episode').length,
      tasksOpen: tasks.filter((t) => t.status === 'open').length,
      tasksDone: tasks.filter((t) => t.status === 'done').length,
      locks: locks.length,
      builds: listArtifacts(parentKey).length,
      messages: store.getSession(sessionKey).length,
      messagesMax: store.MAX_SESSION_MESSAGES,
    },
    at: new Date().toISOString(),
  });
});

apiRouter.get('/activity', (req, res) => {
  const key = String(req.query.sessionKey ?? '');
  res.json({ events: key ? listActivity(key, 60) : [] });
});

// --- transcript archive (verbatim record of messages dropped by trim/reset) --

apiRouter.get('/transcripts', (_req, res) => {
  res.json({ sessions: listTranscripts() });
});

apiRouter.get('/transcripts/:session', (req, res) => {
  const result = readTranscript(String(req.params.session ?? ''));
  if (!result) {
    res.status(404).json({ error: 'no transcript archived for that session' });
    return;
  }
  res.json(result);
});

apiRouter.post('/dream', async (req, res) => {
  const tokenId = parseTokenId(req.body?.tokenId);
  if (!requireToken(res, tokenId)) return;
  if (!requireProof(req, res, tokenId)) return;
  res.json(await runDream(tokenId, 'manual'));
});

// --- web3 (dapp preview bridge: read proxy + transaction inspector) ---------

apiRouter.post('/web3/rpc', async (req, res) => {
  const chain = parseChain(req.body?.chain);
  const method = typeof req.body?.method === 'string' ? req.body.method : '';
  if (!chain) {
    res.status(400).json({ error: 'chain must be base or sepolia' });
    return;
  }
  if (!READ_RPC_METHODS.has(method)) {
    res.status(400).json({ error: `method not allowed: ${method}` });
    return;
  }
  try {
    const result = await rpcRead(chain, method, Array.isArray(req.body?.params) ? (req.body.params as unknown[]) : []);
    res.json({ jsonrpc: '2.0', id: 1, result });
  } catch (err) {
    res.json({
      jsonrpc: '2.0',
      id: 1,
      error: { code: (err as { code?: number }).code ?? -32000, message: ((err as Error).message || 'rpc failed').slice(0, 300) },
    });
  }
});

apiRouter.post('/web3/inspect', async (req, res) => {
  const chain = parseChain(req.body?.chain);
  const tx = req.body?.tx as Record<string, unknown> | undefined;
  if (!chain || typeof tx !== 'object' || tx === null) {
    res.status(400).json({ error: 'chain + tx required' });
    return;
  }
  try {
    res.json(await inspectTransaction(chain, tx));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- artifacts: listing + delete (mutations stay behind the token gate) ------

apiRouter.get('/artifacts', (req, res) => {
  const key = String(req.query.sessionKey ?? '');
  res.json({ artifacts: key ? listArtifacts(key) : [] });
});

apiRouter.delete('/artifact/:session/:file', (req, res) => {
  const folder = artifactPath(String(req.params.session ?? ''), String(req.params.file ?? ''));
  if (!folder || !fs.existsSync(folder)) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  fs.rmSync(folder, { recursive: true, force: true });
  res.json({ ok: true });
});
