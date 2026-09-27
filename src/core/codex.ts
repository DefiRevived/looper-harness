import { fetchArweaveJson } from './arweave.js';
import { readTokenIdentity, type TokenIdentity } from './chain.js';

export interface CodexTraitAtom {
  id?: string;
  key?: string;
  layer?: string;
  trait?: string;
  archetype?: string;
  role?: string;
  narrative_seed?: string;
  voice?: string;
  values?: string;
  mission_bias?: string;
  risk_delta?: number;
  autonomy_delta?: number;
}

export interface CodexPersonality {
  quirks?: string[];
  communication_style?: string[];
  values?: string[];
  humor?: string[];
  voice?: string;
  risk_tolerance?: number;
  risk_profile?: string;
  autonomy_level?: number;
  autonomy_profile?: string;
}

export interface CodexActivation {
  activation_seed?: string;
  first_mission?: string;
  first_missions?: string[];
  activation_prompt?: string;
  cred_evolution_hint?: string;
}

export interface CodexLore {
  origin?: string;
  mission_bias?: string;
  short_lore?: string;
  long_lore?: string;
}

export interface CodexProvenance {
  source_compiler?: string;
  hashlips_dna?: string;
  hashlips_edition?: number;
  generated_at?: string;
}

export interface LooperCodex {
  schema_version?: string;
  token_id: number;
  name?: string;
  image?: string;
  external_url?: string;
  class_scores?: Record<string, number>;
  agent_class?: string;
  secondary_class?: string | null;
  specialization?: string;
  personality?: CodexPersonality;
  lore?: CodexLore;
  activation?: CodexActivation;
  provenance?: CodexProvenance;
  selected_visual_traits?: Array<{ layer: string; trait: string }>;
  trait_atoms?: CodexTraitAtom[];
  token_metadata_uri?: string;
  trait_codex_version?: string;
  [key: string]: unknown;
}

export interface LooperMetadata {
  name?: string;
  description?: string;
  image?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  codex_uri?: string;
  [key: string]: unknown;
}

export interface LooperBundle {
  identity: TokenIdentity;
  metadata: LooperMetadata;
  codex: LooperCodex;
  codexSource: 'arweave' | 'synthesized';
}

const BUNDLE_TTL_MS = 5 * 60_000;
const bundleCache = new Map<number, { at: number; bundle: LooperBundle }>();

export function invalidateLooper(tokenId: number): void {
  bundleCache.delete(tokenId);
}

export async function loadLooper(tokenId: number): Promise<LooperBundle> {
  const hit = bundleCache.get(tokenId);
  if (hit && Date.now() - hit.at < BUNDLE_TTL_MS) return hit.bundle;

  const identity = await readTokenIdentity(tokenId);
  const metadata = await fetchMetadata(identity.tokenUri);

  let codex: LooperCodex;
  let codexSource: 'arweave' | 'synthesized';
  const codexUri = typeof metadata.codex_uri === 'string' ? metadata.codex_uri : '';

  if (codexUri) {
    try {
      codex = await fetchArweaveJson<LooperCodex>(codexUri);
      codexSource = 'arweave';
    } catch (err) {
      console.warn(`[codex] ${codexUri} unreachable for token ${tokenId} (${(err as Error).message}); synthesizing from attributes`);
      codex = synthesizeCodex(identity, metadata);
      codexSource = 'synthesized';
    }
  } else {
    codex = synthesizeCodex(identity, metadata);
    codexSource = 'synthesized';
  }

  const bundle: LooperBundle = { identity, metadata, codex, codexSource };
  bundleCache.set(tokenId, { at: Date.now(), bundle });
  return bundle;
}

async function fetchMetadata(tokenUri: string): Promise<LooperMetadata> {
  if (tokenUri.startsWith('data:application/json')) {
    const comma = tokenUri.indexOf(',');
    const head = tokenUri.slice(0, comma);
    const payload = tokenUri.slice(comma + 1);
    const text = head.includes(';base64') ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
    return JSON.parse(text) as LooperMetadata;
  }
  return fetchArweaveJson<LooperMetadata>(tokenUri);
}

/**
 * Fallback for tokens whose codex cannot be fetched (or collections without one):
 * build a minimal persona from plain attributes so the agent still activates.
 */
function synthesizeCodex(identity: TokenIdentity, metadata: LooperMetadata): LooperCodex {
  const attrs = metadata.attributes ?? [];
  const attr = (name: string): string | undefined => {
    const found = attrs.find((a) => a.trait_type.toLowerCase() === name.toLowerCase());
    return found ? String(found.value) : undefined;
  };
  const traits = attrs
    .map((a) => ({ layer: a.trait_type, trait: String(a.value) }))
    .filter((t) => t.trait.toLowerCase() !== 'none');

  return {
    token_id: identity.tokenId,
    name: metadata.name ?? `Looper #${identity.tokenId}`,
    image: metadata.image,
    external_url: metadata.external_url,
    agent_class: attr('Agent Class') ?? 'Unclassified',
    secondary_class: null,
    specialization: attr('Specialization'),
    personality: {
      voice: attr('voice'),
      risk_profile: attr('Risk'),
      autonomy_profile: attr('Autonomy'),
    },
    selected_visual_traits: traits,
    activation: { first_missions: [] },
  };
}
