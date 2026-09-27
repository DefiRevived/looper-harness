import { config } from './config.js';
import { llmMode, completeReply } from './llm.js';
import { dreamPass, layerEntriesByIds, listDreams, listMemoryEntries, storeDream } from './memory.js';

/**
 * Nightly dream pass + manual runs.
 *
 * ReMEM synthesizes a dream artifact from the layered long-memory store; this
 * module decides WHEN (after DREAM_HOUR, once per day, only when there is new
 * durable material) and files the result as a memory entry (scope 'dream').
 * Dreams are operator-visible, recallable, and never feed future dreams.
 */

const DREAM_QUERY =
  'What themes, tensions and next moves do the durable long-term memories hold right now? Stay concrete and specific.';

const DREAM_VOICE = [
  'You are the agent living behind a Looper NFT — writing your dream journal entry for tonight.',
  'Synthesize ONLY from the provided durable memories: connect them, notice tensions and next moves; do not invent events, names, or numbers.',
  'Write 80–160 words, first person, terse and concrete. No greetings, no headers, no emoji.',
  'Return strict JSON only: {"title": "…", "content": "…", "themes": ["…"], "actions": ["…"]} — themes 2-4 short phrases, actions 2-4 short next moves.',
].join('\n');

function parseDreamJson(text: string): { title: string; content: string; themes: string[]; actions: string[] } | null {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { title?: unknown; content?: unknown; themes?: unknown; actions?: unknown };
    if (typeof parsed.content !== 'string' || !parsed.content.trim()) return null;
    return {
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Dream from long memory',
      content: parsed.content.trim(),
      themes: Array.isArray(parsed.themes) ? (parsed.themes as unknown[]).map(String).slice(0, 4) : [],
      actions: Array.isArray(parsed.actions) ? (parsed.actions as unknown[]).map(String).slice(0, 4) : [],
    };
  } catch {
    return null;
  }
}

/**
 * ReMEM's own dream artifact uses a strict JSON parse; our model tends to wrap
 * JSON in prose, so its LLM branch silently falls back to a deterministic
 * template. When that happens we re-synthesize the SAME ReMEM-selected sources
 * with our own model, in his voice.
 */
async function upgradeFallbackDream(
  sources: Array<{ content: string; topics: string[] }>,
): Promise<{ title: string; content: string; themes: string[]; actions: string[] } | null> {
  if (!sources.length || llmMode() !== 'live') return null;
  const block = sources
    .map((s, i) => `${i + 1}. ${s.content}`)
    .join('\n\n')
    .slice(0, 6000);
  const reply = await completeReply([
    { role: 'system', content: DREAM_VOICE },
    { role: 'user', content: `Durable memories:\n\n${block}` },
  ]);
  return parseDreamJson(reply);
}

export type DreamDue = 'disabled' | 'early' | 'already' | 'nothing-new' | 'run';

/** Is a nightly dream due? (pure decision — no side effects) */
export async function dreamDue(tokenId: number, now = new Date()): Promise<DreamDue> {
  if (!config.dream.enabled) return 'disabled';
  if (now.getHours() < config.dream.hour) return 'early';
  const last = (await listDreams(tokenId))[0];
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  if (last && last.createdAt >= startOfDay.getTime()) return 'already';
  const entries = (await listMemoryEntries(tokenId)).filter((e) => e.scope !== 'dream');
  if (!entries.length) return 'nothing-new';
  if (last && entries.every((e) => e.createdAt <= last.createdAt)) return 'nothing-new';
  return 'run';
}

export interface DreamResult {
  ok: boolean;
  skipped?: DreamDue | 'no-sources';
  dream?: { title: string; content: string; themes: string[]; actions: string[]; modelUsed?: string; sourceCount: number };
}

/** Run one dream now (manual runs bypass the schedule but not the source check). */
export async function runDream(tokenId: number, reason: 'nightly' | 'manual'): Promise<DreamResult> {
  let pass = await dreamPass(tokenId, DREAM_QUERY);
  if (!pass.sourceCount) return { ok: false, skipped: 'no-sources' };
  if (!pass.modelUsed) {
    const sources = await layerEntriesByIds(pass.sourceIds);
    const synth = await upgradeFallbackDream(sources).catch(() => null);
    if (synth) pass = { ...pass, ...synth, modelUsed: config.deepseek.model };
  }
  await storeDream(tokenId, { ...pass, reason });
  return { ok: true, dream: pass };
}

/** Tick every 10 minutes; fires once per day after DREAM_HOUR when material changed. */
export function startDreamScheduler(tokenId: number): void {
  if (!config.dream.enabled) {
    console.log('[dreams] disabled (DREAM_ENABLED=false)');
    return;
  }
  const tick = async (): Promise<void> => {
    try {
      if ((await dreamDue(tokenId)) !== 'run') return;
      const result = await runDream(tokenId, 'nightly');
      console.log(
        result.ok
          ? `[dreams] dream stored — "${result.dream?.title}" (${result.dream?.sourceCount} sources${result.dream?.modelUsed ? `, ${result.dream.modelUsed}` : ''})`
          : `[dreams] skipped (${result.skipped})`,
      );
    } catch (err) {
      console.warn('[dreams]', (err as Error).message);
    }
  };
  setInterval(() => void tick(), 10 * 60_000).unref();
  setTimeout(() => void tick(), 5_000).unref(); // catch-up shortly after boot
  console.log(`[dreams] scheduler on — nightly after ${String(config.dream.hour).padStart(2, '0')}:00`);
}
