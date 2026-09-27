/**
 * Research layer — the agent's ability to FIND things it was not handed:
 * web search, page fetching and contract discovery on Base/Sepolia.
 *
 * Security posture (matches the security doctrine):
 *  - everything returned is UNTRUSTED DATA — the wrappers say so explicitly;
 *    page content is never an instruction, only a source to cite;
 *  - SSRF guard: http/https only; the hostname is resolved and EVERY address
 *    must be public (blocks localhost, private, link-local and metadata
 *    ranges); redirects are followed manually with the same check per hop;
 *  - no credentials are ever attached, bodies are size-capped, time is boxed.
 */
import { lookup as dnsLookup } from 'node:dns/promises';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAX_RAW_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 20_000;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// --- SSRF guard ---------------------------------------------------------------

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // fc00::/7
    if (/^fe[89ab]/.test(v6)) return true; // fe80::/10
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true; // fail closed
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a valid URL: ${raw.slice(0, 120)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`only http/https URLs can be fetched (got ${url.protocol})`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':')) {
      throw new Error(`refusing non-public host "${host}"`);
    }
  }
  const addresses = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') ? [{ address: host }] : await dnsLookup(host, { all: true });
  if (!addresses.length) throw new Error(`could not resolve "${host}"`);
  for (const a of addresses) {
    if (isPrivateAddress(a.address)) throw new Error(`refusing to fetch private/local address (${host} → ${a.address})`);
  }
  return url;
}

/** fetch() with the SSRF guard applied to every hop; returns body text + content type. */
async function guardedFetch(rawUrl: string, maxBytes = MAX_RAW_BYTES): Promise<{ finalUrl: string; contentType: string; body: string }> {
  let url = await assertPublicUrl(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`redirect without Location (HTTP ${res.status})`);
      url = await assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.hostname}`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    return { finalUrl: url.toString(), contentType: res.headers.get('content-type') ?? '', body };
  }
  throw new Error('too many redirects');
}

// --- HTML → text ----------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(Number.parseInt(n, 16)));
}

function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table|\/section)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decodeEntities(s)
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// --- web search -----------------------------------------------------------------

function decodeDdgHref(href: string): string | null {
  const m = /uddg=([^&"']+)/.exec(href);
  if (m) {
    try {
      const u = decodeURIComponent(m[1]);
      return /^https?:/.test(u) ? u : null;
    } catch {
      return null;
    }
  }
  return /^https?:/.test(href) ? href : null;
}

function parseDdg(body: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const block of body.split(/<div class="result[\s"]/).slice(1)) {
    const href = /class="result__a"[^>]*href="([^"]+)"/.exec(block)?.[1] ?? '';
    const url = decodeDdgHref(href);
    if (!url) continue;
    const title = stripTags(/class="result__a"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '') || url;
    const snippet = stripTags(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? '');
    results.push({ title, url, snippet });
  }
  return results;
}

function decodeBingHref(href: string): string | null {
  if (/^https?:/.test(href)) return href;
  const m = /u=a1([A-Za-z0-9_-]+)/.exec(href);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const u = Buffer.from(b64, 'base64').toString('utf8');
    return /^https?:/.test(u) ? u : null;
  } catch {
    return null;
  }
}

function parseBing(body: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const block of body.split(/<li class="b_algo"/).slice(1)) {
    const href = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"/.exec(block)?.[1] ?? '';
    const url = decodeBingHref(href);
    if (!url) continue;
    const title = stripTags(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? '') || url;
    const snippet = stripTags(/<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '');
    results.push({ title, url, snippet });
  }
  return results;
}

/** Keyless web search (DuckDuckGo HTML, Bing fallback). */
export async function webSearch(query: string): Promise<{ engine: string; results: SearchResult[] }> {
  const q = encodeURIComponent(query.trim());
  try {
    const ddg = await guardedFetch(`https://html.duckduckgo.com/html/?q=${q}`, 1_500_000);
    const results = parseDdg(ddg.body);
    if (results.length) return { engine: 'duckduckgo', results: results.slice(0, 8) };
  } catch {
    // fall through to Bing
  }
  const bing = await guardedFetch(`https://www.bing.com/search?q=${q}&setlang=en`, 2_000_000);
  return { engine: 'bing', results: parseBing(bing.body).slice(0, 8) };
}

// --- web fetch -------------------------------------------------------------------

export interface FetchResult {
  url: string;
  contentType: string;
  text: string;
  truncated: boolean;
}

/** Fetch a public URL and return readable text (HTML stripped) or pretty JSON. */
export async function webFetch(rawUrl: string): Promise<FetchResult> {
  const { finalUrl, contentType, body } = await guardedFetch(rawUrl);
  let text = body;
  const ct = contentType.toLowerCase();
  if (ct.includes('json') || /^\s*[[{]/.test(body)) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 1);
    } catch {
      // not JSON after all — keep raw
    }
  } else if (ct.includes('html') || /<html|<!doctype/i.test(body.slice(0, 500))) {
    const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(body)?.[1];
    const stripped = htmlToText(body);
    text = title ? `${stripTags(title)}\n\n${stripped}` : stripped;
  }
  const truncated = text.length > MAX_TEXT_CHARS;
  return { url: finalUrl, contentType: ct || 'unknown', text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text, truncated };
}

// --- contract discovery (Blockscout) ---------------------------------------------

export function blockscoutHost(chain: 'base' | 'sepolia'): string {
  return chain === 'sepolia' ? 'https://eth-sepolia.blockscout.com' : 'https://base.blockscout.com';
}

export interface ContractCandidate {
  name: string;
  address: string;
  type: string;
  verified: boolean;
}

/** Search Base/Sepolia contracts (tokens + verified contracts) by name or address. */
export async function searchContracts(chain: 'base' | 'sepolia', query: string): Promise<ContractCandidate[]> {
  const res = await fetch(`${blockscoutHost(chain)}/api/v2/search?q=${encodeURIComponent(query.trim())}`, {
    headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Blockscout search failed (HTTP ${res.status})`);
  const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
  const out: ContractCandidate[] = [];
  for (const item of data.items ?? []) {
    const type = String(item.type ?? '');
    if (type !== 'token' && type !== 'contract' && type !== 'address') continue;
    const address = String(item.address_hash ?? item.address ?? '');
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    out.push({
      name: String(item.name ?? '(unnamed)'),
      address,
      type: item.token_type ? `${String(item.token_type)} ${type === 'token' ? 'token' : type}` : type,
      verified: item.is_smart_contract_verified === true,
    });
    if (out.length >= 10) break;
  }
  return out;
}

/** Verified ABI from Blockscout (works for contracts Sourcify never saw). */
export async function blockscoutAbi(chain: 'base' | 'sepolia', address: string): Promise<{ abi: unknown[]; name: string } | null> {
  try {
    const res = await fetch(`${blockscoutHost(chain)}/api/v2/smart-contracts/${address}`, {
      headers: { 'user-agent': BROWSER_UA, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { abi?: unknown; name?: string; is_verified?: boolean };
    if (data.is_verified !== true || !Array.isArray(data.abi) || !data.abi.length) return null;
    return { abi: data.abi as unknown[], name: String(data.name ?? 'contract') };
  } catch {
    return null;
  }
}
