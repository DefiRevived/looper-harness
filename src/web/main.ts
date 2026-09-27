/* LOOPER AGENT console — talks to the local runtime API. */

interface ApiLooper {
  identity: { tokenId: number; contract: string; name: string; symbol: string; owner: string | null; tokenUri: string };
  bindings?: {
    bound: boolean;
    agentId: string | null;
    identityRegistry: string | null;
    tokenBoundAccount: string | null;
  };
  helixaCred?: { score: number; scoreScale: string; tier: string; riskLevel?: string; lastUpdated?: string; provider?: string } | null;
  metadata: { name?: string; image?: string; external_url?: string };
  codex: {
    name?: string;
    agent_class?: string;
    secondary_class?: string | null;
    specialization?: string;
    personality?: {
      voice?: string;
      risk_tolerance?: number;
      risk_profile?: string;
      autonomy_level?: number;
      autonomy_profile?: string;
      values?: string[];
      quirks?: string[];
    };
    selected_visual_traits?: Array<{ layer: string; trait: string }>;
    provenance?: { source_compiler?: string; hashlips_dna?: string; generated_at?: string };
    trait_codex_version?: string;
  };
  codexSource: 'arweave' | 'synthesized';
  mode: { llm: 'live' | 'mock'; model: string };
}

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const modeChip = $<HTMLSpanElement>('mode-chip');
const chainChip = $<HTMLSpanElement>('chain-chip');
const tokenForm = $<HTMLFormElement>('token-form');
const tokenInput = $<HTMLInputElement>('token-input');
const activationEl = $<HTMLDivElement>('activation');
const activationForm = $<HTMLFormElement>('activation-form');
const activationInput = $<HTMLInputElement>('activation-input');
const activationError = $<HTMLParagraphElement>('activation-error');
const agentImage = $<HTMLImageElement>('agent-image');
const agentImageFallback = $<HTMLDivElement>('agent-image-fallback');
const agentName = $<HTMLHeadingElement>('agent-name');
const agentClass = $<HTMLSpanElement>('agent-class');
const agentSpec = $<HTMLParagraphElement>('agent-spec');
const agentVoice = $<HTMLParagraphElement>('agent-voice');
const meters = $<HTMLDivElement>('meters');
const riskVal = $<HTMLElement>('risk-val');
const riskBar = $<HTMLDivElement>('risk-bar');
const autonomyVal = $<HTMLElement>('autonomy-val');
const autonomyBar = $<HTMLDivElement>('autonomy-bar');
const traitsEl = $<HTMLDivElement>('traits');
const provenanceEl = $<HTMLElement>('provenance');
const chatLog = $<HTMLDivElement>('chat-log');
const chatForm = $<HTMLFormElement>('chat-form');
const chatInput = $<HTMLInputElement>('chat-input');
const chatSend = $<HTMLButtonElement>('chat-send');
const chatReset = $<HTMLButtonElement>('chat-reset');
const chatStop = $<HTMLButtonElement>('chat-stop');
const helixaCredEl = $<HTMLDivElement>('helixa-cred');
const artifactsList = $<HTMLDivElement>('artifacts-list');
const artifactsEmpty = $<HTMLDivElement>('artifacts-empty');
const viewConsole = $<HTMLElement>('view-console');
const viewBuilds = $<HTMLElement>('view-builds');
const viewLedger = $<HTMLElement>('view-ledger');
const viewMemory = $<HTMLElement>('view-memory');
const buildsBadge = $<HTMLSpanElement>('builds-badge');
const ledgerBadge = $<HTMLSpanElement>('ledger-badge');
const vitalsRefresh = $<HTMLButtonElement>('vitals-refresh');
const vitalWallet = $<HTMLSpanElement>('vital-wallet');
const vitalMemory = $<HTMLSpanElement>('vital-memory');
const vitalTasks = $<HTMLSpanElement>('vital-tasks');
const vitalLocks = $<HTMLSpanElement>('vital-locks');
const vitalBuilds = $<HTMLSpanElement>('vital-builds');
const vitalContext = $<HTMLSpanElement>('vital-context');
const activityList = $<HTMLDivElement>('activity-list');
const activityRefresh = $<HTMLButtonElement>('activity-refresh');
const tasksRefresh = $<HTMLButtonElement>('tasks-refresh');
const tasksEmpty = $<HTMLDivElement>('tasks-empty');
const tasksOpenEl = $<HTMLDivElement>('tasks-open');
const tasksDoneEl = $<HTMLDivElement>('tasks-done');
const tasksDoneCount = $<HTMLSpanElement>('tasks-done-count');
const locksRefresh = $<HTMLButtonElement>('locks-refresh');
const locksList = $<HTMLDivElement>('locks-list');
const memoryFilter = $<HTMLInputElement>('memory-filter');
const memoryRefresh = $<HTMLButtonElement>('memory-refresh');
const dreamNow = $<HTMLButtonElement>('dream-now');
const memoryList = $<HTMLDivElement>('memory-list');
const viewArchive = $<HTMLElement>('view-archive');
const archiveRefresh = $<HTMLButtonElement>('archive-refresh');
const archiveEmpty = $<HTMLDivElement>('archive-empty');
const archiveSessions = $<HTMLDivElement>('archive-sessions');
const archiveTitle = $<HTMLHeadingElement>('archive-title');
const archiveSearch = $<HTMLInputElement>('archive-search');
const archivePlaceholder = $<HTMLDivElement>('archive-placeholder');
const archiveEvents = $<HTMLDivElement>('archive-events');
const versionModal = $<HTMLDivElement>('version-modal');
const versionModalTitle = $<HTMLSpanElement>('version-modal-title');
const versionModalFrame = $<HTMLIFrameElement>('version-modal-frame');
const versionModalClose = $<HTMLButtonElement>('version-modal-close');
const settingsOpen = $<HTMLButtonElement>('settings-open');
const activationSettings = $<HTMLButtonElement>('activation-settings');
const settingsModal = $<HTMLDivElement>('settings-modal');
const settingsClose = $<HTMLButtonElement>('settings-close');
const settingsDataDir = $<HTMLInputElement>('settings-data-dir');
const settingsDataEffective = $<HTMLParagraphElement>('settings-data-effective');
const settingsBuildsDir = $<HTMLInputElement>('settings-builds-dir');
const settingsBuildsEffective = $<HTMLParagraphElement>('settings-builds-effective');
const settingsStatus = $<HTMLParagraphElement>('settings-status');
const settingsSave = $<HTMLButtonElement>('settings-save');
const settingsReset = $<HTMLButtonElement>('settings-reset');
const settingsApiKey = $<HTMLInputElement>('settings-api-key');
const settingsKeyStatus = $<HTMLParagraphElement>('settings-key-status');
const settingsKeyClear = $<HTMLButtonElement>('settings-key-clear');
const setupEl = $<HTMLDivElement>('setup');
const setupDataDir = $<HTMLInputElement>('setup-data-dir');
const setupDataEffective = $<HTMLParagraphElement>('setup-data-effective');
const setupBuildsDir = $<HTMLInputElement>('setup-builds-dir');
const setupBuildsEffective = $<HTMLParagraphElement>('setup-builds-effective');
const setupStatus = $<HTMLParagraphElement>('setup-status');
const setupDefaults = $<HTMLButtonElement>('setup-defaults');
const setupSave = $<HTMLButtonElement>('setup-save');
const setupApiKey = $<HTMLInputElement>('setup-api-key');
const setupKeyStatus = $<HTMLParagraphElement>('setup-key-status');
const toastEl = $<HTMLDivElement>('toast');
const buildCards = new Map<string, HTMLElement>();
let unseenBuilds = 0;
type View = 'console' | 'builds' | 'ledger' | 'memory' | 'archive';
let currentView: View = 'console';

// Namespaced keys: the fork must never read or overwrite the sibling
// looperagent console's `looper.token`, even when both share an origin.
const storedToken = Number(localStorage.getItem('looper-harness.token') ?? '');
let tokenId = Number.isInteger(storedToken) && storedToken >= 1 ? storedToken : 0;
let sessionKey = `web:${tokenId}`;
let streaming = false;
let activeAbort: AbortController | null = null;

const short = (value: string, keep = 6): string => (value.length > keep * 2 + 2 ? `${value.slice(0, keep + 2)}…${value.slice(-4)}` : value);

/**
 * Optional API token — only meaningful when the server sets LOOPER_API_TOKEN.
 * Bootstrap once by opening the console as http://127.0.0.1:4520/?token=…
 * It is stored locally (key `looper-harness.apiToken`) and sent afterwards.
 */
const query = new URLSearchParams(location.search);
const urlToken = query.get('token');
if (urlToken) {
  localStorage.setItem('looper-harness.apiToken', urlToken);
  query.delete('token');
  history.replaceState({}, '', `${location.pathname}${query.toString() ? `?${query}` : ''}`);
}
const authToken = localStorage.getItem('looper-harness.apiToken') ?? '';
const authHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (authToken) headers['x-looper-token'] = authToken;
  const proof = tokenId ? localStorage.getItem(`looper-harness.proof.${tokenId}`) : null;
  if (proof) headers['x-looper-proof'] = proof;
  return headers;
};

function showAuthHint(): void {
  modeChip.textContent = 'access token required — reopen with ?token=…';
  modeChip.className = 'chip chip-error';
}

/** API error carrying the server's status + machine code (e.g. OWNERSHIP_REQUIRED). */
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) showAuthHint();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(res.status, body.error ?? `GET ${url} -> ${res.status}`, body.code);
  }
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 401) showAuthHint();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `POST ${url} -> ${res.status}`, data.code);
  return data;
}

function appendBubble(role: 'user' | 'agent' | 'system' | 'error', text: string): HTMLDivElement {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role === 'error' ? 'agent error' : role}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

/** Compact byte count for the live tool feed. */
function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

/** Compact duration for the live tool feed. */
function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Live thought stream: the model's reasoning rendered as it arrives
 * (DeepSeek `reasoning_content`). Display only — never stored, never sent
 * back. Click the header to fold/unfold; folds itself away when empty.
 */
class ThoughtStream {
  readonly el: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly body: HTMLPreElement;
  private live = true;
  private lastWasThought = false;

  constructor(insert: (el: HTMLElement) => void) {
    this.el = document.createElement('div');
    this.el.className = 'thought-stream live';
    this.head = document.createElement('div');
    this.head.className = 'thought-head';
    this.head.textContent = '🧠 thought stream — live';
    this.body = document.createElement('pre');
    this.body.className = 'thought-body';
    this.head.addEventListener('click', () => this.el.classList.toggle('closed'));
    this.el.append(this.head, this.body);
    insert(this.el);
  }

  append(text: string): void {
    if (!this.lastWasThought && this.body.textContent) this.body.textContent += '\n\n';
    this.body.textContent += text;
    this.lastWasThought = true;
    this.body.scrollTop = this.body.scrollHeight;
  }

  /** Called on non-thought events so the next reasoning phase reads as a new block. */
  breakPhase(): void {
    this.lastWasThought = false;
  }

  finish(): void {
    if (!this.live) return;
    this.live = false;
    this.el.classList.remove('live');
    if (!this.body.textContent?.trim()) {
      this.el.remove();
      return;
    }
    this.head.textContent = '🧠 thought stream — click to fold';
  }
}

/** Live tool feed: composing pulses, running notes, heartbeat ticks, done receipts. */
class ToolFeed {
  private progressEl: HTMLDivElement | null = null;
  private activeEl: HTMLDivElement | null = null;

  constructor(private readonly insert: (el: HTMLElement) => void) {}

  /** The model is still writing the call itself — nothing runnable exists yet. */
  progress(name: string, argsChars: number): void {
    if (!this.progressEl) {
      this.progressEl = document.createElement('div');
      this.progressEl.className = 'tool-note tool-progress';
      this.insert(this.progressEl);
    }
    this.progressEl.textContent = `⏳ composing ${name} — ${fmtBytes(argsChars)}`;
  }

  start(name: string, note?: string): void {
    this.clearProgress();
    const el = document.createElement('div');
    el.className = 'tool-note tool-running';
    el.dataset.base = note ? `${name} — ${note}` : name;
    el.textContent = `⚙ ${el.dataset.base}`;
    this.insert(el);
    this.activeEl = el;
  }

  tick(ms: number): void {
    if (this.activeEl) this.activeEl.textContent = `⚙ ${this.activeEl.dataset.base} · ${fmtMs(ms)}`;
  }

  done(name: string, ms: number, ok: boolean, note?: string): void {
    this.clearProgress();
    const el = this.activeEl ?? document.createElement('div');
    if (!this.activeEl) {
      el.className = 'tool-note';
      this.insert(el);
    }
    this.activeEl = null;
    el.classList.remove('tool-running');
    el.classList.toggle('tool-err', !ok);
    el.textContent = `${ok ? '✓' : '✕'} ${note ? `${name} — ${note}` : name} · ${fmtMs(ms)}`;
  }

  finish(): void {
    this.clearProgress();
    if (this.activeEl) {
      this.activeEl.classList.remove('tool-running');
      this.activeEl = null;
    }
  }

  private clearProgress(): void {
    this.progressEl?.remove();
    this.progressEl = null;
  }
}

interface ArtifactInfo {
  id: string;
  title: string;
  kind: 'html' | 'svg';
  url: string;
  bytes: number;
  savedAt?: string;
  /** File count for multi-file project builds. */
  files?: number;
}

/** Artifact URLs must carry the access token when one is configured (iframes can't send headers). */
const authQuery = (): string => (authToken ? `?token=${encodeURIComponent(authToken)}` : '');

/* ---------- operator panels: toast, vitals, activity, ledger, memory ------ */

let toastTimer: number | undefined;

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  toastEl.textContent = message;
  toastEl.className = `toast${kind === 'error' ? ' error' : ''}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.add('hidden'), kind === 'error' ? 4200 : 2600);
}

const fmtDate = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ');

const buildTitle = (buildId: string): string =>
  buildId
    .replace(/^[0-9]+-/, '')
    .replace(/\.(html|svg)$/, '')
    .replace(/-/g, ' ');

function setLedgerBadge(openTasks: number): void {
  if (openTasks > 0) {
    ledgerBadge.textContent = String(openTasks);
    ledgerBadge.classList.remove('hidden');
  } else {
    ledgerBadge.classList.add('hidden');
  }
}

interface VitalsPayload {
  owner: string | null;
  wallet: { eth: string; usdc: string; at: string } | null;
  counts: {
    memory: number;
    episodes: number;
    tasksOpen: number;
    tasksDone: number;
    locks: number;
    builds: number;
    messages: number;
    messagesMax: number;
  };
  at: string;
}

async function loadVitals(): Promise<void> {
  try {
    const v = await getJson<VitalsPayload>(`/api/vitals?tokenId=${tokenId}&sessionKey=${encodeURIComponent(sessionKey)}`);
    if (v.wallet) {
      const eth = Number(v.wallet.eth);
      vitalWallet.textContent = `${Number.isFinite(eth) ? eth.toFixed(6) : v.wallet.eth} ETH · ${v.wallet.usdc} USDC`;
      vitalWallet.title = `owner ${v.owner ?? '?'} · read ${new Date(v.wallet.at).toLocaleTimeString()}`;
    } else {
      vitalWallet.textContent = v.owner ? 'unavailable' : 'no owner on file';
      vitalWallet.title = v.owner ?? '';
    }
    vitalMemory.textContent = `${v.counts.memory} ${v.counts.memory === 1 ? 'entry' : 'entries'}${v.counts.episodes ? ` · ${v.counts.episodes} episode${v.counts.episodes === 1 ? '' : 's'}` : ''}`;
    vitalTasks.textContent = `${v.counts.tasksOpen} open / ${v.counts.tasksDone} done`;
    vitalLocks.textContent = String(v.counts.locks);
    vitalBuilds.textContent = String(v.counts.builds);
    vitalContext.textContent = `${v.counts.messages}/${v.counts.messagesMax}`;
    setLedgerBadge(v.counts.tasksOpen);
  } catch {
    vitalWallet.textContent = vitalMemory.textContent = vitalTasks.textContent = '—';
  }
}

interface ActivityEvent {
  at: string;
  tool: string;
}

function renderActivity(events: ActivityEvent[]): void {
  activityList.innerHTML = '';
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'ledger-empty';
    empty.textContent = 'no tool activity yet.';
    activityList.appendChild(empty);
    return;
  }
  for (const e of events) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    const time = document.createElement('span');
    time.className = 't';
    time.textContent = new Date(e.at).toLocaleTimeString([], { hour12: false });
    const name = document.createElement('span');
    name.className = 'n';
    name.textContent = `⚙ ${e.tool}`;
    row.append(time, name);
    activityList.appendChild(row);
  }
}

async function loadActivity(): Promise<void> {
  try {
    const { events } = await getJson<{ events: ActivityEvent[] }>(`/api/activity?sessionKey=${encodeURIComponent(sessionKey)}`);
    renderActivity(events);
  } catch {
    // best-effort
  }
}

/** Live echo while streaming; the reload after the turn is authoritative. */
function bumpActivity(tool: string): void {
  activityList.querySelector('.ledger-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'activity-row';
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = new Date().toLocaleTimeString([], { hour12: false });
  const name = document.createElement('span');
  name.className = 'n';
  name.textContent = `⚙ ${tool}`;
  row.append(time, name);
  activityList.prepend(row);
  while (activityList.childElementCount > 60) activityList.lastElementChild?.remove();
}

interface Task {
  id: string;
  title: string;
  status: 'open' | 'done';
  createdAt: number;
}

interface LockView {
  id: string;
  buildId: string;
  lockType: 'freeze' | 'snippet';
  snippet: string;
  note: string;
  createdAt: number;
}

let locksCache: LockView[] = [];

async function loadLedger(): Promise<void> {
  try {
    const { tasks } = await getJson<{ tasks: Task[] }>(`/api/tasks?tokenId=${tokenId}&includeDone=1`);
    renderTasks(tasks);
    setLedgerBadge(tasks.filter((t) => t.status === 'open').length);
  } catch {
    // best-effort
  }
  try {
    const { locks } = await getJson<{ locks: LockView[] }>(`/api/locks?tokenId=${tokenId}`);
    locksCache = locks;
    renderLocks(locks);
    applyLockBadges();
  } catch {
    // best-effort
  }
}

function renderTasks(tasks: Task[]): void {
  tasksOpenEl.innerHTML = '';
  tasksDoneEl.innerHTML = '';
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status === 'done').reverse();
  tasksEmpty.classList.toggle('hidden', open.length > 0);

  for (const t of open) {
    const row = document.createElement('div');
    row.className = 'task-row';
    const check = document.createElement('button');
    check.className = 'task-check';
    check.type = 'button';
    check.title = 'mark done';
    check.textContent = '○';
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        const r = await postJson<{ ok: boolean }>('/api/tasks/complete', { tokenId, taskId: t.id });
        if (r.ok) {
          toast(`task [${t.id}] closed`);
          void loadLedger();
          void loadVitals();
        } else {
          toast(`task [${t.id}] was not found`, 'error');
        }
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    });
    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = t.title;
    const meta = document.createElement('span');
    meta.className = 'task-meta';
    meta.textContent = `${t.id} · ${fmtDate(t.createdAt).slice(0, 10)}`;
    row.append(check, title, meta);
    tasksOpenEl.appendChild(row);
  }

  tasksDoneCount.textContent = String(done.length);
  for (const t of done) {
    const row = document.createElement('div');
    row.className = 'task-row done';
    const mark = document.createElement('span');
    mark.className = 'task-check static';
    mark.textContent = '✓';
    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = t.title;
    const meta = document.createElement('span');
    meta.className = 'task-meta';
    meta.textContent = `${t.id} · ${fmtDate(t.createdAt).slice(0, 10)}`;
    row.append(mark, title, meta);
    tasksDoneEl.appendChild(row);
  }
}

function renderLocks(locks: LockView[]): void {
  locksList.innerHTML = '';
  if (!locks.length) {
    const empty = document.createElement('div');
    empty.className = 'ledger-empty';
    empty.textContent = 'no active locks — every build is fully editable.';
    locksList.appendChild(empty);
    return;
  }
  const byBuild = new Map<string, LockView[]>();
  for (const l of locks) {
    const list = byBuild.get(l.buildId) ?? [];
    list.push(l);
    byBuild.set(l.buildId, list);
  }
  for (const [buildId, list] of byBuild) {
    const group = document.createElement('div');
    group.className = 'lock-build';
    const head = document.createElement('div');
    head.className = 'lock-build-head';
    const name = document.createElement('span');
    name.className = 'lock-build-name';
    name.textContent = buildTitle(buildId);
    const id = document.createElement('span');
    id.className = 'chip chip-dim';
    id.textContent = buildId;
    head.append(name, id);
    group.appendChild(head);

    for (const l of list) {
      const row = document.createElement('div');
      row.className = 'lock-row';
      const type = document.createElement('span');
      type.className = `chip ${l.lockType === 'freeze' ? 'chip-error' : 'chip-mock'}`;
      type.textContent = l.lockType;
      const body = document.createElement('div');
      body.className = 'lock-body';
      const note = document.createElement('div');
      note.className = 'lock-note';
      note.textContent = l.note;
      body.appendChild(note);
      if (l.snippet) {
        const snip = document.createElement('code');
        snip.className = 'lock-snippet';
        snip.textContent = l.snippet.length > 160 ? `${l.snippet.slice(0, 160)}…` : l.snippet;
        body.appendChild(snip);
      }
      const since = document.createElement('div');
      since.className = 'lock-since';
      since.textContent = `since ${fmtDate(l.createdAt)}`;
      body.appendChild(since);
      const unlock = document.createElement('button');
      unlock.className = 'btn btn-ghost';
      unlock.type = 'button';
      unlock.textContent = 'unlock';
      unlock.addEventListener('click', async () => {
        if (!window.confirm(`remove this ${l.lockType} lock on "${buildTitle(buildId)}"?`)) return;
        unlock.disabled = true;
        try {
          await postJson('/api/locks/remove', { id: l.id });
          toast('lock removed');
          void loadLedger();
          void loadVitals();
        } catch (err) {
          toast((err as Error).message, 'error');
        }
      });
      row.append(type, body, unlock);
      group.appendChild(row);
    }
    locksList.appendChild(group);
  }
}

function applyLockBadges(): void {
  for (const [buildId, card] of buildCards) {
    const locks = locksCache.filter((l) => l.buildId === buildId);
    let badge = card.querySelector<HTMLSpanElement>('.lock-badge');
    if (!locks.length) {
      badge?.remove();
      continue;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'chip chip-error lock-badge';
      const head = card.querySelector('.artifact-head');
      const spacer = card.querySelector('.artifact-spacer');
      if (head && spacer) head.insertBefore(badge, spacer);
      else head?.appendChild(badge);
    }
    badge.textContent = `🔒 ${locks.length}`;
    badge.title = locks.map((l) => `${l.lockType}: ${l.note}`).join('\n');
  }
}

interface MemoryEntry {
  id: string;
  content: string;
  createdAt: number;
  scope: 'agent' | 'build' | 'episode' | 'dream';
  buildId?: string;
  sessionKey?: string;
  sessionLabel?: string;
  kind?: string;
}

let memoryCache: MemoryEntry[] = [];

async function loadMemoryView(): Promise<void> {
  try {
    const { entries } = await getJson<{ entries: MemoryEntry[] }>(`/api/memory?tokenId=${tokenId}`);
    memoryCache = entries;
    renderMemory();
  } catch {
    // best-effort
  }
}

function memoryEntryEl(entry: MemoryEntry): HTMLElement {
  const el = document.createElement('div');
  el.className = 'memory-entry';
  const meta = document.createElement('div');
  meta.className = 'memory-meta';
  const date = document.createElement('span');
  date.className = 'memory-date';
  date.textContent = fmtDate(entry.createdAt);
  meta.appendChild(date);
  const scope = document.createElement('span');
  scope.className = 'chip chip-dim';
  scope.textContent =
    entry.scope === 'agent'
      ? 'operator-wide'
      : entry.scope === 'dream'
        ? 'dream'
        : entry.scope === 'build'
          ? `build: ${entry.buildId ? buildTitle(entry.buildId) : '?'}`
          : `history — ${entry.sessionLabel ?? 'session'}`;
  meta.appendChild(scope);
  if (entry.kind) {
    const kind = document.createElement('span');
    kind.className = 'chip chip-dim';
    kind.textContent = entry.kind;
    meta.appendChild(kind);
  }
  const forget = document.createElement('button');
  forget.className = 'btn btn-ghost memory-forget';
  forget.type = 'button';
  forget.title = 'forget this entry';
  forget.textContent = '✕';
  forget.addEventListener('click', async () => {
    if (!window.confirm('forget this memory? It will not come back.')) return;
    try {
      const r = await postJson<{ ok: boolean }>('/api/memory/forget', { id: entry.id });
      if (r.ok) {
        memoryCache = memoryCache.filter((m) => m.id !== entry.id);
        renderMemory();
        void loadVitals();
        toast('forgotten');
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  });
  meta.appendChild(forget);
  const content = document.createElement('div');
  content.className = 'memory-content';
  content.textContent = entry.content;
  el.append(meta, content);
  return el;
}

function renderMemory(): void {
  memoryList.innerHTML = '';
  const needle = memoryFilter.value.trim().toLowerCase();
  const filtered = needle ? memoryCache.filter((e) => e.content.toLowerCase().includes(needle)) : memoryCache;
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'ledger-empty';
    empty.textContent = memoryCache.length
      ? 'nothing matches the filter.'
      : 'nothing remembered yet — say “remember …” in chat, or let long conversations distill themselves.';
    memoryList.appendChild(empty);
    return;
  }
  const sections: Array<{ title: string; pick: (e: MemoryEntry) => boolean }> = [
    { title: 'operator-wide', pick: (e) => e.scope === 'agent' },
    { title: 'episodes (distilled history)', pick: (e) => e.scope === 'episode' },
    { title: 'dreams (nightly synthesis)', pick: (e) => e.scope === 'dream' },
    { title: 'per-build', pick: (e) => e.scope === 'build' },
  ];
  for (const section of sections) {
    const entries = filtered.filter(section.pick);
    if (!entries.length) continue;
    const head = document.createElement('div');
    head.className = 'memory-section';
    head.textContent = `${section.title} — ${entries.length}`;
    memoryList.appendChild(head);
    for (const entry of entries) memoryList.appendChild(memoryEntryEl(entry));
  }
}

/* ---------- archived threads (verbatim transcripts) ------------------------ */

interface ArchiveSession {
  session: string;
  file: string;
  events: number;
  messages: number;
  resets: number;
  bytes: number;
  updatedAt: string;
}

interface ArchiveEvent {
  marker?: string;
  sessionKey?: string;
  role?: string;
  at?: string;
  archivedAt?: string;
  reason?: string;
  content?: string;
  count?: number;
}

let archiveCache: ArchiveEvent[] = [];
let archiveSelected: string | null = null;

const sessionLabel = (session: string): string => {
  if (session.includes(':build:')) return 'build thread';
  if (session.startsWith('web:')) return 'console';
  if (session.startsWith('tg:')) return 'telegram';
  if (session.startsWith('dc:')) return 'discord';
  return 'session';
};

async function loadArchive(): Promise<void> {
  try {
    const { sessions } = await getJson<{ sessions: ArchiveSession[] }>('/api/transcripts');
    renderArchiveSessions(sessions);
  } catch {
    // best-effort
  }
  if (archiveSelected) void openArchiveSession(archiveSelected);
}

function renderArchiveSessions(sessions: ArchiveSession[]): void {
  archiveSessions.innerHTML = '';
  archiveEmpty.classList.toggle('hidden', sessions.length > 0);
  if (!sessions.length) {
    archiveEvents.innerHTML = '';
    archivePlaceholder.classList.remove('hidden');
    archiveTitle.textContent = 'TRANSCRIPT';
    archiveCache = [];
    archiveSelected = null;
    return;
  }
  for (const s of sessions) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `archive-session${s.session === archiveSelected ? ' selected' : ''}`;
    row.dataset.session = s.session;
    const head = document.createElement('div');
    head.className = 'archive-session-head';
    const name = document.createElement('span');
    name.className = 'archive-session-name';
    name.textContent = s.session;
    const kind = document.createElement('span');
    kind.className = 'chip chip-dim';
    kind.textContent = sessionLabel(s.session);
    head.append(name, kind);
    const meta = document.createElement('div');
    meta.className = 'archive-session-meta';
    meta.textContent = `${s.messages} message${s.messages === 1 ? '' : 's'}${s.resets ? ` · ${s.resets} reset${s.resets === 1 ? '' : 's'}` : ''} · ${(s.bytes / 1024).toFixed(1)} kB · last ${fmtDate(Date.parse(s.updatedAt))}`;
    row.append(head, meta);
    row.addEventListener('click', () => void openArchiveSession(s.session));
    archiveSessions.appendChild(row);
  }
}

async function openArchiveSession(session: string): Promise<void> {
  archiveSelected = session;
  for (const row of archiveSessions.querySelectorAll<HTMLButtonElement>('.archive-session')) {
    row.classList.toggle('selected', row.dataset.session === session);
  }
  try {
    const data = await getJson<{ session: string; events: ArchiveEvent[]; truncated: boolean }>(
      `/api/transcripts/${encodeURIComponent(session)}`,
    );
    archiveCache = data.events;
    archiveTitle.textContent = `TRANSCRIPT — ${data.session}`;
    archivePlaceholder.classList.add('hidden');
    renderArchiveEvents(data.truncated);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

function renderArchiveEvents(truncated = false): void {
  archiveEvents.innerHTML = '';
  const needle = archiveSearch.value.trim().toLowerCase();
  const filtered = needle ? archiveCache.filter((e) => e.content?.toLowerCase().includes(needle)) : archiveCache;
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'archive-note';
    note.textContent = 'showing the most recent 2000 archived lines.';
    archiveEvents.appendChild(note);
  }
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'ledger-empty';
    empty.textContent = archiveCache.length ? 'nothing matches the filter.' : 'this transcript is empty.';
    archiveEvents.appendChild(empty);
    return;
  }
  for (const e of filtered) {
    if (e.marker === 'reset') {
      const divider = document.createElement('div');
      divider.className = 'archive-reset';
      divider.textContent = `── thread reset — ${e.count ?? '?'} message${e.count === 1 ? '' : 's'} archived${e.archivedAt ? ` · ${fmtDate(Date.parse(e.archivedAt))}` : ''} ──`;
      archiveEvents.appendChild(divider);
      continue;
    }
    const row = document.createElement('div');
    row.className = `archive-event ${e.role === 'user' ? 'user' : 'agent'}`;
    const meta = document.createElement('div');
    meta.className = 'archive-event-meta';
    meta.textContent = `${e.at ? fmtDate(Date.parse(e.at)) : '?'} · ${e.role ?? '?'} · kept via ${e.reason ?? 'archive'}`;
    const content = document.createElement('div');
    content.className = 'archive-event-content';
    content.textContent = e.content ?? '';
    row.append(meta, content);
    archiveEvents.appendChild(row);
  }
}

function closeVersionModal(): void {
  versionModal.classList.add('hidden');
  versionModalFrame.srcdoc = '';
}

async function openVersionModal(buildId: string, index: number, date: string): Promise<void> {
  versionModalTitle.textContent = `${buildTitle(buildId)} — v${index} (archived ${date})`;
  versionModal.classList.remove('hidden');
  try {
    const res = await fetch(`/api/version-file?sessionKey=${encodeURIComponent(sessionKey)}&buildId=${encodeURIComponent(buildId)}&index=${index}`, {
      headers: authHeaders(),
    });
    versionModalFrame.srcdoc = await res.text();
  } catch {
    versionModalFrame.srcdoc = '<p style="font-family:monospace;color:#666">version unavailable</p>';
  }
}

/* ---------- settings + first-run setup ---------- */

interface DirInfo {
  effective: string;
  configured: string | null;
  envOverride: string | null;
  defaultPath: string;
  source: 'env' | 'settings' | 'default';
}

interface SetupState {
  dataDir: DirInfo;
  buildsDir: DirInfo;
  llmKey: LLMKeyInfo;
  setupComplete: boolean;
}

interface LLMKeyInfo {
  configured: boolean;
  masked: string | null;
  source: 'env' | 'settings' | null;
}

function renderLlmKey(info: LLMKeyInfo): void {
  const text = info.configured
    ? `key saved (${info.masked}) — the live brain is on${info.source === 'env' ? ' · set by DEEPSEEK_API_KEY in .env (overrides the stored key)' : ' · stored locally'}`
    : 'no key yet — replies come from the labeled mock brain (canned text, not your agent)';
  settingsKeyStatus.textContent = text;
  setupKeyStatus.textContent = text;
  const placeholder = info.configured ? 'already set — type to replace' : 'sk-…';
  settingsApiKey.placeholder = placeholder;
  setupApiKey.placeholder = placeholder;
}

function renderDir(input: HTMLInputElement, effectiveEl: HTMLElement, d: DirInfo, envVar: string): void {
  input.value = d.configured ?? '';
  input.placeholder = d.defaultPath;
  const note =
    d.source === 'env'
      ? `set by ${envVar} (.env) — it overrides this setting`
      : d.source === 'settings'
        ? 'from this setting'
        : 'default';
  effectiveEl.textContent = `effective now: ${d.effective} — ${note}`;
}

function renderSetup(state: SetupState): void {
  renderDir(settingsDataDir, settingsDataEffective, state.dataDir, 'LOOPER_DATA_DIR');
  renderDir(settingsBuildsDir, settingsBuildsEffective, state.buildsDir, 'LOOPER_BUILDS_DIR');
  renderDir(setupDataDir, setupDataEffective, state.dataDir, 'LOOPER_DATA_DIR');
  renderDir(setupBuildsDir, setupBuildsEffective, state.buildsDir, 'LOOPER_BUILDS_DIR');
  renderLlmKey(state.llmKey);
}

async function openSettings(): Promise<void> {
  settingsModal.classList.remove('hidden');
  settingsStatus.textContent = '';
  settingsDataEffective.textContent = 'loading…';
  settingsBuildsEffective.textContent = 'loading…';
  settingsApiKey.value = '';
  try {
    renderSetup(await getJson<SetupState>('/api/settings'));
  } catch (err) {
    settingsStatus.textContent = `couldn't load settings — ${(err as Error).message}`;
  }
}

function closeSettings(): void {
  settingsModal.classList.add('hidden');
}

async function saveSettings(): Promise<void> {
  settingsStatus.textContent = '';
  settingsSave.disabled = true;
  try {
    const newKey = settingsApiKey.value.trim();
    const state = await postJson<SetupState & { ok: boolean }>('/api/settings', {
      dataDir: settingsDataDir.value.trim() || null,
      buildsDir: settingsBuildsDir.value.trim() || null,
      ...(newKey ? { deepseekApiKey: newKey } : {}),
    });
    settingsApiKey.value = '';
    renderSetup(state);
    toast(state.llmKey.configured ? 'settings saved — the brain is live' : 'settings saved');
  } catch (err) {
    settingsStatus.textContent = (err as Error).message;
  } finally {
    settingsSave.disabled = false;
  }
}

async function clearApiKey(): Promise<void> {
  settingsStatus.textContent = '';
  settingsKeyClear.disabled = true;
  try {
    const state = await postJson<SetupState & { ok: boolean }>('/api/settings', { deepseekApiKey: null });
    settingsApiKey.value = '';
    renderSetup(state);
    toast('API key removed — back to the mock brain');
  } catch (err) {
    settingsStatus.textContent = (err as Error).message;
  } finally {
    settingsKeyClear.disabled = false;
  }
}

async function resetSettings(): Promise<void> {
  settingsStatus.textContent = '';
  settingsReset.disabled = true;
  try {
    const state = await postJson<SetupState & { ok: boolean }>('/api/settings', { dataDir: null, buildsDir: null });
    renderSetup(state);
    toast('storage directories back to default');
  } catch (err) {
    settingsStatus.textContent = (err as Error).message;
  } finally {
    settingsReset.disabled = false;
  }
}

async function saveSetup(useDefaults: boolean): Promise<void> {
  setupStatus.textContent = '';
  setupSave.disabled = true;
  setupDefaults.disabled = true;
  try {
    const newKey = setupApiKey.value.trim();
    const state = await postJson<SetupState & { ok: boolean }>(
      '/api/settings',
      useDefaults
        ? { dataDir: null, buildsDir: null, setupComplete: true, ...(newKey ? { deepseekApiKey: newKey } : {}) }
        : {
            dataDir: setupDataDir.value.trim() || null,
            buildsDir: setupBuildsDir.value.trim() || null,
            setupComplete: true,
            ...(newKey ? { deepseekApiKey: newKey } : {}),
          },
    );
    setupApiKey.value = '';
    renderSetup(state);
    setupEl.classList.add('hidden');
    toast(
      state.llmKey.configured
        ? 'setup complete — brain is live on DeepSeek'
        : 'setup complete — running the mock brain (add a key anytime via ⚙)',
    );
    startConsole();
  } catch (err) {
    setupStatus.textContent = (err as Error).message;
  } finally {
    setupSave.disabled = false;
    setupDefaults.disabled = false;
  }
}

function switchView(view: View): void {
  currentView = view;
  viewConsole.classList.toggle('hidden', view !== 'console');
  viewBuilds.classList.toggle('hidden', view !== 'builds');
  viewLedger.classList.toggle('hidden', view !== 'ledger');
  viewMemory.classList.toggle('hidden', view !== 'memory');
  viewArchive.classList.toggle('hidden', view !== 'archive');
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.view-tab')) {
    tab.classList.toggle('active', tab.dataset.view === view);
  }
  if (view === 'builds') {
    unseenBuilds = 0;
    buildsBadge.classList.add('hidden');
  }
  if (view === 'ledger') void loadLedger();
  if (view === 'memory') void loadMemoryView();
  if (view === 'archive') void loadArchive();
}

function bumpBuildBadge(): void {
  if (currentView === 'builds') return;
  unseenBuilds += 1;
  buildsBadge.textContent = String(unseenBuilds);
  buildsBadge.classList.remove('hidden');
}

function addBuildChip(artifact: ArtifactInfo): void {
  const chip = document.createElement('button');
  chip.className = 'build-chip';
  chip.type = 'button';
  chip.textContent = `▣ build ready — ${artifact.title} (view)`;
  chip.addEventListener('click', () => {
    switchView('builds');
    const card = buildCards.get(artifact.id);
    if (card) {
      card.classList.remove('collapsed');
      const toggle = card.querySelector<HTMLButtonElement>('.artifact-toggle');
      if (toggle) toggle.textContent = '▾';
      card.scrollIntoView({ block: 'start' });
    }
  });
  chatLog.appendChild(chip);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendBuildLine(container: HTMLDivElement, role: string, text: string): HTMLDivElement {
  const line = document.createElement('div');
  line.className = `build-line ${role}`;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  return line;
}

/**
 * Fetch an artifact's source into a sandboxed srcdoc frame (isolated +
 * reload-safe — navigating a fully-sandboxed iframe fails in Chromium). A
 * <base> tag pinned to the served build folder makes RELATIVE references
 * (css/style.css, js/app.js) resolve for multi-file projects.
 */
async function loadPreview(frame: HTMLIFrameElement, artifact: ArtifactInfo): Promise<void> {
  try {
    const res = await fetch(`${artifact.url}${authQuery()}`, { headers: authHeaders() });
    let html = await res.text();
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${artifact.url}">`);
    frame.srcdoc = html;
  } catch {
    // Fallback: navigate directly (relative refs resolve — the URL ends in "/").
    frame.src = `${artifact.url}${authQuery()}`;
  }
}

function addArtifact(artifact: ArtifactInfo, opts: { expand?: boolean } = {}): void {
  const existing = buildCards.get(artifact.id);
  if (existing) {
    // Same build, new content (update_build) — refresh the preview in place.
    const frame = existing.querySelector<HTMLIFrameElement>('.artifact-frame');
    if (frame) void loadPreview(frame, artifact);
    existing.classList.add('updated');
    setTimeout(() => existing.classList.remove('updated'), 900);
    return;
  }

  artifactsEmpty.classList.add('hidden');

  const card = document.createElement('article');
  card.className = `artifact-card${opts.expand ? '' : ' collapsed'}`;
  buildCards.set(artifact.id, card);

  const head = document.createElement('div');
  head.className = 'artifact-head';

  const toggle = document.createElement('button');
  toggle.className = 'btn btn-ghost artifact-toggle';
  toggle.type = 'button';
  toggle.textContent = opts.expand ? '▾' : '▸';
  toggle.title = 'expand / collapse preview';
  toggle.addEventListener('click', () => {
    const collapsed = card.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▸' : '▾';
    if (!collapsed) void ensureHistory();
  });

  const title = document.createElement('span');
  title.className = 'artifact-title';
  title.textContent = artifact.title;
  const kind = document.createElement('span');
  kind.className = 'chip chip-dim';
  kind.textContent = artifact.files && artifact.files > 1 ? `${artifact.kind} · ${artifact.files} files` : artifact.kind;
  const spacer = document.createElement('span');
  spacer.className = 'artifact-spacer';
  const history = document.createElement('button');
  history.className = 'btn btn-ghost';
  history.type = 'button';
  history.textContent = 'history';
  history.title = 'archived versions — view or revert';
  const open = document.createElement('a');
  open.className = 'btn btn-ghost';
  open.href = `${artifact.url}${authQuery()}`;
  open.target = '_blank';
  open.rel = 'noreferrer';
  open.textContent = 'open ↗';
  const copy = document.createElement('button');
  copy.className = 'btn btn-ghost';
  copy.type = 'button';
  copy.textContent = 'copy source';
  copy.addEventListener('click', async () => {
    try {
      const res = await fetch(`${artifact.url}${authQuery()}`, { headers: authHeaders() });
      await navigator.clipboard.writeText(await res.text());
      copy.textContent = 'copied ✓';
      setTimeout(() => {
        copy.textContent = 'copy source';
      }, 1200);
    } catch {
      copy.textContent = 'copy failed';
    }
  });
  const del = document.createElement('button');
  del.className = 'btn btn-ghost';
  del.type = 'button';
  del.textContent = '✕';
  del.title = 'delete this build';
  del.addEventListener('click', async () => {
    if (!window.confirm(`delete build "${artifact.title}"?`)) return;
    try {
      await fetch(`${artifact.url}${authQuery()}`, { method: 'DELETE', headers: authHeaders() });
      buildCards.delete(artifact.id);
      card.remove();
      if (!artifactsList.childElementCount) artifactsEmpty.classList.remove('hidden');
    } catch {
      // ignore — the build stays listed if the delete failed
    }
  });
  head.append(toggle, title, kind, spacer, history, open, copy, del);

  const versions = document.createElement('div');
  versions.className = 'build-versions hidden';
  let versionsLoaded = false;

  const refreshVersions = async (): Promise<void> => {
    try {
      const { versions: list } = await getJson<{ versions: Array<{ ts: number; bytes: number }> }>(
        `/api/versions?sessionKey=${encodeURIComponent(sessionKey)}&buildId=${encodeURIComponent(artifact.id)}`,
      );
      versions.innerHTML = '';
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'ledger-empty';
        empty.textContent = 'no archived versions yet — one is captured automatically on the first revision.';
        versions.appendChild(empty);
        return;
      }
      list.forEach((v, i) => {
        const index = i + 1;
        const row = document.createElement('div');
        row.className = 'version-row';
        const label = document.createElement('span');
        label.className = 'version-label';
        label.textContent = `v${index} · ${fmtDate(v.ts)} · ${(v.bytes / 1024).toFixed(1)} kB${index === 1 ? ' (most recent prior state)' : ''}`;
        const rowSpacer = document.createElement('span');
        rowSpacer.className = 'artifact-spacer';
        const view = document.createElement('button');
        view.className = 'btn btn-ghost';
        view.type = 'button';
        view.textContent = 'view';
        view.addEventListener('click', () => void openVersionModal(artifact.id, index, fmtDate(v.ts)));
        const revert = document.createElement('button');
        revert.className = 'btn btn-ghost';
        revert.type = 'button';
        revert.textContent = 'revert';
        revert.addEventListener('click', async () => {
          if (!window.confirm(`revert "${artifact.title}" to the state from ${fmtDate(v.ts)}?\nThe current state is archived first, so this is undoable.`)) return;
          try {
            const r = await postJson<{ ok: boolean; message: string; artifact?: ArtifactInfo }>('/api/versions/revert', {
              tokenId,
              sessionKey,
              buildId: artifact.id,
              version: index,
            });
            if (r.ok) {
              toast('reverted — preview refreshed');
              const frame2 = card.querySelector<HTMLIFrameElement>('.artifact-frame');
              if (frame2) void loadPreview(frame2, r.artifact ?? artifact);
              card.classList.add('updated');
              setTimeout(() => card.classList.remove('updated'), 900);
              void refreshVersions();
            } else {
              toast(r.message, 'error');
            }
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        });
        row.append(label, rowSpacer, view, revert);
        versions.appendChild(row);
      });
    } catch {
      // best-effort
    }
  };

  history.addEventListener('click', () => {
    const hidden = versions.classList.toggle('hidden');
    if (!hidden && !versionsLoaded) {
      versionsLoaded = true;
      void refreshVersions();
    }
  });

  const wrap = document.createElement('div');
  wrap.className = 'artifact-frame-wrap';
  const frame = document.createElement('iframe');
  frame.className = 'artifact-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', artifact.title);
  frame.dataset.build = artifact.title;
  void loadPreview(frame, artifact);
  wrap.appendChild(frame);

  // Per-build thread: its own session key and its own history — nothing from the console chat.
  const chat = document.createElement('div');
  chat.className = 'build-chat';
  const chatLogEl = document.createElement('div');
  chatLogEl.className = 'build-chat-log';
  const chatForm = document.createElement('form');
  chatForm.className = 'build-chat-form';
  const chatInput = document.createElement('input');
  chatInput.placeholder = 'continue on this build…';
  chatInput.autocomplete = 'off';
  const chatSend = document.createElement('button');
  chatSend.className = 'btn';
  chatSend.type = 'submit';
  chatSend.textContent = 'send';
  const chatStop = document.createElement('button');
  chatStop.className = 'btn';
  chatStop.type = 'button';
  chatStop.textContent = '■';
  chatStop.title = 'stop generating';
  chatStop.disabled = true;
  chatStop.addEventListener('click', () => buildAbort?.abort());
  chatForm.append(chatInput, chatStop, chatSend);
  chat.append(chatLogEl, chatForm);

  const buildSession = `${sessionKey}:build:${artifact.id}`;
  let historyLoaded = false;
  let buildStreaming = false;
  let buildAbort: AbortController | null = null;

  const ensureHistory = async (): Promise<void> => {
    if (historyLoaded) return;
    historyLoaded = true;
    try {
      const { messages } = await getJson<{ messages: Array<{ role: string; content: string }> }>(
        `/api/chat/history?sessionKey=${encodeURIComponent(buildSession)}`,
      );
      for (const m of messages) appendBuildLine(chatLogEl, m.role === 'user' ? 'user' : 'agent', m.content);
    } catch {
      // history is best-effort
    }
    if (!chatLogEl.childElementCount) {
      appendBuildLine(chatLogEl, 'system', 'thread starts at this build — no other chat history.');
    }
  };

  const sendBuildMessage = async (text: string): Promise<void> => {
    buildStreaming = true;
    chatSend.disabled = true;
    chatStop.disabled = false;
    const ctrl = new AbortController();
    buildAbort = ctrl;
    appendBuildLine(chatLogEl, 'user', text);
    const agentLine = appendBuildLine(chatLogEl, 'agent', '');
    agentLine.classList.add('streaming');
    let content = '';
    let thoughts: ThoughtStream | null = null;
    const tools = new ToolFeed((el) => chatLogEl.appendChild(el));
    const finishStreamView = (): void => {
      thoughts?.finish();
      tools.finish();
    };
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ tokenId, sessionKey: buildSession, message: text }),
        signal: ctrl.signal,
      });
      if (res.status === 401) showAuthHint();
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const frameData = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const line = frameData.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as {
            type: string;
            text?: string;
            message?: string;
            name?: string;
            id?: string;
            note?: string;
            ok?: boolean;
            ms?: number;
            argsChars?: number;
            artifact?: ArtifactInfo;
          };
          if (event.type === 'delta' && event.text) {
            content += event.text;
            agentLine.textContent = content;
            thoughts?.breakPhase();
            chatLogEl.scrollTop = chatLogEl.scrollHeight;
          } else if (event.type === 'thought' && event.text) {
            thoughts ??= new ThoughtStream((el) => chatLogEl.appendChild(el));
            thoughts.append(event.text);
            chatLogEl.scrollTop = chatLogEl.scrollHeight;
          } else if (event.type === 'tool_progress' && event.name) {
            tools.progress(event.name, event.argsChars ?? 0);
          } else if (event.type === 'tool_tick') {
            tools.tick(event.ms ?? 0);
          } else if (event.type === 'error') {
            content += `\n[error] ${event.message ?? 'unknown'}`;
            agentLine.textContent = content;
          } else if (event.type === 'tool' && event.name) {
            tools.start(event.name, event.note);
            bumpActivity(event.name);
          } else if (event.type === 'tool_done' && event.name) {
            tools.done(event.name, event.ms ?? 0, event.ok !== false, event.note);
          } else if (event.type === 'artifact' && event.artifact) {
            if (event.artifact.id === artifact.id) {
              // update_build — refresh this card's preview in place.
              await loadPreview(frame, event.artifact);
              card.classList.add('updated');
              setTimeout(() => card.classList.remove('updated'), 900);
            } else {
              addArtifact(event.artifact);
              appendBuildLine(chatLogEl, 'tool', `▣ new build — ${event.artifact.title}`);
            }
          } else if (event.type === 'artifact-removed' && event.id) {
            const gone = buildCards.get(event.id);
            if (gone) {
              buildCards.delete(event.id);
              gone.remove();
              if (!artifactsList.childElementCount) artifactsEmpty.classList.remove('hidden');
            }
            appendBuildLine(chatLogEl, 'tool', '✕ build deleted');
          }
        }
      }
      if (!content) agentLine.textContent = '(no output)';
    } catch (err) {
      if ((err as Error).name === 'AbortError' && buildAbort === ctrl) {
        agentLine.textContent = `${content.trim() ? `${content.trim()}\n\n` : ''}[output stopped by operator]`;
      } else {
        agentLine.textContent = `[error] ${(err as Error).message}`;
      }
    } finally {
      agentLine.classList.remove('streaming');
      finishStreamView();
      buildStreaming = false;
      buildAbort = null;
      chatSend.disabled = false;
      chatStop.disabled = true;
      chatInput.focus();
      void loadActivity();
      void loadVitals();
    }
  };

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text || buildStreaming) return;
    chatInput.value = '';
    void (async () => {
      await ensureHistory();
      await sendBuildMessage(text);
    })();
  });

  card.append(head, versions, wrap, chat);
  artifactsList.prepend(card);

  if (opts.expand) void ensureHistory();
}

async function loadArtifacts(): Promise<void> {
  artifactsList.innerHTML = '';
  buildCards.clear();
  try {
    const { artifacts } = await getJson<{ artifacts: ArtifactInfo[] }>(
      `/api/artifacts?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    for (const artifact of [...artifacts].reverse()) addArtifact(artifact);
  } catch {
    // artifacts are best-effort
  }
  if (!artifactsList.childElementCount) artifactsEmpty.classList.remove('hidden');
}

function renderAgent(data: ApiLooper): void {
  const { identity, codex } = data;
  const p = codex.personality ?? {};

  agentName.textContent = codex.name ?? identity.name ?? `Looper #${identity.tokenId}`;
  agentClass.textContent = codex.agent_class ?? 'Unclassified';
  agentSpec.textContent = [codex.specialization, codex.secondary_class ? `secondary: ${codex.secondary_class}` : '']
    .filter(Boolean)
    .join(' · ') || 'no specialization recorded';
  agentVoice.textContent = p.voice ? `“${p.voice}”` : '';

  const hasRisk = typeof p.risk_tolerance === 'number';
  const hasAuto = typeof p.autonomy_level === 'number';
  meters.style.display = hasRisk || hasAuto ? '' : 'none';
  if (hasRisk) {
    riskVal.textContent = `${p.risk_tolerance}/10 · ${p.risk_profile ?? ''}`.trim();
    riskBar.style.width = `${Math.min(100, (p.risk_tolerance as number) * 10)}%`;
  }
  if (hasAuto) {
    autonomyVal.textContent = `${p.autonomy_level}/10 · ${p.autonomy_profile ?? ''}`.trim();
    autonomyBar.style.width = `${Math.min(100, (p.autonomy_level as number) * 10)}%`;
  }

  traitsEl.innerHTML = '';
  for (const t of codex.selected_visual_traits ?? []) {
    const row = document.createElement('div');
    row.className = `trait${t.trait.toLowerCase() === 'none' ? ' none' : ''}`;
    const layer = document.createElement('span');
    layer.className = 'layer';
    layer.textContent = t.layer;
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = t.trait;
    row.append(layer, value);
    traitsEl.appendChild(row);
  }

  const dna = codex.provenance?.hashlips_dna;
  provenanceEl.innerHTML = '';
  const line1 = document.createElement('div');
  line1.textContent = `${codex.provenance?.source_compiler ?? 'unknown compiler'} · dna ${dna ? short(dna) : '—'} · codex ${codex.trait_codex_version ?? '?'} (${data.codexSource})`;
  const line2 = document.createElement('div');
  const owner = identity.owner ?? 'unknown owner';
  line2.textContent = `owner ${short(owner)} · ${identity.symbol} #${identity.tokenId} · runs locally, keys stay yours`;

  const extraLines: HTMLDivElement[] = [];
  const bindings = data.bindings;
  if (bindings?.bound) {
    const lineAgent = document.createElement('div');
    lineAgent.textContent = `erc-8004 agent #${bindings.agentId ?? '—'} · registry ${bindings.identityRegistry ? short(bindings.identityRegistry) : '—'}`;
    lineAgent.title = `identity registry: ${bindings.identityRegistry ?? 'unknown'}`;
    const lineTba = document.createElement('div');
    lineTba.textContent = `erc-6551 account ${bindings.tokenBoundAccount ? short(bindings.tokenBoundAccount) : '—'}`;
    lineTba.title = bindings.tokenBoundAccount ?? '';
    extraLines.push(lineAgent, lineTba);
  }

  const line3 = document.createElement('div');
  const source = data.metadata.external_url ?? `https://helixa.xyz/multipass/loopers/${identity.tokenId}`;
  const link = document.createElement('a');
  link.href = source;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'collection page ↗';
  line3.appendChild(link);
  provenanceEl.append(line1, line2, ...extraLines, line3);
}

function renderMode(data: ApiLooper): void {
  if (data.mode.llm === 'live') {
    modeChip.textContent = `live · ${data.mode.model}`;
    modeChip.className = 'chip chip-live';
  } else {
    modeChip.textContent = 'mock brain · add DEEPSEEK_API_KEY';
    modeChip.className = 'chip chip-mock';
  }
  chainChip.textContent = `base · ${short(data.identity.contract)}`;
}

function renderImage(): void {
  agentImageFallback.textContent = 'loading art from arweave…';
  agentImage.classList.add('hidden');
  agentImage.onload = () => {
    agentImage.classList.remove('hidden');
    agentImageFallback.style.display = 'none';
  };
  agentImage.onerror = () => {
    agentImageFallback.style.display = '';
    agentImageFallback.textContent = 'art unavailable — all gateways missed (server will retry)';
  };
  agentImage.src = `/api/image/${tokenId}?t=${Date.now()}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;
}

async function renderHistory(): Promise<void> {
  chatLog.innerHTML = '';
  try {
    const { messages } = await getJson<{ messages: Array<{ role: 'user' | 'assistant'; content: string }> }>(
      `/api/chat/history?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    for (const m of messages) appendBubble(m.role === 'user' ? 'user' : 'agent', m.content);
  } catch {
    // history is best-effort
  }
  if (!chatLog.childElementCount) {
    appendBubble('system', `give #${tokenId} a job — try: “triage a failure” / “harden this workflow” / “clean up this repo”`);
  }
}

async function sendMessage(text: string): Promise<void> {
  if (streaming) return;
  streaming = true;
  chatSend.disabled = true;
  chatStop.disabled = false;
  const ctrl = new AbortController();
  activeAbort = ctrl;
  let content = '';

  appendBubble('user', text);
  const bubble = appendBubble('agent', '');
  bubble.classList.add('streaming');
  let thoughts: ThoughtStream | null = null;
  const tools = new ToolFeed((el) => chatLog.insertBefore(el, bubble));
  const finishStreamView = (): void => {
    thoughts?.finish();
    tools.finish();
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ tokenId, sessionKey, message: text }),
      signal: ctrl.signal,
    });
    if (res.status === 401) showAuthHint();
    if (!res.ok || !res.body) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as {
          type: string;
          text?: string;
          message?: string;
          name?: string;
          note?: string;
          ok?: boolean;
          ms?: number;
          argsChars?: number;
          artifact?: ArtifactInfo;
        };
        if (event.type === 'delta' && event.text) {
          content += event.text;
          bubble.textContent = content;
          thoughts?.breakPhase();
          chatLog.scrollTop = chatLog.scrollHeight;
        } else if (event.type === 'thought' && event.text) {
          thoughts ??= new ThoughtStream((el) => chatLog.insertBefore(el, bubble));
          thoughts.append(event.text);
          chatLog.scrollTop = chatLog.scrollHeight;
        } else if (event.type === 'tool_progress' && event.name) {
          tools.progress(event.name, event.argsChars ?? 0);
        } else if (event.type === 'tool_tick') {
          tools.tick(event.ms ?? 0);
        } else if (event.type === 'error') {
          content += `\n[error] ${event.message ?? 'unknown'}`;
          bubble.textContent = content;
        } else if (event.type === 'tool' && event.name) {
          bumpActivity(event.name);
          tools.start(event.name, event.note);
        } else if (event.type === 'tool_done' && event.name) {
          tools.done(event.name, event.ms ?? 0, event.ok !== false, event.note);
        } else if (event.type === 'artifact' && event.artifact) {
          addArtifact(event.artifact, { expand: true });
          bumpBuildBadge();
          addBuildChip(event.artifact);
        }
      }
    }
    if (!content) bubble.textContent = '(no output)';
  } catch (err) {
    if ((err as Error).name === 'AbortError' && activeAbort === ctrl) {
      // stopped by operator — show what arrived, marked (the server persists the same)
      bubble.textContent = `${content.trim() ? `${content.trim()}\n\n` : ''}[output stopped by operator]`;
    } else {
      bubble.textContent = `[error] ${(err as Error).message}`;
    }
  } finally {
    bubble.classList.remove('streaming');
    finishStreamView();
    streaming = false;
    activeAbort = null;
    chatSend.disabled = false;
    chatStop.disabled = true;
    chatInput.focus();
    void loadActivity();
    void loadVitals();
  }
}

function renderHelixaCred(cred: ApiLooper['helixaCred']): void {
  if (cred) {
    helixaCredEl.textContent = `helixa cred: ${cred.score}/${cred.scoreScale} · ${cred.tier}${cred.riskLevel ? ` · ${cred.riskLevel} risk` : ''}`;
    helixaCredEl.title = `source: ${cred.provider ?? 'helixa-cred'}${cred.lastUpdated ? ` · updated ${cred.lastUpdated}` : ''}`;
  } else {
    helixaCredEl.textContent = 'helixa cred: not published for this agent yet';
    helixaCredEl.title = 'The real Cred system (cred.exchange) publishes assessments per ERC-8004 agent once an agent is listed.';
  }
}

function showActivation(message = ''): void {
  activationEl.classList.remove('hidden');
  activationError.textContent = message;
  activationInput.focus();
}

/** GET the bundle; when the server demands an ownership proof, run the wallet check and retry once. */
async function fetchBundle(token: number): Promise<ApiLooper> {
  try {
    return await getJson<ApiLooper>(`/api/looper/${token}`);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'OWNERSHIP_REQUIRED') throw err;
    await runOwnershipCheck(token);
    return await getJson<ApiLooper>(`/api/looper/${token}`);
  }
}

/** SIWE-style ownership check: one plain-message signature; no transaction, no gas. */
async function runOwnershipCheck(token: number): Promise<void> {
  const wallet = hostWallet();
  if (!wallet) {
    throw new Error('ownership verification is on and needs a browser wallet (or run the server with LOOPER_REQUIRE_OWNERSHIP=false)');
  }
  activationError.textContent = 'connect the wallet that owns this Looper…';
  const accounts = (await wallet.request({ method: 'eth_requestAccounts' })) as string[] | undefined;
  const address = accounts?.[0];
  if (!address) throw new Error('no wallet account was provided');
  const challenge = await postJson<{ nonce: string; message: string }>('/api/ownership/challenge', {
    tokenId: token,
    address,
  });
  activationError.textContent = 'sign the ownership message in your wallet — no gas, no transaction…';
  const signature = (await wallet.request({
    method: 'personal_sign',
    params: [challenge.message, address],
  })) as string;
  const verified = await postJson<{ proof: string }>('/api/ownership/verify', {
    nonce: challenge.nonce,
    signature,
  });
  localStorage.setItem(`looper-harness.proof.${token}`, verified.proof);
  activationError.textContent = '';
}

async function activate(token: number): Promise<void> {
  const firstBoot = !activationEl.classList.contains('hidden');
  tokenId = token;
  sessionKey = `web:${tokenId}`;

  try {
    const data = await fetchBundle(tokenId);
    localStorage.setItem('looper-harness.token', String(tokenId));
    tokenInput.value = String(tokenId);
    renderAgent(data);
    renderMode(data);
    renderImage();
    renderHelixaCred(data.helixaCred ?? null);
    activationEl.classList.add('hidden');
  } catch (err) {
    if (firstBoot) {
      showActivation(`couldn't activate Looper #${tokenId} — ${(err as Error).message}`);
      return;
    }
    agentName.textContent = `Looper #${tokenId}`;
    provenanceEl.textContent = `activation failed: ${(err as Error).message}`;
    modeChip.textContent = 'offline';
    modeChip.className = 'chip chip-error';
  }

  await renderHistory();
  await loadArtifacts();
  void loadVitals();
  void loadActivity();
  void loadLedger();
  if (currentView === 'memory') void loadMemoryView();
  if (currentView === 'archive') void loadArchive();
  closeVersionModal();
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  void sendMessage(text);
});

chatStop.addEventListener('click', () => {
  activeAbort?.abort();
});

chatReset.addEventListener('click', async () => {
  try {
    await postJson('/api/chat/reset', { sessionKey });
  } catch {
    // ignore
  }
  await renderHistory();
  void loadVitals();
  void loadActivity();
});

vitalsRefresh.addEventListener('click', () => void loadVitals());
activityRefresh.addEventListener('click', () => void loadActivity());
tasksRefresh.addEventListener('click', () => void loadLedger());
locksRefresh.addEventListener('click', () => void loadLedger());
memoryRefresh.addEventListener('click', () => void loadMemoryView());
memoryFilter.addEventListener('input', () => renderMemory());
dreamNow.addEventListener('click', async () => {
  dreamNow.disabled = true;
  dreamNow.textContent = 'dreaming…';
  try {
    const r = await postJson<{ ok: boolean; skipped?: string; dream?: { title: string } }>('/api/dream', { tokenId });
    toast(r.ok ? `dream stored — "${r.dream?.title ?? 'untitled'}"` : `no dream: ${r.skipped ?? 'skipped'}`, r.ok ? 'info' : 'error');
    void loadMemoryView();
    void loadVitals();
  } catch (err) {
    toast((err as Error).message, 'error');
  } finally {
    dreamNow.disabled = false;
    dreamNow.textContent = 'dream now';
  }
});
archiveRefresh.addEventListener('click', () => void loadArchive());
archiveSearch.addEventListener('input', () => renderArchiveEvents());
versionModalClose.addEventListener('click', closeVersionModal);
versionModal.addEventListener('click', (event) => {
  if (event.target === versionModal) closeVersionModal();
});
settingsOpen.addEventListener('click', () => void openSettings());
activationSettings.addEventListener('click', () => void openSettings());
settingsClose.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) closeSettings();
});
settingsSave.addEventListener('click', () => void saveSettings());
settingsReset.addEventListener('click', () => void resetSettings());
settingsKeyClear.addEventListener('click', () => void clearApiKey());
setupSave.addEventListener('click', () => void saveSetup(false));
setupDefaults.addEventListener('click', () => void saveSetup(true));

tokenForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const next = Number(tokenInput.value);
  if (Number.isInteger(next) && next > 0) void activate(next);
});

activationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const next = Number(activationInput.value);
  if (!Number.isInteger(next) || next < 1 || next > 7777) {
    activationError.textContent = 'enter a Looper token id — an integer from 1 to 7777.';
    return;
  }
  void activate(next);
});

for (const tab of document.querySelectorAll<HTMLButtonElement>('.view-tab')) {
  tab.addEventListener('click', () => switchView((tab.dataset.view ?? 'console') as View));
}

/* ---------- wallet bridge: dapp previews → host confirmation → wallet ------ */

const walletPanel = $<HTMLDivElement>('wallet-panel');
const walletPanelBuild = $<HTMLSpanElement>('wallet-panel-build');
const walletPanelBody = $<HTMLDivElement>('wallet-panel-body');
const walletPanelApprove = $<HTMLButtonElement>('wallet-panel-approve');
const walletPanelReject = $<HTMLButtonElement>('wallet-panel-reject');

interface HostProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function hostWallet(): HostProvider | null {
  const eth = (window as unknown as { ethereum?: Partial<HostProvider> }).ethereum;
  return eth && typeof eth.request === 'function' ? (eth as HostProvider) : null;
}

/** Methods refused by policy — blind signing and pre-signed blobs never pass. */
const BRIDGE_REFUSED = new Set([
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'eth_sendRawTransaction',
]);

let walletAccounts: string[] = [];
let walletPanelOpen = false;

function walletRow(key: string, value: string, cls = ''): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'wallet-row';
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = key;
  const v = document.createElement('span');
  v.className = cls ? `v ${cls}` : 'v';
  v.textContent = value;
  row.append(k, v);
  return row;
}

function closeWalletPanel(): void {
  walletPanelOpen = false;
  walletPanel.classList.add('hidden');
  walletPanelBody.replaceChildren();
}

function showWalletPanel(opts: {
  build: string;
  rows: Array<[string, string, string?]>;
  approveLabel: string;
  onApprove: () => Promise<void>;
  onReject: () => void;
}): void {
  walletPanelBuild.textContent = opts.build;
  walletPanelBody.replaceChildren(...opts.rows.map(([k, v, cls]) => walletRow(k, v, cls ?? '')));
  walletPanelApprove.textContent = opts.approveLabel;
  walletPanelApprove.disabled = false;
  walletPanelReject.disabled = false;
  walletPanelOpen = true;
  walletPanel.classList.remove('hidden');

  const finish = (errorText?: string): void => {
    if (errorText) {
      walletPanelBody.append(walletRow('error', errorText, 'bad'));
      walletPanelApprove.disabled = true;
      walletPanelApprove.onclick = null;
      walletPanelReject.disabled = false;
      walletPanelReject.textContent = 'close';
      walletPanelReject.onclick = () => {
        walletPanelReject.textContent = 'reject';
        closeWalletPanel();
      };
      return;
    }
    walletPanelApprove.onclick = null;
    walletPanelReject.onclick = null;
    closeWalletPanel();
  };

  walletPanelApprove.onclick = () => {
    walletPanelApprove.disabled = true;
    walletPanelReject.disabled = true;
    opts
      .onApprove()
      .then(() => finish())
      .catch((err: { message?: string }) => finish(err?.message ?? 'request failed'));
  };
  walletPanelReject.onclick = () => {
    finish();
    opts.onReject();
  };
}

async function replyToFrame(
  frame: HTMLIFrameElement,
  id: string,
  result: unknown,
  error?: { code: number; message: string },
): Promise<void> {
  frame.contentWindow?.postMessage({ type: 'looper-wallet-response', id, ...(error ? { error } : { result }) }, '*');
}

async function handleBridgeRequest(frame: HTMLIFrameElement, id: string, method: string, params: unknown[]): Promise<void> {
  const buildName = frame.dataset.build || frame.getAttribute('title') || 'build';
  const host = hostWallet();

  if (BRIDGE_REFUSED.has(method)) {
    await replyToFrame(frame, id, undefined, {
      code: 4200,
      message: `${method} is refused by the console wallet bridge — blind signing and raw sends are not allowed here.`,
    });
    return;
  }

  if (method === 'eth_accounts') {
    if (host) {
      try {
        walletAccounts = (await host.request({ method: 'eth_accounts' })) as string[];
      } catch {
        // keep the cache
      }
    }
    await replyToFrame(frame, id, walletAccounts);
    return;
  }

  if (method === 'eth_requestAccounts') {
    if (!host) {
      await replyToFrame(frame, id, undefined, { code: 4900, message: 'no wallet extension detected in this browser — install one to connect' });
      return;
    }
    if (walletPanelOpen) {
      await replyToFrame(frame, id, undefined, { code: 4001, message: 'another wallet request is already awaiting the operator' });
      return;
    }
    showWalletPanel({
      build: buildName,
      rows: [
        ['request', 'connect — this page wants to see your wallet address'],
        ['network', 'your wallet will confirm'],
      ],
      approveLabel: 'connect wallet',
      onApprove: async () => {
        try {
          walletAccounts = (await host.request({ method: 'eth_requestAccounts' })) as string[];
          await replyToFrame(frame, id, walletAccounts);
        } catch (err) {
          await replyToFrame(frame, id, undefined, { code: 4001, message: (err as Error).message ?? 'connection rejected' });
          throw err;
        }
      },
      onReject: () => void replyToFrame(frame, id, undefined, { code: 4001, message: 'user rejected the connection request' }),
    });
    return;
  }

  if (method === 'wallet_switchEthereumChain') {
    const chainId = String((params[0] as { chainId?: unknown })?.chainId ?? '').toLowerCase();
    if (chainId !== '0x2105' && chainId !== '0x14a34') {
      await replyToFrame(frame, id, undefined, { code: 4902, message: 'only Base (0x2105) and Base Sepolia (0x14a34) are supported' });
      return;
    }
    if (!host) {
      await replyToFrame(frame, id, undefined, { code: 4900, message: 'no wallet extension detected in this browser' });
      return;
    }
    try {
      await host.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
      await replyToFrame(frame, id, null);
    } catch (err) {
      await replyToFrame(frame, id, undefined, { code: 4902, message: (err as Error).message ?? 'switch failed' });
    }
    return;
  }

  if (method === 'eth_sendTransaction') {
    if (!host) {
      await replyToFrame(frame, id, undefined, { code: 4900, message: 'no wallet extension detected in this browser — nothing can be signed here' });
      return;
    }
    if (walletPanelOpen) {
      await replyToFrame(frame, id, undefined, { code: 4001, message: 'another wallet request is already awaiting the operator' });
      return;
    }
    const txRaw = (params[0] ?? {}) as { from?: string; to?: string; data?: string; value?: string };
    if (!txRaw || typeof txRaw.to !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(txRaw.to)) {
      await replyToFrame(frame, id, undefined, { code: -32602, message: 'tx.to must be a 0x address' });
      return;
    }

    // Host decides the chain context: the wallet's current network, else mainnet.
    let chain: 'base' | 'sepolia' = 'base';
    try {
      const cid = String(await host.request({ method: 'eth_chainId' })).toLowerCase();
      if (cid === '0x14a34') chain = 'sepolia';
      else if (cid !== '0x2105') {
        await replyToFrame(frame, id, undefined, { code: 4902, message: `wallet is on chain ${cid} — switch to Base (8453) or Base Sepolia (84532) first` });
        return;
      }
    } catch {
      // treat as mainnet
    }

    let inspect: {
      chain: string;
      decoded: { signature: string; args: unknown[] } | null;
      decodeNote: string;
      selector: string | null;
      simulation: { ok: boolean; result?: string; reason?: string };
      gasEstimate: string | null;
      valueEth: string;
    };
    try {
      inspect = await postJson('/api/web3/inspect', {
        chain,
        tx: { to: txRaw.to, data: txRaw.data ?? '0x', value: txRaw.value, from: txRaw.from ?? walletAccounts[0] },
      });
    } catch (err) {
      await replyToFrame(frame, id, undefined, { code: -32603, message: `could not inspect the transaction: ${(err as Error).message}` });
      return;
    }

    const rows: Array<[string, string, string?]> = [
      ['chain', inspect.chain],
      ['to', txRaw.to],
      ['function', inspect.decoded ? inspect.decoded.signature : `RAW CALLDATA — ${inspect.decodeNote}`, inspect.decoded ? '' : 'warn'],
      ['selector', inspect.selector ?? '(none — plain ETH transfer)'],
      ['value', `${inspect.valueEth} ETH`, Number(inspect.valueEth) > 0.05 ? 'warn' : ''],
    ];
    if (inspect.decoded) rows.push(['args', JSON.stringify(inspect.decoded.args, null, 2)]);
    rows.push(
      inspect.simulation.ok
        ? ['simulation', `✓ passed — result ${inspect.simulation.result ?? '0x'}`, 'good']
        : ['simulation', `✗ WOULD REVERT — ${inspect.simulation.reason ?? 'unknown reason'}`, 'bad'],
    );
    if (inspect.gasEstimate) rows.push(['gas estimate', inspect.gasEstimate]);
    if (!inspect.decoded) rows.push(['raw calldata', txRaw.data ?? '0x']);

    showWalletPanel({
      build: buildName,
      rows,
      approveLabel: 'approve & sign',
      onApprove: async () => {
        const tx: Record<string, unknown> = { to: txRaw.to };
        if (txRaw.data) tx.data = txRaw.data;
        if (txRaw.value) tx.value = txRaw.value;
        const from = txRaw.from ?? walletAccounts[0];
        if (from) tx.from = from;
        try {
          const hash = await host.request({ method: 'eth_sendTransaction', params: [tx] });
          await replyToFrame(frame, id, hash);
        } catch (err) {
          await replyToFrame(frame, id, undefined, {
            code: (err as { code?: number }).code ?? 4001,
            message: (err as Error).message ?? 'wallet rejected the transaction',
          });
          throw err;
        }
      },
      onReject: () => void replyToFrame(frame, id, undefined, { code: 4001, message: 'user rejected the request' }),
    });
    return;
  }

  await replyToFrame(frame, id, undefined, { code: 4200, message: `method ${method} is not supported by the console wallet bridge` });
}

window.addEventListener('message', (event) => {
  const d = event.data as { type?: string; id?: string; method?: string; params?: unknown[] } | null;
  if (!d || d.type !== 'looper-wallet-request' || typeof d.id !== 'string') return;
  const frame = Array.from(document.querySelectorAll('iframe')).find((f) => f.contentWindow === event.source) as
    | HTMLIFrameElement
    | undefined;
  if (!frame) return; // not one of our frames — ignore
  void handleBridgeRequest(frame, d.id, String(d.method ?? ''), Array.isArray(d.params) ? d.params : []);
});

function startConsole(): void {
  if (tokenId) void activate(tokenId);
  else showActivation();
}

async function boot(): Promise<void> {
  try {
    const state = await getJson<SetupState>('/api/settings');
    if (!state.setupComplete) {
      renderSetup(state);
      setupEl.classList.remove('hidden');
      return; // the console starts once the wizard saves
    }
  } catch {
    // settings unreachable — fall through to the normal console
  }
  startConsole();
}

void boot();

export {};
