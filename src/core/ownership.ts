/**
 * Wallet ownership verification for token activation — the "own it to run it" gate.
 *
 * Flow: challenge (tokenId + address → message with nonce) → operator signs the
 * plain message in their wallet (SIWE-style; no transaction, no gas) → the
 * recovered signer is compared against a fresh ownerOf(tokenId) read on Base →
 * an HMAC proof is issued, scoped to one token, valid for 24h.
 *
 * Challenges are in-memory and single-use; proofs are stateless and signed with
 * a persistent per-install secret, so they survive server restarts.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyMessage, type Hex } from 'viem';
import { config } from './config.js';
import { readOwner } from './chain.js';

const CHALLENGE_TTL_MS = 5 * 60_000;
const PROOF_TTL_MS = 24 * 60 * 60_000;
const MAX_CHALLENGES = 200;

function loadSecret(): Buffer {
  const file = path.join(config.dataDir, 'ownership-secret');
  try {
    const hex = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  } catch {
    // no secret yet — create one below
  }
  const secret = randomBytes(32);
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
  } catch {
    // best-effort: an in-memory secret just means proofs reset on restart
  }
  return secret;
}

const SECRET = loadSecret();

interface Challenge {
  tokenId: number;
  address: string;
  message: string;
  createdAt: number;
}

const challenges = new Map<string, Challenge>();

function prune(): void {
  const cutoff = Date.now() - CHALLENGE_TTL_MS;
  for (const [nonce, ch] of challenges) {
    if (ch.createdAt < cutoff) challenges.delete(nonce);
  }
  if (challenges.size > MAX_CHALLENGES) {
    const oldest = [...challenges.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [nonce] of oldest.slice(0, challenges.size - MAX_CHALLENGES)) challenges.delete(nonce);
  }
}

/** Build the message the operator's wallet signs, remembered under a nonce. */
export function createChallenge(tokenId: number, address: string): { nonce: string; message: string } {
  prune();
  const nonce = randomBytes(16).toString('hex');
  const message = [
    'Sign-In With Looper — ownership check',
    '',
    `  wallet : ${address}`,
    `  token  : Looper #${tokenId}`,
    `  nonce  : ${nonce}`,
    '',
    'Signing proves this wallet owns the token. No transaction, no gas.',
  ].join('\n');
  challenges.set(nonce, { tokenId, address: address.toLowerCase(), message, createdAt: Date.now() });
  return { nonce, message };
}

export interface OwnershipResult {
  ok: boolean;
  code?: 'unknown-challenge' | 'bad-signature' | 'not-owner';
  tokenId?: number;
  address?: string;
  owner?: string | null;
  proof?: string;
}

/** Verify a signed challenge. `readOwner` is injectable so tests need no real token. */
export async function verifyOwnership(
  nonce: string,
  signature: string,
  opts: { readOwner?: (tokenId: number) => Promise<string | null> } = {},
): Promise<OwnershipResult> {
  const ch = challenges.get(nonce);
  if (!ch || Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(nonce);
    return { ok: false, code: 'unknown-challenge' };
  }
  // Single-use: consumed on any attempt so a signature can never be replayed.
  challenges.delete(nonce);

  let valid = false;
  try {
    valid = await verifyMessage({
      address: ch.address as `0x${string}`,
      message: ch.message,
      signature: signature as Hex,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, code: 'bad-signature', tokenId: ch.tokenId, address: ch.address };

  let owner: string | null = null;
  try {
    owner = await (opts.readOwner ?? readOwner)(ch.tokenId);
  } catch {
    owner = null;
  }
  if (!owner || owner.toLowerCase() !== ch.address.toLowerCase()) {
    return { ok: false, code: 'not-owner', tokenId: ch.tokenId, address: ch.address, owner };
  }
  return { ok: true, tokenId: ch.tokenId, address: ch.address, owner, proof: issueProof(ch.tokenId, ch.address) };
}

function issueProof(tokenId: number, address: string, now = Date.now()): string {
  const exp = now + PROOF_TTL_MS;
  const body = `${address.toLowerCase()}:${exp}`;
  const mac = createHmac('sha256', SECRET).update(`${tokenId}:${body}`).digest('hex');
  return `${body}.${mac}`;
}

/** Validate a proof for a specific token; returns the proven address or null. */
export function validateProof(proof: string, tokenId: number): { address: string } | null {
  const raw = String(proof ?? '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const colon = body.lastIndexOf(':');
  if (colon <= 0) return null;
  const address = body.slice(0, colon);
  const exp = Number(body.slice(colon + 1));
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !Number.isFinite(exp) || exp < Date.now()) return null;
  const expect = createHmac('sha256', SECRET).update(`${tokenId}:${body}`).digest('hex');
  const got = Buffer.from(mac, 'hex');
  const wanted = Buffer.from(expect, 'hex');
  if (got.length !== wanted.length || !timingSafeEqual(got, wanted)) return null;
  return { address };
}
