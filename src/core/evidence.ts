/**
 * Contract identity evidence — the inputs for canonical adjudication.
 * When a name resolves to several contracts (lookup_contract), the agent
 * gathers evidence per candidate: who deployed it, when, whether source is
 * verified, what token it carries — and whether ownerOf(your token id)
 * answers on it. The canonical collection is the one that holds the
 * operator's token; the ruling gets pinned with remember.
 */
import { blockscoutHost } from './research.js';
import { readContractFunction } from './web3.js';

export type EvmChain = 'base' | 'sepolia';

export interface ContractEvidence {
  address: string;
  source: 'blockscout';
  name?: string;
  verified?: boolean;
  proxyType?: string;
  implementations: Array<{ address: string; name?: string }>;
  creator?: string;
  creationTx?: string;
  token?: {
    name?: string;
    symbol?: string;
    totalSupply?: string;
    decimals?: number;
    holders?: string;
  };
  note: string;
}

export async function contractEvidence(chain: EvmChain, address: string): Promise<ContractEvidence> {
  const host = blockscoutHost(chain);
  const jget = async (pathname: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(`${host}${pathname}`, {
        headers: { 'user-agent': 'looper-harness', accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const [sc, addrInfo, token] = await Promise.all([
    jget(`/api/v2/smart-contracts/${address}`),
    jget(`/api/v2/addresses/${address}`),
    jget(`/api/v2/tokens/${address}`),
  ]);

  const implementations: Array<{ address: string; name?: string }> = [];
  if (sc && Array.isArray(sc.implementations)) {
    for (const raw of sc.implementations as Array<Record<string, unknown>>) {
      const implAddr = String(raw.address ?? raw.address_hash ?? '');
      if (/^0x[0-9a-fA-F]{40}$/.test(implAddr)) {
        implementations.push({ address: implAddr, name: raw.name ? String(raw.name) : undefined });
      }
    }
  }
  const holdersRaw = token ? (token.holders_count ?? token.holders) : null;
  return {
    address,
    source: 'blockscout',
    name: sc?.name ? String(sc.name) : undefined,
    verified: sc ? sc.is_verified === true : undefined,
    proxyType: sc?.proxy_type ? String(sc.proxy_type) : undefined,
    implementations,
    creator: addrInfo?.creator ? String(addrInfo.creator) : undefined,
    creationTx: addrInfo?.creation_tx_hash ? String(addrInfo.creation_tx_hash) : undefined,
    token: token
      ? {
          name: token.name ? String(token.name) : undefined,
          symbol: token.symbol ? String(token.symbol) : undefined,
          totalSupply: token.total_supply ? String(token.total_supply) : undefined,
          decimals: token.decimals == null ? undefined : Number(token.decimals),
          holders: holdersRaw == null ? undefined : String(holdersRaw),
        }
      : undefined,
    note: 'Evidence gathered from Blockscout (public explorer) at request time — quote the fields, not impressions.',
  };
}

/** Does this contract answer ownerOf(tokenId)? The canonical-collection test. */
export async function ownerOfCheck(chain: EvmChain, address: string, tokenId: number): Promise<{ ok: boolean; owner?: string; reason?: string }> {
  const outcome = await readContractFunction(chain, address, 'ownerOf(uint256)', [tokenId]);
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  const value = outcome.value;
  const owner = typeof value === 'string' ? value : String(value);
  return { ok: true, owner };
}
