import { config } from '../core/config.js';
import { loadLooper } from '../core/codex.js';
import { readAgentBindings } from '../core/chain.js';
import { readHelixaCred } from '../core/cred.js';
import { agentReplyWithTools, type TurnContext } from '../core/brain.js';
import { distillMessages } from '../core/episodes.js';
import { llmMode } from '../core/llm.js';
import { listArtifacts, type ToolSurface } from '../core/tools.js';
import * as store from '../core/store.js';

const KNOWN_COMMANDS = new Set(['/start', '/help', '/status', '/reset', '/builds']);

export function isKnownCommand(text: string): boolean {
  const first = text.trim().split(/\s+/)[0] ?? '';
  const base = first.replace(/@[A-Za-z0-9_]+$/, '').toLowerCase();
  return KNOWN_COMMANDS.has(base);
}

const HELP = [
  'looper agent commands:',
  '/status — token, class, brain mode, helixa cred',
  '/builds — the build archive (full list in your DM)',
  '/reset — clear this thread’s memory',
  'anything else — talk to the agent',
].join('\n');

export async function handleIncomingText(
  tokenId: number,
  sessionKey: string,
  raw: string,
  turn?: TurnContext,
  surface: ToolSurface = 'telegram',
): Promise<string> {
  const text = raw.trim();
  if (!text) return 'say something with a verb in it.';

  if (text.startsWith('/')) {
    try {
      return await handleCommand(tokenId, sessionKey, text);
    } catch (err) {
      return `command failed: ${(err as Error).message}`;
    }
  }

  try {
    return await agentReplyWithTools(tokenId, sessionKey, text, turn, surface);
  } catch (err) {
    return `agent error: ${(err as Error).message}`;
  }
}

async function handleCommand(tokenId: number, sessionKey: string, text: string): Promise<string> {
  const cmd = (text.split(/\s+/)[0] ?? '').replace(/@[A-Za-z0-9_]+$/, '').toLowerCase();

  switch (cmd) {
    case '/start':
    case '/help':
      return HELP;

    case '/status': {
      const bundle = await loadLooper(tokenId);
      const codex = bundle.codex;
      const p = codex.personality ?? {};
      const bindings = await readAgentBindings(tokenId);
      const cred = bindings.agentId ? await readHelixaCred(bindings.agentId) : null;
      return [
        `${codex.name ?? `Looper #${tokenId}`} — ${codex.agent_class ?? 'Unclassified'}${codex.specialization ? ` (${codex.specialization})` : ''}`,
        `voice: ${p.voice ?? '—'}`,
        `risk: ${p.risk_profile ?? '—'} · autonomy: ${p.autonomy_profile ?? '—'} · codex source: ${bundle.codexSource}`,
        `brain: ${llmMode() === 'live' ? `live (${config.deepseek.model})` : 'mock — add a DeepSeek API key in setup (⚙)'}`,
        `helixa cred: ${cred ? `${cred.score}/${cred.scoreScale} · ${cred.tier}` : 'not published for this agent yet'}`,
        `erc-8004 agent: ${bindings.agentId ?? 'unbound'}`,
      ].join('\n');
    }

    case '/reset': {
      const snapshot = store.getSession(sessionKey);
      store.resetSession(sessionKey);
      if (snapshot.length >= 6) {
        void distillMessages(tokenId, sessionKey, snapshot, 0, 2);
        return 'thread memory cleared — key points distilled into long-term memory.';
      }
      return 'thread memory cleared.';
    }

    case '/builds': {
      const builds = listArtifacts(`web:${tokenId}`);
      // The archive is operator-side data: full list only in the operator DM.
      const isOperatorDm = sessionKey.startsWith('tg:') && !sessionKey.startsWith('tg:-');
      if (!isOperatorDm) {
        return builds.length
          ? `the build archive is operator-side — ${builds.length} build${builds.length === 1 ? '' : 's'} tracked. Browse it in the console.`
          : 'the build archive is operator-side and empty right now.';
      }
      if (!builds.length) {
        return 'no builds in the archive yet — ask the console agent to build something.';
      }
      const now = Date.now();
      const lines = builds.slice(0, 10).map((b) => {
        const ageMin = Math.max(0, Math.round((now - Date.parse(b.savedAt)) / 60_000));
        const age =
          ageMin < 60 ? `${ageMin}m ago` : ageMin < 60 * 48 ? `${Math.round(ageMin / 60)}h ago` : `${Math.round(ageMin / 1440)}d ago`;
        return `- ${b.title} (${b.kind}, ${Math.round(b.bytes / 1024)}KB, ${age})`;
      });
      const extra = builds.length > 10 ? `\n…and ${builds.length - 10} more` : '';
      return `build archive — ${builds.length} build${builds.length === 1 ? '' : 's'} (newest first):\n${lines.join('\n')}${extra}\nRevisions, previews and per-build threads live in the console.`;
    }

    default:
      return `unknown command ${cmd}\n\n${HELP}`;
  }
}
