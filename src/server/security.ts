import type { NextFunction, Request, Response } from 'express';
import { config } from '../core/config.js';

/**
 * Optional access gate for the local API. Disabled while LOOPER_API_TOKEN is
 * empty (pure-local usage); when set, every /api request must present the token
 * via `x-looper-token` header, `Authorization: Bearer …`, or `?token=` query
 * (the query form exists so the console can bootstrap and images can load).
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiToken) {
    next();
    return;
  }
  const header = req.header('x-looper-token') ?? '';
  const bearer = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const query = typeof req.query.token === 'string' ? req.query.token : '';
  if (header === config.apiToken || bearer === config.apiToken || query === config.apiToken) {
    next();
    return;
  }
  console.error(`[security] rejected ${req.method} ${req.path} from ${req.ip} (bad or missing token)`);
  res.status(401).json({ error: 'access token required' });
}

/**
 * Sliding-window rate limit per client IP, applied to the expensive chat route.
 * Keeps a single chatter (or a misbehaving script) from draining LLM budget.
 */
const windows = new Map<string, number[]>();

export function chatRateLimit(req: Request, res: Response, next: NextFunction): void {
  const limit = config.chatRateLimitPerMinute;
  if (!Number.isFinite(limit) || limit <= 0) {
    next();
    return;
  }
  const key = req.ip ?? 'local';
  const now = Date.now();
  const hits = (windows.get(key) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= limit) {
    console.error(`[security] rate limit hit for ${key} (${hits.length}/${limit} per minute)`);
    res.status(429).json({ error: `rate limit: max ${limit} chat requests per minute — retry shortly` });
    return;
  }
  hits.push(now);
  windows.set(key, hits);
  next();
}