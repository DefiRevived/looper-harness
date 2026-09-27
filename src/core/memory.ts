import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MemoryStore, ReMEM } from '@darksol/remem';
import { config } from './config.js';
import { dataPath, llmApiKey } from './settings.js';

/**
 * Long-term agent memory, backed by Darksol's @darksol/remem package (its
 * MemoryStore core — the same local SQLite format ReMEM's higher-level smart
 * layer uses, so intake policy / smart recall / layers can ride the same file
 * later without migration). No cloud, no API key.
 *
 * The store keeps the whole database in memory per process, so another
 * process's committed writes (the bot, a migration script) are invisible to a
 * long-running instance. Both instances below are therefore re-opened whenever
 * the db file's stamp changes (stat: mtime+size — our db is tiny, the re-open
 * is milliseconds), which keeps the server and bot mutually fresh.
 *
 * Scopes are carried in entry metadata:
 *   agent → { scope: 'agent', tokenId }                               operator rules / durable facts
 *   build → { scope: 'build', tokenId, buildId }                      per-build history & decisions
 *   lock  → { scope: 'lock', tokenId, buildId, lockType, snippet? }   operator locks (enforced in tools)
 */

const memDbPath = (): string => dataPath('remem.db');

function dbStamp(): string {
  const file = memDbPath();
  try {
    const s = fs.statSync(file);
    return `${file}:${s.mtimeMs}:${s.size}`;
  } catch {
    return `${file}:missing`;
  }
}

let memInstance: { store: MemoryStore; stamp: string } | null = null;

async function getMem(): Promise<MemoryStore> {
  const stamp = dbStamp();
  if (memInstance && memInstance.stamp === stamp) return memInstance.store;
  fs.mkdirSync(path.dirname(memDbPath()), { recursive: true });
  const store = new MemoryStore(memDbPath());
  await store.init();
  memInstance = { store, stamp };
  return store;
}

let smartInstance: { smart: ReMEM; stamp: string; llmKey: string } | null = null;

/**
 * ReMEM's smart layer over the SAME SQLite file MemoryStore uses: intake
 * scoring/dedup on remember, relevance queries on recall. Best-effort — if
 * it fails, memory falls back to the plain store path. Re-opened on db-file
 * changes like the store above.
 */
async function getSmart(): Promise<ReMEM> {
  const stamp = dbStamp();
  const llmKey = llmApiKey();
  if (smartInstance && smartInstance.stamp === stamp && smartInstance.llmKey === llmKey) return smartInstance.smart;
  // DeepSeek is OpenAI-compatible — the dream pass uses this for its artifact.
  const llm = llmKey
    ? { type: 'openai' as const, apiKey: llmKey, model: config.deepseek.model, baseUrl: config.deepseek.baseUrl }
    : undefined;
  fs.mkdirSync(path.dirname(memDbPath()), { recursive: true });
  const smart = new ReMEM({
    storage: 'sqlite',
    dbPath: memDbPath(),
    embeddings: { enabled: false, baseUrl: '', model: '', asyncEmbed: false },
    ...(llm ? { llm } : {}),
  });
  await smart.init();
  smartInstance = { smart, stamp, llmKey };
  return smart;
}

// --- layered mirror (feeds ReMEM's dream pass) -------------------------------

/**
 * The dream pass synthesizes from ReMEM's LAYERED store (identity / semantic /
 * procedural), not the base memory table — so durable entries (operator rules,
 * build notes, episodes) are mirrored into the 'semantic' layer here.
 * Best-effort: a failed mirror only makes dreams thinner, never breaks a write.
 * Dreams themselves are never mirrored, so dreams can't dream about dreams.
 */
async function mirrorToLayer(content: string, topics: string[], metadata: Record<string, unknown>): Promise<void> {
  try {
    const smart = await getSmart();
    const storeInLayer = (
      smart as unknown as {
        storeInLayer?: (input: { content: string; topics: string[]; metadata: Record<string, unknown> }, layer: string) => Promise<unknown>;
      }
    ).storeInLayer;
    if (storeInLayer) await storeInLayer.call(smart, { content, topics, metadata }, 'semantic');
  } catch {
    // dreams degrade gracefully without mirrors
  }
}

/** How many entries the layered store already holds (0 when layers are off). */
async function layerEntryCount(): Promise<number> {
  try {
    const smart = await getSmart();
    const enable = (smart as unknown as { enableLayers?: () => Promise<void> }).enableLayers;
    const holder = smart as unknown as { layers?: { getAllEntries?: () => unknown[] } };
    if (!holder.layers && enable) await enable.call(smart);
    const all = holder.layers?.getAllEntries?.();
    return Array.isArray(all) ? all.length : 0;
  } catch {
    return 0;
  }
}

export type MemoryKind = 'fact' | 'preference' | 'decision' | 'procedure' | 'recent-event' | 'artifact-note';

export interface RememberArgs {
  tokenId: number;
  note: string;
  buildId?: string;
  kind?: MemoryKind;
}

export async function memoryRemember(args: RememberArgs): Promise<string> {
  const metadata: Record<string, unknown> = args.buildId
    ? { scope: 'build', tokenId: args.tokenId, buildId: args.buildId }
    : { scope: 'agent', tokenId: args.tokenId };
  if (args.kind) metadata.kind = args.kind;
  const mirrorTopics = args.buildId ? ['build'] : ['agent', 'operator'];
  if (args.kind) mirrorTopics.push(args.kind);
  try {
    const smart = await getSmart();
    const result = await smart.remember({
      content: args.note,
      topics: args.buildId ? ['build'] : ['agent'],
      metadata,
      ...(args.kind ? { kind: args.kind } : {}),
    });
    if (result.action === 'stored') {
      void mirrorToLayer(args.note, mirrorTopics, metadata);
      return args.buildId
        ? `Remembered for this build (intake: ${result.kind}). It persists with the build and is injected whenever this thread opens.`
        : `Remembered (intake: ${result.kind}${result.reason ? ` — ${result.reason}` : ''}). Durable long-term memory; survives chats, resets, and the context window.`;
    }
    if (result.action === 'skipped_duplicate') {
      return `Not stored — intake flagged this as a duplicate of an existing note${result.duplicateOf ? ` (${String(result.duplicateOf).slice(0, 8)}…)` : ''}. Nothing new was kept; say what changed instead.`;
    }
    if (result.action === 'skipped_low_signal') {
      return `Not stored — intake judged this low-signal (${result.reason || 'below threshold'}). Rephrase with more substance if it matters.`;
    }
    return `Intake result: ${result.action}.`;
  } catch {
    // Smart layer unavailable — plain store; memory still works.
    const m = await getMem();
    await m.store({ content: args.note, topics: args.buildId ? ['build'] : ['agent'], metadata });
    void mirrorToLayer(args.note, mirrorTopics, metadata);
    return args.buildId ? 'Remembered for this build.' : 'Remembered. Durable long-term memory.';
  }
}

export interface RecallEntry {
  id: string;
  content: string;
  createdAt: number;
  scope: 'agent' | 'build' | 'episode' | 'dream';
  buildId?: string;
  kind?: string;
}

/**
 * Recall semantics: in a build thread you get that build's memories plus
 * agent-wide rules; in the console you get agent-wide rules only. When
 * `about` is given, recall runs a RELEVANCE query (ReMEM) over the same
 * scope instead of returning the most recent entries.
 */
export async function memoryRecall(args: { tokenId: number; buildId?: string; limit?: number; about?: string; sessionKey?: string }): Promise<RecallEntry[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 20), 50);
  const scopeOk = (md: Record<string, unknown>, forAbout: boolean): boolean => {
    if (Number(md.tokenId) !== args.tokenId) return false;
    if (md.scope === 'agent') return true;
    if (md.scope === 'dream') return true; // dreams are global to the operator
    if (md.scope === 'build') return args.buildId ? md.buildId === args.buildId : false;
    if (md.scope === 'episode') return forAbout ? true : Boolean(args.sessionKey && md.sessionKey === args.sessionKey);
    return false;
  };
  const mapEntry = (e: { id: string; content: string; createdAt: number; metadata?: Record<string, unknown> }): RecallEntry => {
    const md = (e.metadata ?? {}) as Record<string, unknown>;
    return {
      id: e.id,
      content: e.content,
      createdAt: e.createdAt,
      scope: (md.scope === 'build' ? 'build' : md.scope === 'episode' ? 'episode' : md.scope === 'dream' ? 'dream' : 'agent') as 'agent' | 'build' | 'episode' | 'dream',
      buildId: typeof md.buildId === 'string' ? md.buildId : undefined,
      kind: typeof md.kind === 'string' ? md.kind : undefined,
    };
  };

  if (args.about) {
    try {
      const smart = await getSmart();
      const { results } = await smart.query(args.about, { limit: Math.max(limit, 10) });
      const hit = results
        .filter((e) => scopeOk((e.metadata ?? {}) as Record<string, unknown>, true))
        .slice(0, limit)
        .map(mapEntry);
      if (hit.length) return hit;
    } catch {
      // fall through to recent-list recall
    }
  }

  const m = await getMem();
  const all = await m.getAllEntries();
  return all
    .filter((e) => scopeOk((e.metadata ?? {}) as Record<string, unknown>, false))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(mapEntry);
}

/** Recent build-scoped notes as a context block for the build thread prompt. */
export async function buildMemoryDigest(tokenId: number, buildId: string, limit = 8): Promise<string> {
  const m = await getMem();
  const all = await m.getAllEntries();
  const notes = all
    .filter((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return md.scope === 'build' && Number(md.tokenId) === tokenId && md.buildId === buildId;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .reverse();
  if (!notes.length) return '';
  return notes
    .map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      const kind = typeof md.kind === 'string' ? ` (${md.kind})` : '';
      return `- [${new Date(e.createdAt).toISOString().slice(0, 10)}]${kind} ${e.content}`;
    })
    .join('\n');
}

// --- build locks (operator protection; enforced mechanically in tools) ------

export type LockType = 'freeze' | 'snippet';

export interface BuildLock {
  id: string;
  lockType: LockType;
  snippet: string;
  note: string;
  createdAt: number;
}

function toLock(e: { id: string; content: string; metadata?: Record<string, unknown>; createdAt: number }): BuildLock {
  const md = (e.metadata ?? {}) as Record<string, unknown>;
  return {
    id: e.id,
    lockType: md.lockType === 'snippet' ? 'snippet' : 'freeze',
    snippet: typeof md.snippet === 'string' ? md.snippet : '',
    note: e.content,
    createdAt: e.createdAt,
  };
}

export async function lockAdd(args: {
  tokenId: number;
  buildId: string;
  lockType: LockType;
  snippet?: string;
  note: string;
}): Promise<BuildLock> {
  const m = await getMem();
  const entry = await m.store({
    content: args.note,
    topics: ['lock'],
    metadata: {
      scope: 'lock',
      tokenId: args.tokenId,
      buildId: args.buildId,
      lockType: args.lockType,
      snippet: args.snippet ?? '',
    },
  });
  return toLock(entry);
}

export async function locksFor(tokenId: number, buildId: string): Promise<BuildLock[]> {
  const m = await getMem();
  const all = await m.getAllEntries();
  return all
    .filter((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return md.scope === 'lock' && Number(md.tokenId) === tokenId && md.buildId === buildId;
    })
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toLock);
}

export async function lockRemove(id: string): Promise<boolean> {
  const m = await getMem();
  return m.forget(id);
}

/** Forget every memory and lock attached to a build (used by delete_build). */
export async function purgeBuildMemory(tokenId: number, buildId: string): Promise<number> {
  const m = await getMem();
  const all = await m.getAllEntries();
  let n = 0;
  for (const e of all) {
    const md = (e.metadata ?? {}) as Record<string, unknown>;
    if (Number(md.tokenId) === tokenId && md.buildId === buildId) {
      if (await m.forget(e.id)) n++;
    }
  }
  return n;
}

/** Forget every entry for a token regardless of scope (maintenance / tests). */
export async function purgeTokenMemory(tokenId: number): Promise<number> {
  const m = await getMem();
  const all = await m.getAllEntries();
  let n = 0;
  for (const e of all) {
    const md = (e.metadata ?? {}) as Record<string, unknown>;
    if (Number(md.tokenId) === tokenId) {
      if (await m.forget(e.id)) n++;
    }
  }
  return n;
}

/**
 * Maintenance: rewrite stale build references in memory metadata (e.g. old
 * `<id>.html` ids → folder ids). Used by the folder-layout migration. The mappers
 * return null when there is nothing to change; content and timestamps are kept.
 */
export async function remapBuildReferences(
  buildIdMap: (buildId: string) => string | null,
  sessionKeyMap: (sessionKey: string) => string | null,
): Promise<{ updated: number; scanned: number }> {
  const m = await getMem();
  const all = await m.getAllEntries();
  let updated = 0;
  for (const e of all) {
    const md = { ...(e.metadata ?? {}) } as Record<string, unknown>;
    let changed = false;
    if (typeof md.buildId === 'string') {
      const next = buildIdMap(md.buildId);
      if (next && next !== md.buildId) {
        md.buildId = next;
        changed = true;
      }
    }
    if (typeof md.sessionKey === 'string') {
      const next = sessionKeyMap(md.sessionKey);
      if (next && next !== md.sessionKey) {
        md.sessionKey = next;
        changed = true;
      }
    }
    if (!changed) continue;
    const topics =
      md.scope === 'lock' ? ['lock'] : md.scope === 'build' ? ['build'] : md.scope === 'episode' ? ['episode', 'history'] : ['agent'];
    await m.forget(e.id);
    await m.store({ content: e.content, topics, metadata: md });
    updated++;
  }
  return { updated, scanned: all.length };
}

// --- operator views (console panels) -----------------------------------------

export interface MemoryEntryView {
  id: string;
  content: string;
  createdAt: number;
  scope: 'agent' | 'build' | 'episode' | 'dream';
  buildId?: string;
  sessionKey?: string;
  kind?: string;
}

/** Everything durable the agent holds for a token (agent/build/episode/dream scopes; locks and tasks excluded). */
export async function listMemoryEntries(tokenId: number, limit = 500): Promise<MemoryEntryView[]> {
  const m = await getMem();
  const all = await m.getAllEntries();
  return all
    .filter((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      const scope = md.scope;
      return (scope === 'agent' || scope === 'build' || scope === 'episode' || scope === 'dream') && Number(md.tokenId) === tokenId;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        content: e.content,
        createdAt: e.createdAt,
        scope: (md.scope === 'build' ? 'build' : md.scope === 'episode' ? 'episode' : md.scope === 'dream' ? 'dream' : 'agent') as MemoryEntryView['scope'],
        buildId: typeof md.buildId === 'string' ? md.buildId : undefined,
        sessionKey: typeof md.sessionKey === 'string' ? md.sessionKey : undefined,
        kind: typeof md.kind === 'string' ? md.kind : undefined,
      };
    });
}

export interface TokenLock extends BuildLock {
  buildId: string;
}

/** Every lock for a token, newest first (console ledger). */
export async function allLocks(tokenId: number): Promise<TokenLock[]> {
  const m = await getMem();
  const all = await m.getAllEntries();
  return all
    .filter((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return md.scope === 'lock' && Number(md.tokenId) === tokenId;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return { ...toLock(e), buildId: typeof md.buildId === 'string' ? md.buildId : '' };
    });
}

/** Forget one entry by id (operator panel). */
export async function forgetEntry(id: string): Promise<boolean> {
  return lockRemove(id);
}

// --- episodic memory (conversation history distilled into durable notes) ----

/** Store one distilled history episode (see src/core/episodes.ts). */
export async function storeEpisode(tokenId: number, sessionKey: string, coveredThroughAt: string, summary: string): Promise<void> {
  const m = await getMem();
  const metadata = { scope: 'episode', tokenId, sessionKey, coveredThroughAt };
  await m.store({ content: summary, topics: ['episode', 'history'], metadata });
  void mirrorToLayer(summary, ['episode', 'history'], metadata);
}

/** Timestamp of the latest covered message for a session (dedup bookkeeping). */
export async function latestEpisodeCoveredAt(sessionKey: string): Promise<string | null> {
  const m = await getMem();
  const all = await m.getAllEntries();
  let latest: string | null = null;
  for (const e of all) {
    const md = (e.metadata ?? {}) as Record<string, unknown>;
    if (md.scope === 'episode' && md.sessionKey === sessionKey && typeof md.coveredThroughAt === 'string') {
      if (!latest || md.coveredThroughAt > latest) latest = md.coveredThroughAt;
    }
  }
  return latest;
}

// --- dreams (ReMEM dream pass artifacts) -------------------------------------

export interface DreamView {
  id: string;
  title: string;
  content: string;
  themes: string[];
  actions: string[];
  modelUsed?: string;
  reason?: string;
  createdAt: number;
}

export interface DreamPassResult {
  title: string;
  content: string;
  themes: string[];
  actions: string[];
  modelUsed?: string;
  sourceCount: number;
  sourceIds: string[];
}

/** Run one ReMEM dream pass over the mirrored long-memory layers. */
export async function dreamPass(tokenId: number, query: string): Promise<DreamPassResult> {
  const smart = await getSmart();
  let dream = await smart.dream({ query, limit: 10, layers: ['identity', 'semantic', 'procedural'], metadata: { tokenId: { eq: tokenId } } });
  if (dream.sourceCount === 0) {
    // The metadata filter may not match our mirrored metadata shapes — retry
    // unfiltered (single-operator runtime; the store holds one token's memory).
    dream = await smart.dream({ query, limit: 10, layers: ['identity', 'semantic', 'procedural'] });
  }
  return {
    title: dream.title,
    content: dream.content,
    themes: dream.themes,
    actions: dream.actions,
    modelUsed: dream.modelUsed,
    sourceCount: dream.sourceCount,
    sourceIds: dream.sourceIds,
  };
}

/** Layer entries by id (the dream's own source selection), for follow-up synthesis. */
export async function layerEntriesByIds(ids: string[]): Promise<Array<{ id: string; content: string; topics: string[] }>> {
  if (!ids.length) return [];
  try {
    const smart = await getSmart();
    const enable = (smart as unknown as { enableLayers?: () => Promise<void> }).enableLayers;
    const holder = smart as unknown as { layers?: { getAllEntries?: () => Array<{ id: string; content: string; topics?: string[] }> } };
    if (!holder.layers && enable) await enable.call(smart);
    const all = holder.layers?.getAllEntries?.() ?? [];
    const wanted = new Set(ids);
    return all.filter((e) => wanted.has(e.id)).map((e) => ({ id: e.id, content: e.content, topics: e.topics ?? [] }));
  } catch {
    return [];
  }
}

/** Store one dream artifact as a memory entry (operator-visible, never re-mirrored). */
export async function storeDream(tokenId: number, d: DreamPassResult & { reason: string }): Promise<void> {
  const m = await getMem();
  await m.store({
    content: `${d.title}\n\n${d.content}`.slice(0, 6000),
    topics: ['dream', d.reason],
    metadata: {
      scope: 'dream',
      tokenId,
      kind: d.reason,
      themes: d.themes,
      actions: d.actions,
      modelUsed: d.modelUsed ?? '',
      sourceCount: d.sourceCount,
      reason: d.reason,
      dreamedAt: new Date().toISOString(),
    },
  });
}

/** Dreams for a token, newest first. */
export async function listDreams(tokenId: number): Promise<DreamView[]> {
  const m = await getMem();
  const all = await m.getAllEntries();
  return all
    .filter((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return md.scope === 'dream' && Number(md.tokenId) === tokenId;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      const sep = e.content.indexOf('\n\n');
      return {
        id: e.id,
        title: sep >= 0 ? e.content.slice(0, sep) : e.content,
        content: sep >= 0 ? e.content.slice(sep + 2) : '',
        themes: Array.isArray(md.themes) ? (md.themes as string[]) : [],
        actions: Array.isArray(md.actions) ? (md.actions as string[]) : [],
        modelUsed: typeof md.modelUsed === 'string' && md.modelUsed ? md.modelUsed : undefined,
        reason: typeof md.reason === 'string' ? md.reason : undefined,
        createdAt: e.createdAt,
      };
    });
}

/** Maintenance backfill: mirror existing durable entries into the layered store.
 *  First-time setup only — entries written after the store is populated are
 *  mirrored at write time, so re-running would only create duplicates. */
export async function backfillLayers(tokenId: number): Promise<{ mirrored: number; skipped: boolean }> {
  if ((await layerEntryCount()) > 0) return { mirrored: 0, skipped: true };
  const entries = await listMemoryEntries(tokenId);
  let n = 0;
  for (const e of entries) {
    if (e.scope === 'dream') continue; // dreams never feed dreams
    const topics =
      e.scope === 'agent'
        ? ['agent', 'operator', ...(e.kind ? [e.kind] : [])]
        : e.scope === 'build'
          ? ['build', ...(e.kind ? [e.kind] : [])]
          : ['episode', 'history'];
    const metadata: Record<string, unknown> = { scope: e.scope, tokenId, sourceId: e.id, backfilled: true };
    if (e.buildId) metadata.buildId = e.buildId;
    if (e.sessionKey) metadata.sessionKey = e.sessionKey;
    await mirrorToLayer(e.content, topics, metadata);
    n++;
  }
  return { mirrored: n, skipped: false };
}

// --- task board (operator-visible work queue; console panel comes later) ----

export interface Task {
  id: string;
  title: string;
  status: 'open' | 'done';
  createdAt: number;
}

export async function taskAdd(tokenId: number, title: string): Promise<Task> {
  const m = await getMem();
  const id = randomUUID().slice(0, 8);
  const entry = await m.store({
    content: title,
    topics: ['task'],
    metadata: { scope: 'task', tokenId, taskId: id, status: 'open' },
  });
  return { id, title, status: 'open', createdAt: entry.createdAt };
}

export async function taskList(tokenId: number, includeDone = false): Promise<Task[]> {
  const m = await getMem();
  const all = await m.getAllEntries();
  return all
    .filter((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return md.scope === 'task' && Number(md.tokenId) === tokenId;
    })
    .map((e) => {
      const md = (e.metadata ?? {}) as Record<string, unknown>;
      return {
        id: String(md.taskId ?? e.id.slice(0, 8)),
        title: e.content,
        status: (md.status === 'done' ? 'done' : 'open') as 'open' | 'done',
        createdAt: e.createdAt,
      };
    })
    .filter((t) => includeDone || t.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function taskComplete(tokenId: number, taskId: string): Promise<boolean> {
  const m = await getMem();
  const all = await m.getAllEntries();
  const entry = all.find((e) => {
    const md = (e.metadata ?? {}) as Record<string, unknown>;
    return md.scope === 'task' && Number(md.tokenId) === tokenId && String(md.taskId ?? '') === taskId;
  });
  if (!entry) return false;
  await m.forget(entry.id);
  await m.store({
    content: entry.content,
    topics: ['task'],
    metadata: { scope: 'task', tokenId, taskId, status: 'done', doneAt: new Date().toISOString() },
  });
  return true;
}
