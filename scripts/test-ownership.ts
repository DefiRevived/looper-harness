/**
 * Ownership-gate smoke test.
 *
 * Part 1 runs fully offline with dependency injection (no real Looper needed):
 * challenge → sign → verify, including all refusal paths.
 * Part 2 checks a fresh ownerOf read on Base via the live path.
 * Part 3 (best-effort) checks enforcement on the running dev server.
 */
import { privateKeyToAccount } from 'viem/accounts';
import { createChallenge, validateProof, verifyOwnership } from '../src/core/ownership.js';

let fails = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails++;
};

// Well-known public test key (from Ethereum test suites) — owns nothing, holds no value.
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const OTHER = '0x1111111111111111111111111111111111111111';

console.log('===== signature + ownership (injected reader) =====');
{
  const { nonce, message } = createChallenge(452, account.address);
  check('challenge message carries the token id + nonce', message.includes('Looper #452') && message.includes(nonce));
  const signature = await account.signMessage({ message });
  const res = await verifyOwnership(nonce, signature, { readOwner: async () => account.address });
  check('owner match → verified + proof issued', res.ok && !!res.proof, res.code ?? 'ok');
  check('proof validates for the right token', !!res.proof && !!validateProof(res.proof, 452));
  check('proof rejected for a different token', !!res.proof && !validateProof(res.proof, 1));
  check('proof rejected when tampered', !!res.proof && !validateProof(res.proof.slice(0, -1) + '0', 452));
  check('proof rejected when garbage', !validateProof('not-a-proof', 452));
}
{
  const { nonce, message } = createChallenge(452, account.address);
  const signature = await account.signMessage({ message });
  const res = await verifyOwnership(nonce, signature, { readOwner: async () => OTHER });
  check('owner mismatch → not-owner (signer returned)', !res.ok && res.code === 'not-owner' && res.address === account.address.toLowerCase(), res.owner ?? '');
}
{
  const { nonce } = createChallenge(452, account.address);
  const res = await verifyOwnership(nonce, `0x${'11'.repeat(65)}`, { readOwner: async () => account.address });
  check('garbage signature → bad-signature', !res.ok && res.code === 'bad-signature', res.code ?? '');
}
{
  const res = await verifyOwnership('deadbeef', '0x', { readOwner: async () => account.address });
  check('unknown nonce → rejected', !res.ok && res.code === 'unknown-challenge', res.code ?? '');
}
{
  const { nonce, message } = createChallenge(452, account.address);
  const signature = await account.signMessage({ message });
  await verifyOwnership(nonce, signature, { readOwner: async () => account.address });
  const replay = await verifyOwnership(nonce, signature, { readOwner: async () => account.address });
  check('nonce is single-use (replay refused)', !replay.ok, replay.code ?? '');
}

console.log('\n===== live chain check (real ownerOf on Base) =====');
{
  const { nonce, message } = createChallenge(452, account.address);
  const signature = await account.signMessage({ message });
  const res = await verifyOwnership(nonce, signature);
  check('test wallet does not own #452 (live read)', !res.ok && res.code === 'not-owner', `owner ${res.owner ?? 'unknown'}`);
}

console.log('\n===== live server enforcement (dev server on :4520, best-effort) =====');
try {
  const base = 'http://127.0.0.1:4520';
  const gated = await fetch(`${base}/api/looper/452`);
  if (gated.status === 200) {
    console.log('(gate is OFF on the running server — enforcement checks skipped)');
  } else {
    const body = (await gated.json()) as { code?: string };
    check('GET /api/looper without proof → gated', gated.status === 403 && body.code === 'OWNERSHIP_REQUIRED', `status ${gated.status} ${body.code ?? ''}`);

    const ch = await fetch(`${base}/api/ownership/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenId: 452, address: account.address }),
    });
    const chBody = (await ch.json()) as { nonce?: string; message?: string };
    check('challenge endpoint issues nonce + message', ch.status === 200 && !!chBody.nonce && !!chBody.message);

    const signature = await account.signMessage({ message: chBody.message ?? '' });
    const ver = await fetch(`${base}/api/ownership/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: chBody.nonce, signature }),
    });
    const verBody = (await ver.json()) as { code?: string; error?: string };
    check('valid signature, wrong wallet → refused (owner named)', ver.status === 403 && verBody.code === 'not-owner', verBody.error?.slice(0, 100) ?? '');

    const forged = await fetch(`${base}/api/looper/452`, { headers: { 'x-looper-proof': 'deadbeef:0.00' } });
    check('forged proof still gated', forged.status === 403, `status ${forged.status}`);
  }
} catch (err) {
  console.log(`(skipped — dev server not reachable: ${(err as Error).message})`);
}

console.log(fails === 0 ? '\nALL GREEN' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
