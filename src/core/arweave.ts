import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataPath } from './settings.js';

/**
 * Arweave gateway rotation.
 *
 * The same ar:// id is NOT served identically by every gateway: manifests and
 * Turbo-uploaded files can 404 (or return non-payload bytes) on one gateway and
 * resolve fine on another. Walk the list, cache hits, and negative-cache misses
 * so failing ids are not re-hammered.
 */
const GATEWAYS = ['https://arweave.net', 'https://ar-io.dev', 'https://g8way.io', 'https://permagate.io'];

const cacheDir = (): string => dataPath('cache');
const negativeCache = new Map<string, number>();

const cacheKey = (uri: string) => crypto.createHash('sha1').update(uri).digest('hex');

export function isArweaveUri(uri: string): boolean {
  return uri.startsWith('ar://');
}

export function gatewayCandidates(uri: string): string[] {
  if (/^https?:\/\//i.test(uri)) return [uri];
  if (isArweaveUri(uri)) {
    const rel = uri.slice('ar://'.length);
    return GATEWAYS.map((g) => `${g}/${rel}`);
  }
  return [uri];
}

export interface ArweaveResponse {
  bytes: Buffer;
  contentType: string;
}

export async function fetchArweave(uri: string): Promise<ArweaveResponse> {
  const negativeUntil = negativeCache.get(uri) ?? 0;
  if (Date.now() < negativeUntil) {
    throw new Error(`arweave fetch recently failed for ${uri} (negative-cached)`);
  }

  const key = cacheKey(uri);
  const dir = cacheDir();
  const metaPath = path.join(dir, `${key}.meta.json`);
  const binPath = path.join(dir, `${key}.bin`);

  try {
    const [metaRaw, bytes] = await Promise.all([fs.readFile(metaPath, 'utf8'), fs.readFile(binPath)]);
    const meta = JSON.parse(metaRaw) as { contentType?: string };
    if (bytes.length > 0) {
      return { bytes, contentType: meta.contentType ?? sniffContentType(bytes) };
    }
  } catch {
    // not cached yet
  }

  const errors: string[] = [];
  for (const url of gatewayCandidates(uri)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        errors.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) {
        errors.push(`${url} -> empty body`);
        continue;
      }
      const contentType = res.headers.get('content-type') ?? sniffContentType(bytes);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(binPath, bytes);
      await fs.writeFile(metaPath, JSON.stringify({ uri, url, contentType, bytes: bytes.length, fetchedAt: new Date().toISOString() }, null, 2));
      return { bytes, contentType };
    } catch (err) {
      errors.push(`${url} -> ${(err as Error).message}`);
    }
  }

  negativeCache.set(uri, Date.now() + 60_000);
  throw new Error(`arweave fetch failed for ${uri}: ${errors.join('; ')}`);
}

export async function fetchArweaveJson<T>(uri: string): Promise<T> {
  const { bytes, contentType } = await fetchArweave(uri);
  const text = bytes.toString('utf8');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${uri} but content-type was ${contentType}`);
  }
}

function sniffContentType(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  const head = bytes.subarray(0, 96).toString('utf8').trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'application/json';
  if (head.startsWith('<')) return 'image/svg+xml';
  return 'application/octet-stream';
}
