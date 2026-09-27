/**
 * The configured Looper (LOOPER_TOKEN_ID) as an MCP server (stdio).
 *
 * Exposes the local agent runtime — persona chat, profile, status, and the
 * token's on-chain identity (ERC-8004 agent binding + ERC-6551 account) — to
 * any MCP client: VS Code Copilot, Claude Desktop, Cursor, etc.
 *
 * NOTE: stdout is reserved for the protocol; log to stderr only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from '../core/config.js';
import { loadLooper } from '../core/codex.js';
import { readAgentBindings } from '../core/chain.js';
import { readHelixaCred } from '../core/cred.js';
import { agentReply } from '../core/brain.js';
import { llmMode } from '../core/llm.js';
import * as store from '../core/store.js';

const TOKEN_ID = config.defaultTokenId;

if (!TOKEN_ID) {
  console.error('[mcp] LOOPER_TOKEN_ID is not set — add it to .env so the MCP server knows which token to serve.');
  process.exit(1);
}

const SESSION = 'mcp:main';
const LABEL = `Looper #${TOKEN_ID}`;

const reply = (text: string) => ({ content: [{ type: 'text' as const, text }] });

async function statusText(): Promise<string> {
  const bundle = await loadLooper(TOKEN_ID);
  const bindings = await readAgentBindings(TOKEN_ID);
  const cred = bindings.agentId ? await readHelixaCred(bindings.agentId) : null;
  const p = bundle.codex.personality ?? {};

  return [
    `${bundle.codex.name ?? LABEL} — ${bundle.codex.agent_class ?? 'Unclassified'}${bundle.codex.specialization ? ` (${bundle.codex.specialization})` : ''}`,
    `owner: ${bundle.identity.owner ?? 'unknown'} · contract: ${bundle.identity.contract}`,
    `voice: ${p.voice ?? '—'}`,
    `risk: ${p.risk_profile ?? '—'}${p.risk_tolerance != null ? ` (${p.risk_tolerance}/10)` : ''} · autonomy: ${p.autonomy_profile ?? '—'}${p.autonomy_level != null ? ` (${p.autonomy_level}/10)` : ''}`,
    `brain: ${llmMode() === 'live' ? `live (${config.deepseek.model})` : 'mock (no DEEPSEEK_API_KEY)'}`,
    `helixa cred: ${cred ? `${cred.score}/${cred.scoreScale} · ${cred.tier}${cred.riskLevel ? ` · ${cred.riskLevel} risk` : ''}` : 'not published for this agent yet'}`,
    `erc-8004: ${bindings.bound ? 'bound' : 'unbound'}${bindings.agentId ? ` · agent #${bindings.agentId}` : ''} · registry ${bindings.identityRegistry ?? '—'}`,
    `erc-6551 account: ${bindings.tokenBoundAccount ?? '—'}`,
    `codex: ${bundle.codexSource} · ${bundle.codex.trait_codex_version ?? '?'}`,
  ].join('\n');
}

const server = new McpServer({ name: `looper-${TOKEN_ID}`, version: '0.1.0' });

server.registerTool(
  'looper_status',
  {
    title: `${LABEL} status`,
    description: `Identity, agent class, brain mode, Helixa cred, and on-chain ERC-8004/ERC-6551 bindings for ${LABEL} on Base.`,
    inputSchema: {},
  },
  async () => reply(await statusText()),
);

server.registerTool(
  'looper_profile',
  {
    title: `${LABEL} profile`,
    description: `Full trait stack, class scores, personality, lore and activation brief for ${LABEL}.`,
    inputSchema: {},
  },
  async () => {
    const bundle = await loadLooper(TOKEN_ID);
    const c = bundle.codex;
    const p = c.personality ?? {};
    const traits = (c.selected_visual_traits ?? []).map((t) => `- ${t.layer}: ${t.trait}`).join('\n');
    const scores = Object.entries(c.class_scores ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ');
    const missions = (c.activation?.first_missions ?? []).map((m) => `- ${m}`).join('\n');

    return reply(
      [
        `${c.name ?? LABEL} — ${c.agent_class ?? 'Unclassified'}${c.specialization ? ` / ${c.specialization}` : ''}`,
        `class scores: ${scores || '—'}`,
        '',
        'traits:',
        traits || '-',
        '',
        `personality: voice="${p.voice ?? '—'}" · values ${(p.values ?? []).join('; ') || '—'}`,
        `lore: ${c.lore?.long_lore ?? c.lore?.short_lore ?? '—'}`,
        '',
        'activation:',
        missions || '-',
        `seed: ${c.activation?.activation_seed ?? '—'}`,
        `provenance: ${c.provenance?.source_compiler ?? '—'} · dna ${c.provenance?.hashlips_dna ?? '—'}`,
      ].join('\n'),
    );
  },
);

server.registerTool(
  'looper_chat',
  {
    title: `Talk to ${LABEL}`,
    description:
      `Send a message to ${LABEL}. The agent answers in its codex persona and remembers this thread between calls. ` +
      'Give it jobs: triage, hardening, cleanup, drafts, reviews.',
    inputSchema: {
      message: z.string().min(1).describe('Message or job order for the Looper'),
    },
  },
  async ({ message }) => reply(await agentReply(TOKEN_ID, SESSION, message)),
);

server.registerTool(
  'looper_reset',
  {
    title: `Reset ${LABEL} thread`,
    description: 'Clear the conversation memory used by looper_chat.',
    inputSchema: {},
  },
  async () => {
    store.resetSession(SESSION);
    return reply('Thread memory cleared.');
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mcp] ${LABEL} MCP server ready (brain: ${llmMode()}) — tools: looper_status, looper_profile, looper_chat, looper_reset`);
