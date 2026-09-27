/**
 * Helixa Cred — the real scoring system (cred.exchange provider).
 *
 * Published per ERC-8004 agent as a trust assessment JSON:
 *   https://api.helixa.xyz/.well-known/intuition/erc8004/agents/8453/<agentId>/trust-assessment.json
 *
 * Looper agent ids are not assessed yet (404), so this reads best-effort and
 * caches the answer — the UI/MCP surface it the moment Helixa publishes one.
 */
const ASSESSMENT_BASE = 'https://api.helixa.xyz/.well-known/intuition/erc8004/agents/8453';
const TTL_MS = 10 * 60_000;

export interface HelixaCred {
  score: number;
  scoreScale: string;
  tier: string;
  riskLevel?: string;
  lastUpdated?: string;
  provider?: string;
  dimensions?: Record<string, number>;
  source: string;
}

const cache = new Map<string, { at: number; value: HelixaCred | null }>();

export async function readHelixaCred(agentId: string): Promise<HelixaCred | null> {
  const hit = cache.get(agentId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: HelixaCred | null = null;
  try {
    const res = await fetch(`${ASSESSMENT_BASE}/${agentId}/trust-assessment.json`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        provider?: { id?: string; name?: string };
        assessment?: {
          score?: number;
          scoreScale?: string;
          tier?: string;
          riskLevel?: string;
          lastUpdated?: string;
          dimensions?: Record<string, number>;
        };
      };
      const a = json.assessment ?? {};
      if (typeof a.score === 'number') {
        value = {
          score: a.score,
          scoreScale: a.scoreScale ?? '0-100',
          tier: a.tier ?? 'unknown',
          riskLevel: a.riskLevel,
          lastUpdated: a.lastUpdated,
          provider: json.provider?.name ?? json.provider?.id,
          dimensions: a.dimensions,
          source: 'helixa-cred',
        };
      }
    }
  } catch {
    // network hiccup — cached as unknown, retried after TTL
  }

  console.error(`[cred] helixa assessment for agent ${agentId}: ${value ? `${value.score}/${value.scoreScale} ${value.tier}` : 'not published'}`);
  cache.set(agentId, { at: Date.now(), value });
  return value;
}

export function credEndpointHint(): string {
  return ASSESSMENT_BASE;
}
