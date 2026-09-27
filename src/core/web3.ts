import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, decodeFunctionData, fallback, formatEther, http, parseEther, toFunctionSelector, type Chain, type PublicClient } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { config } from './config.js';
import { blockscoutAbi } from './research.js';

/**
 * Server-side web3 reads for the agent (Web3 Phase A).
 *
 * Everything here is READ-ONLY: ABI lookup (Sourcify), eth_call reads,
 * transaction dry-runs (simulate) and tx status. No keys, no signing, no
 * state changes — the agent holds no wallet, ever. Chains: Base mainnet
 * (8453) + Base Sepolia (84532, the safe test loop).
 */

export type Web3Chain = 'base' | 'sepolia';

interface ChainDef {
  id: number;
  label: string;
  viem: Chain;
  explorer: string;
  rpcs: string[];
}

const CHAINS: Record<Web3Chain, ChainDef> = {
  base: {
    id: 8453,
    label: 'Base mainnet',
    viem: base,
    explorer: 'https://basescan.org',
    rpcs: [config.rpcUrl, 'https://base.llamarpc.com', 'https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
  },
  sepolia: {
    id: 84532,
    label: 'Base Sepolia (testnet)',
    viem: baseSepolia,
    explorer: 'https://sepolia.basescan.org',
    rpcs: [config.sepoliaRpcUrl, 'https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
  },
};

/** Parse a chain argument — 'base' | 'sepolia' (ids accepted); undefined → base. */
export function parseChain(input: unknown): Web3Chain | null {
  if (input === undefined || input === null || input === '') return 'base';
  const s = String(input).trim().toLowerCase();
  if (s === 'base' || s === '8453') return 'base';
  if (s === 'sepolia' || s === 'base-sepolia' || s === '84532') return 'sepolia';
  return null;
}

export const chainLabel = (c: Web3Chain): string => CHAINS[c].label;
export const chainIdOf = (c: Web3Chain): number => CHAINS[c].id;
export const explorerTx = (c: Web3Chain, hash: string): string => `${CHAINS[c].explorer}/tx/${hash}`;

const clients = new Map<Web3Chain, PublicClient>();

function clientFor(c: Web3Chain): PublicClient {
  let client = clients.get(c);
  if (!client) {
    const def = CHAINS[c];
    const urls = [...new Set(def.rpcs.filter(Boolean))];
    client = createPublicClient({
      chain: def.viem as typeof base,
      transport: fallback(urls.map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
    }) as PublicClient;
    clients.set(c, client);
  }
  return client;
}

/** Connectivity beacon (used by tests + the status line). */
export async function getLatestBlock(c: Web3Chain): Promise<bigint> {
  return clientFor(c).getBlockNumber();
}

// --- ABI resolution (Sourcify) -------------------------------------------------

const abiDir = path.join(config.dataDir, 'cache', 'abi');
const ABI_TTL_MS = 24 * 60 * 60 * 1000;

export type AbiLookup =
  | { ok: true; abi: unknown[]; verified: string; from: 'cache' | 'sourcify' | 'blockscout' }
  | { ok: false; reason: string };

export async function lookupAbi(chain: Web3Chain, address: string): Promise<AbiLookup> {
  const addr = address.toLowerCase();
  const file = path.join(abiDir, `${CHAINS[chain].id}-${addr}.json`);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < ABI_TTL_MS) {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as { abi: unknown[]; verified?: string };
      if (Array.isArray(cached.abi) && cached.abi.length) {
        return { ok: true, abi: cached.abi, verified: cached.verified ?? 'cached', from: 'cache' };
      }
    }
  } catch {
    // cache miss — fetch below
  }

  // Proxies (USDC, most upgradeable contracts) verify as the PROXY — whose own
  // ABI only has admin/upgrade functions. Follow Sourcify's proxyResolution to
  // the implementation and return THAT ABI (up to 3 hops).
  const chainId = CHAINS[chain].id;
  let current = addr;
  let hops = 0;
  let implNote = '';
  let result: { abi: unknown[]; match: string; impl: string | null } | null = null;
  while (hops < 3) {
    const fetched = await sourcifyAbi(chainId, current);
    if (!fetched.ok) {
      if (hops === 0) {
        // Sourcify doesn't know it — try Blockscout (Base/Sepolia verified source).
        const viaBlockscout = await blockscoutAbi(chain, addr);
        if (viaBlockscout) {
          const verified = `blockscout · ${viaBlockscout.name}`;
          fs.mkdirSync(abiDir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), verified, abi: viaBlockscout.abi }));
          return { ok: true, abi: viaBlockscout.abi, verified, from: 'blockscout' };
        }
        return { ok: false, reason: fetched.reason };
      }
      return {
        ok: false,
        reason: `verified as a proxy (${addr}) but its implementation ${current} has no ABI: ${fetched.reason}`,
      };
    }
    result = fetched.data;
    if (!result.impl || result.impl === current) break;
    if (!implNote) implNote = result.impl;
    current = result.impl;
    hops++;
  }
  if (!result) return { ok: false, reason: 'Sourcify returned no ABI for this address' };

  const verified = `${result.match}${current !== addr ? ` · proxy → ${current}` : ''}`;
  fs.mkdirSync(abiDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), verified, abi: result.abi }));
  return { ok: true, abi: result.abi, verified, from: 'sourcify' };
}

/** One Sourcify v2 lookup — returns the ABI + any proxy implementation hint. */
async function sourcifyAbi(
  chainId: number,
  addr: string,
): Promise<{ ok: true; data: { abi: unknown[]; match: string; impl: string | null } } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${addr}?fields=abi,proxyResolution`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return { ok: false, reason: 'not verified on Sourcify (no public ABI for this address)' };
    if (!res.ok) return { ok: false, reason: `Sourcify responded HTTP ${res.status}` };
    const data = (await res.json()) as {
      abi?: unknown;
      match?: string | null;
      proxyResolution?: { isProxy?: boolean; implementations?: Array<{ address?: unknown }> };
    };
    let abi: unknown[] | null = null;
    if (Array.isArray(data.abi)) abi = data.abi as unknown[];
    else if (typeof data.abi === 'string') {
      try {
        const parsed = JSON.parse(data.abi) as unknown;
        if (Array.isArray(parsed)) abi = parsed;
      } catch {
        // unparseable — treat as unverified
      }
    }
    if (!abi || !abi.length) return { ok: false, reason: 'Sourcify returned no ABI for this address' };
    const implRaw = data.proxyResolution?.isProxy ? data.proxyResolution.implementations?.[0]?.address : null;
    const impl = typeof implRaw === 'string' && /^0x[0-9a-fA-F]{40}$/.test(implRaw) ? implRaw.toLowerCase() : null;
    return { ok: true, data: { abi, match: data.match ?? 'unknown', impl } };
  } catch (err) {
    return { ok: false, reason: `could not reach Sourcify (${(err as Error).message.slice(0, 140)})` };
  }
}

// --- ABI helpers ----------------------------------------------------------------

interface AbiItem {
  type?: string;
  name?: string;
  inputs?: Array<{ type: string }>;
  outputs?: Array<{ type: string }>;
  stateMutability?: string;
}

const sigOf = (i: AbiItem): string => `${i.name}(${(i.inputs ?? []).map((x) => x.type).join(',')})`;

function findFunction(abi: unknown[], spec: string): { item: AbiItem; sig: string } | { error: string } {
  const items = (abi as AbiItem[]).filter((i) => i.type === 'function' && i.name);
  const want = spec.trim().replace(/\s+/g, '');
  const matches = want.includes('(')
    ? items.filter((i) => sigOf(i) === want)
    : items.filter((i) => i.name === want);
  if (!matches.length) {
    const available = items.slice(0, 30).map(sigOf);
    return { error: `function "${want}" is not in the ABI. Available: ${available.join(', ')}${items.length > 30 ? ` … (${items.length} total)` : ''}` };
  }
  if (matches.length > 1) {
    return { error: `"${want}" is overloaded — pass the full signature, one of: ${matches.map(sigOf).join(', ')}` };
  }
  return { item: matches[0], sig: sigOf(matches[0]) };
}

function coerceArgs(item: AbiItem, raw: unknown): { ok: true; args: unknown[] } | { ok: false; reason: string } {
  const inputs = item.inputs ?? [];
  const list = raw === undefined || raw === null ? [] : raw;
  if (!Array.isArray(list)) return { ok: false, reason: '"args" must be a JSON array of arguments' };
  if (list.length !== inputs.length) {
    return { ok: false, reason: `${item.name} expects ${inputs.length} argument(s) (${inputs.map((i) => i.type).join(', ')}) — got ${list.length}` };
  }
  const out: unknown[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const t = inputs[i].type;
    const v = list[i];
    try {
      if (/^u?int[\d]*$/.test(t)) out.push(BigInt(v as string | number | bigint));
      else if (t === 'bool') out.push(typeof v === 'string' ? v === 'true' : Boolean(v));
      else if (t === 'address') {
        if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error('not a 0x address');
        out.push(v);
      } else if (t === 'string') out.push(String(v));
      else if (t.startsWith('bytes')) {
        if (typeof v !== 'string' || !v.startsWith('0x')) throw new Error('expected 0x hex string');
        out.push(v);
      } else out.push(v); // arrays / tuples passed through
    } catch (err) {
      return { ok: false, reason: `argument ${i + 1} (${t}) is not valid: ${(err as Error).message}` };
    }
  }
  return { ok: true, args: out };
}

export function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serializeValue(v)]));
  }
  return value;
}

async function resolveCall(
  chain: Web3Chain,
  address: string,
  fnSpec: string,
  argsRaw: unknown,
  abiJson: string | undefined,
): Promise<{ ok: true; item: AbiItem; sig: string; args: unknown[]; verified: string } | { ok: false; reason: string }> {
  let abi: unknown[];
  let verified = 'provided by caller';
  if (abiJson) {
    try {
      const parsed = JSON.parse(abiJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error('not a JSON array');
      abi = parsed;
    } catch (err) {
      return { ok: false, reason: `"abi" is not a valid ABI array: ${(err as Error).message}` };
    }
  } else {
    const lookup = await lookupAbi(chain, address);
    if (!lookup.ok) {
      return { ok: false, reason: `${lookup.reason}. Pass an explicit "abi" fragment (JSON array) if you have verified source from elsewhere.` };
    }
    abi = lookup.abi;
    verified = lookup.verified;
  }
  const found = findFunction(abi, fnSpec);
  if ('error' in found) return { ok: false, reason: found.error };
  const coerced = coerceArgs(found.item, argsRaw);
  if (!coerced.ok) return { ok: false, reason: coerced.reason };
  return { ok: true, item: found.item, sig: found.sig, args: coerced.args, verified };
}

// --- Reads (eth_call, view/pure only) --------------------------------------------

export type ReadOutcome =
  | { ok: true; sig: string; value: unknown; outputs: string[]; abiVerified: string }
  | { ok: false; reason: string };

export async function readContractFunction(
  chain: Web3Chain,
  address: string,
  fnSpec: string,
  argsRaw: unknown,
  abiJson?: string,
): Promise<ReadOutcome> {
  const resolved = await resolveCall(chain, address, fnSpec, argsRaw, abiJson);
  if (!resolved.ok) return resolved;
  const mut = resolved.item.stateMutability ?? '';
  if (mut !== 'view' && mut !== 'pure') {
    return {
      ok: false,
      reason: `"${resolved.sig}" is a ${mut || 'state-changing'} function — read_contract only executes view/pure reads. Use simulate_call to dry-run it as a transaction instead.`,
    };
  }
  try {
    const client = clientFor(chain) as unknown as { readContract: (a: Record<string, unknown>) => Promise<unknown> };
    const abi: unknown[] = [resolved.item];
    const value = await client.readContract({ address, abi, functionName: resolved.item.name, args: resolved.args });
    return {
      ok: true,
      sig: resolved.sig,
      value: serializeValue(value),
      outputs: (resolved.item.outputs ?? []).map((o) => o.type),
      abiVerified: resolved.verified,
    };
  } catch (err) {
    const msg = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
    return { ok: false, reason: `call failed: ${msg.slice(0, 260)}` };
  }
}

// --- Simulation (dry-run eth_call of a transaction) ------------------------------

export type SimOutcome =
  | { ok: true; sig: string; result: unknown; gasEstimate: string | null; from: string }
  | { ok: false; reverted: boolean; reason: string };

export async function simulateCall(
  chain: Web3Chain,
  to: string,
  fnSpec: string,
  argsRaw: unknown,
  from?: string,
  valueEth?: string | number,
  abiJson?: string,
): Promise<SimOutcome> {
  const resolved = await resolveCall(chain, to, fnSpec, argsRaw, abiJson);
  if (!resolved.ok) return { ok: false, reverted: false, reason: resolved.reason };
  const fromAddr = (typeof from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(from)
    ? from
    : '0x0000000000000000000000000000000000000000') as `0x${string}`;
  let value: bigint | undefined;
  if (valueEth !== undefined && valueEth !== null && String(valueEth).trim() !== '') {
    try {
      value = parseEther(String(valueEth));
    } catch {
      return { ok: false, reverted: false, reason: `value "${valueEth}" is not a valid ETH amount` };
    }
  }
  const abi: unknown[] = [resolved.item];
  const client = clientFor(chain) as unknown as {
    simulateContract: (a: Record<string, unknown>) => Promise<{ result: unknown }>;
    estimateContractGas: (a: Record<string, unknown>) => Promise<bigint>;
  };
  try {
    const sim = await client.simulateContract({
      address: to,
      abi,
      functionName: resolved.item.name,
      args: resolved.args,
      account: fromAddr,
      value,
    });
    let gas: string | null = null;
    try {
      gas = (
        await client.estimateContractGas({ address: to, abi, functionName: resolved.item.name, args: resolved.args, account: fromAddr, value })
      ).toString();
    } catch {
      // best-effort
    }
    return { ok: true, sig: resolved.sig, result: serializeValue(sim.result), gasEstimate: gas, from: fromAddr };
  } catch (err) {
    const short = (err as { shortMessage?: string }).shortMessage ?? '';
    const msg = short || (err as Error).message;
    return { ok: false, reverted: /revert/i.test(msg), reason: msg.slice(0, 320) };
  }
}

// --- Transaction status -----------------------------------------------------------

export type TxOutcome =
  | { ok: true; receipt: { status: string; block: string; gasUsed: string; from: string; to: string | null; logs: number } }
  | { ok: false; pending: boolean; reason: string };

export async function txStatus(chain: Web3Chain, hash: string): Promise<TxOutcome> {
  try {
    const r = await clientFor(chain).getTransactionReceipt({ hash: hash as `0x${string}` });
    return {
      ok: true,
      receipt: {
        status: r.status,
        block: r.blockNumber.toString(),
        gasUsed: r.gasUsed.toString(),
        from: r.from,
        to: r.to,
        logs: r.logs.length,
      },
    };
  } catch (err) {
    const msg = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
    return { ok: false, pending: /not be found|could not be found/i.test(msg), reason: msg.slice(0, 220) };
  }
}

// --- JSON-RPC read proxy (for sandboxed dapp previews) ---------------------------

/** JSON-RPC-style error carrying a numeric code for the wire. */
export class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const cleanErr = (err: unknown): string => {
  const e = err as { shortMessage?: string; message?: string };
  return (e.shortMessage ?? e.message ?? 'unknown error').slice(0, 240);
};

/** Read-only methods dapp previews may call through the proxy. */
export const READ_RPC_METHODS = new Set([
  'eth_chainId',
  'net_version',
  'web3_clientVersion',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_estimateGas',
  'eth_getLogs',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
]);

const hexQ = (v: bigint | number): string => `0x${(typeof v === 'bigint' ? v : BigInt(v)).toString(16)}`;

function tagToBlock(tag: unknown): 'latest' | 'earliest' | 'pending' | bigint {
  if (typeof tag !== 'string' || !tag || tag === 'latest') return 'latest';
  if (tag === 'earliest' || tag === 'pending') return tag;
  if (/^0x[0-9a-fA-F]+$/.test(tag)) return BigInt(tag);
  return 'latest';
}

const TYPE_IDS: Record<string, number> = { legacy: 0, eip2930: 1, eip1559: 2, eip4844: 3, eip7702: 4 };

interface LooseLog {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: bigint | null;
  transactionHash: string | null;
  transactionIndex: number | null;
  blockHash: string | null;
  logIndex: number | null;
  removed?: boolean;
}

const mapLog = (l: LooseLog): Record<string, unknown> => ({
  address: l.address,
  topics: [...l.topics],
  data: l.data,
  blockNumber: l.blockNumber === null ? null : hexQ(l.blockNumber),
  transactionHash: l.transactionHash,
  transactionIndex: l.transactionIndex === null ? null : hexQ(l.transactionIndex),
  blockHash: l.blockHash,
  logIndex: l.logIndex === null ? null : hexQ(l.logIndex),
  removed: Boolean(l.removed),
});

/** Loose shapes for the dynamic RPC facade (JSON-RPC data is inherently dynamic). */
interface LooseReceipt {
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  blockNumber: bigint;
  from: string;
  to: string | null;
  contractAddress: string | null;
  cumulativeGasUsed: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  logsBloom: string;
  status: string;
  type: string;
  logs: LooseLog[];
}

interface LooseTx {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
  nonce: number;
  input: string;
  blockNumber: bigint | null;
  blockHash: string | null;
  transactionIndex: number | null;
  gas: bigint;
  gasPrice?: bigint | null;
  type: string;
}

interface RpcClient {
  getBlockNumber: () => Promise<bigint>;
  getBalance: (a: Record<string, unknown>) => Promise<bigint>;
  getCode: (a: Record<string, unknown>) => Promise<string | undefined>;
  getStorageAt: (a: Record<string, unknown>) => Promise<string>;
  getTransactionCount: (a: Record<string, unknown>) => Promise<number>;
  getGasPrice: () => Promise<bigint>;
  estimateGas: (a: Record<string, unknown>) => Promise<bigint>;
  call: (a: Record<string, unknown>) => Promise<{ data?: string }>;
  getLogs: (a: Record<string, unknown>) => Promise<LooseLog[]>;
  getTransactionReceipt: (a: Record<string, unknown>) => Promise<LooseReceipt>;
  getTransaction: (a: Record<string, unknown>) => Promise<LooseTx>;
}

/** Execute one allowlisted JSON-RPC read against a chain. Throws RpcError on failure. */
export async function rpcRead(chain: Web3Chain, method: string, params: unknown[]): Promise<unknown> {
  const c = clientFor(chain) as unknown as RpcClient;
  const txParam = (params[0] ?? {}) as { from?: string; to?: string; data?: string; input?: string; value?: string };

  switch (method) {
    case 'eth_chainId':
      return hexQ(CHAINS[chain].id);
    case 'net_version':
      return String(CHAINS[chain].id);
    case 'web3_clientVersion':
      return 'looper-agent web3-proxy/1.0';
    case 'eth_blockNumber':
      return hexQ(await c.getBlockNumber());
    case 'eth_getBalance': {
      const address = String(params[0] ?? '') as `0x${string}`;
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new RpcError(-32602, 'invalid address');
      return hexQ(await c.getBalance({ address, blockTag: tagToBlock(params[1]) }));
    }
    case 'eth_call': {
      if (!txParam.to) throw new RpcError(-32602, 'eth_call requires a to address');
      try {
        const res = await c.call({
          account: txParam.from ?? undefined,
          to: txParam.to,
          data: txParam.data ?? txParam.input,
          value: txParam.value ? BigInt(txParam.value) : undefined,
          blockTag: tagToBlock(params[1]),
        });
        return res.data ?? '0x';
      } catch (err) {
        throw new RpcError(-32000, cleanErr(err));
      }
    }
    case 'eth_getCode': {
      const address = String(params[0] ?? '') as `0x${string}`;
      return (await c.getCode({ address, blockTag: tagToBlock(params[1]) })) ?? '0x';
    }
    case 'eth_getStorageAt': {
      const address = String(params[0] ?? '') as `0x${string}`;
      const slotRaw = String(params[1] ?? '0x0');
      const slot = /^0x[0-9a-fA-F]+$/.test(slotRaw) ? slotRaw : hexQ(BigInt(Number(slotRaw) || 0));
      return (await c.getStorageAt({ address, slot, blockTag: tagToBlock(params[2]) })) ?? '0x';
    }
    case 'eth_getTransactionCount': {
      const address = String(params[0] ?? '') as `0x${string}`;
      return hexQ(await c.getTransactionCount({ address, blockTag: tagToBlock(params[1]) }));
    }
    case 'eth_gasPrice':
      return hexQ(await c.getGasPrice());
    case 'eth_estimateGas': {
      if (!txParam.to) throw new RpcError(-32602, 'eth_estimateGas requires a to address');
      try {
        return hexQ(
          await c.estimateGas({
            account: txParam.from ?? undefined,
            to: txParam.to,
            data: txParam.data ?? txParam.input,
            value: txParam.value ? BigInt(txParam.value) : undefined,
          }),
        );
      } catch (err) {
        throw new RpcError(-32000, cleanErr(err));
      }
    }
    case 'eth_getLogs': {
      const f = (params[0] ?? {}) as { address?: unknown; topics?: unknown; fromBlock?: unknown; toBlock?: unknown };
      const args: Record<string, unknown> = {};
      if (f.address !== undefined) args.address = f.address;
      if (f.topics !== undefined) args.topics = f.topics;
      if (f.fromBlock !== undefined) args.fromBlock = tagToBlock(f.fromBlock);
      if (f.toBlock !== undefined) args.toBlock = tagToBlock(f.toBlock);
      const logs = await c.getLogs(args);
      return (logs ?? []).map((l) => mapLog(l));
    }
    case 'eth_getTransactionReceipt': {
      const hash = String(params[0] ?? '');
      try {
        const r = await c.getTransactionReceipt({ hash });
        return {
          transactionHash: r.transactionHash,
          transactionIndex: hexQ(r.transactionIndex),
          blockHash: r.blockHash,
          blockNumber: hexQ(r.blockNumber),
          from: r.from,
          to: r.to,
          contractAddress: r.contractAddress,
          cumulativeGasUsed: hexQ(r.cumulativeGasUsed),
          gasUsed: hexQ(r.gasUsed),
          effectiveGasPrice: hexQ(r.effectiveGasPrice),
          logsBloom: r.logsBloom,
          status: r.status === 'success' ? '0x1' : '0x0',
          type: hexQ(TYPE_IDS[String(r.type)] ?? 0),
          logs: r.logs.map((l) => mapLog(l)),
        };
      } catch {
        return null; // pending / unknown → JSON-RPC null
      }
    }
    case 'eth_getTransactionByHash': {
      const hash = String(params[0] ?? '');
      try {
        const t = await c.getTransaction({ hash });
        return {
          hash: t.hash,
          from: t.from,
          to: t.to,
          value: hexQ(t.value),
          nonce: hexQ(t.nonce),
          input: t.input,
          blockNumber: t.blockNumber === null ? null : hexQ(t.blockNumber),
          blockHash: t.blockHash,
          transactionIndex: t.transactionIndex === null ? null : hexQ(t.transactionIndex),
          gas: hexQ(t.gas),
          gasPrice: t.gasPrice === null || t.gasPrice === undefined ? null : hexQ(t.gasPrice),
          type: hexQ(TYPE_IDS[String(t.type)] ?? 0),
        };
      } catch {
        return null;
      }
    }
    default:
      throw new RpcError(-32601, `method not allowed: ${method}`);
  }
}

// --- Transaction inspection (for the host confirmation panel) --------------------

/** Discriminated, decoded description of a pending transaction. */
export interface TxInspect {
  chain: string;
  to: string;
  from: string | null;
  valueWei: string;
  valueEth: string;
  selector: string | null;
  decoded: { signature: string; args: unknown[] } | null;
  decodeNote: string;
  simulation: { ok: boolean; result?: string; reason?: string };
  gasEstimate: string | null;
}

/**
 * Decode + dry-run a transaction for the console's confirmation panel. The
 * panel shows THIS (server-side truth), never anything the build simply says
 * about itself. Proxies are followed via lookupAbi, so committee-deployed
 * contracts decode against their real implementation.
 */
export async function inspectTransaction(
  chain: Web3Chain,
  tx: { from?: unknown; to?: unknown; data?: unknown; value?: unknown },
): Promise<TxInspect> {
  const to = String(tx.to ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(to)) throw new RpcError(-32602, 'tx.to must be a 0x address');
  const data = typeof tx.data === 'string' && /^0x[0-9a-fA-F]*$/.test(tx.data) ? tx.data : '0x';
  let value = 0n;
  try {
    value = tx.value === undefined || tx.value === null || tx.value === '' ? 0n : BigInt(String(tx.value));
  } catch {
    throw new RpcError(-32602, 'tx.value must be wei (decimal or 0x hex)');
  }
  const fromRaw = typeof tx.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(tx.from) ? (tx.from as `0x${string}`) : null;
  const selector = data.length >= 10 ? data.slice(0, 10).toLowerCase() : null;

  let decoded: TxInspect['decoded'] = null;
  let decodeNote = selector ? '' : 'no calldata — plain ETH transfer';
  if (selector) {
    const lookup = await lookupAbi(chain, to);
    if (lookup.ok) {
      const fns = (lookup.abi as AbiItem[]).filter((i) => i.type === 'function' && i.name);
      const match = fns.find((i) => {
        try {
          return toFunctionSelector(sigOf(i) as never) === selector;
        } catch {
          return false;
        }
      });
      if (match) {
        try {
          const result = decodeFunctionData({ abi: [match] as never, data: data as `0x${string}` });
          decoded = { signature: sigOf(match), args: serializeValue(result.args ?? []) as unknown[] };
          decodeNote = `decoded via verified ABI (${lookup.verified})`;
        } catch (err) {
          decodeNote = `calldata did not decode cleanly: ${(err as Error).message.slice(0, 120)}`;
        }
      } else {
        decodeNote = `no verified function matches selector ${selector}`;
      }
    } else {
      decodeNote = lookup.reason;
    }
  }

  let simulation: TxInspect['simulation'];
  try {
    const res = await clientFor(chain).call({
      account: (fromRaw ?? undefined) as `0x${string}` | undefined,
      to: to as `0x${string}`,
      data: data as `0x${string}`,
      value: value > 0n ? value : undefined,
    });
    simulation = { ok: true, result: (res.data ?? '0x').slice(0, 200) };
  } catch (err) {
    simulation = { ok: false, reason: cleanErr(err) };
  }

  let gasEstimate: string | null = null;
  try {
    gasEstimate = (
      await clientFor(chain).estimateGas({
        account: (fromRaw ?? undefined) as `0x${string}` | undefined,
        to: to as `0x${string}`,
        data: data as `0x${string}`,
        value: value > 0n ? value : undefined,
      })
    ).toString();
  } catch {
    // revert already reported by the simulation above
  }

  return {
    chain: chainLabel(chain),
    to,
    from: fromRaw,
    valueWei: value.toString(),
    valueEth: formatEther(value),
    selector,
    decoded,
    decodeNote,
    simulation,
    gasEstimate,
  };
}
