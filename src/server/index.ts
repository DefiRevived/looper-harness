import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config } from '../core/config.js';
import { buildsRoot, dataRoot, setupComplete } from '../core/settings.js';
import { startDreamScheduler } from '../core/dreams.js';
import { llmMode } from '../core/llm.js';
import { apiRouter } from './api.js';

const prod = process.argv.includes('--prod');

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Vendored libraries for agent builds — served locally, no API token, and
  // CORS-open: sandboxed (opaque-origin) artifact previews load them with
  // plain <script src="/libs/…"> tags, keeping builds offline-safe.
  app.use(
    '/libs',
    (_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      next();
    },
    express.static(path.resolve('libs'), { maxAge: '1d' }),
  );

  // Wallet shim for dapp previews — loaded by sandboxed artifact iframes as a
  // classic script (no token gate; the shim carries the token in its own query
  // when injected, so its read-proxy calls stay authorized when locked down).
  app.get('/looper-wallet.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.send(fs.readFileSync(path.resolve('src/web/looper-wallet.js'), 'utf8'));
    } catch {
      res.status(404).send('/* wallet shim missing */');
    }
  });

  app.use('/api', apiRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  const server = http.createServer(app);

  if (prod) {
    const dist = path.resolve('dist/web');
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: path.resolve('src/web'),
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server } },
    });
    app.use(vite.middlewares);
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server]', err);
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) res.status(500).json({ error: message });
  });

  server.listen(config.port, config.host, () => {
    console.log('');
    console.log('  LOOPER AGENT runtime');
    console.log(`  console : http://${config.host}:${config.port}`);
    console.log(`  chain   : base · ${config.contract}`);
    console.log(
      `  token   : ${config.defaultTokenId > 0 ? `#${config.defaultTokenId}` : 'not set — enter a token id in the console or set LOOPER_TOKEN_ID'}`,
    );
    console.log(
      `  brain   : ${llmMode() === 'live' ? `live (${config.deepseek.model})` : 'MOCK — add a DeepSeek API key in setup (⚙) or .env for live reasoning'}`,
    );
    console.log(`  data    : ${dataRoot()}`);
    console.log(`  builds  : ${buildsRoot()}`);
    if (!setupComplete()) console.log('  setup   : first run — open the console to choose where your data lives');
    console.log('');
  });

  if (config.defaultTokenId > 0) startDreamScheduler(config.defaultTokenId);
  else console.log('  dreams  : off (no token configured)');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exitCode = 1;
});
