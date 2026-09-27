import { Bot } from 'grammy';
import type { MessageEntity } from 'grammy/types';
import { config } from '../core/config.js';
import { llmMode } from '../core/llm.js';
import { handleIncomingText, isKnownCommand } from './commands.js';

const TELEGRAM_LIMIT = 4000;
const ROSTER_LIMIT = 200;

interface RosterEntry {
  id: number;
  name: string;
  username?: string;
}

function displayName(from: { first_name?: string; username?: string } | undefined): string {
  return from?.first_name ?? from?.username ?? 'someone';
}

/** Turn "@Name" / "@username" tokens that match known participants into tappable mentions. */
function mentionEntities(text: string, entries: RosterEntry[], ownUsername: string): MessageEntity[] {
  const entities: MessageEntity[] = [];
  const re = /@([A-Za-z0-9_]{2,32})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[1].toLowerCase();
    if (token === ownUsername.toLowerCase()) continue;
    const hit = entries.find((e) => {
      if (e.username && e.username.toLowerCase() === token) return true;
      const n = e.name.toLowerCase();
      return n === token || n.replace(/\s+/g, '') === token;
    });
    if (!hit) continue;
    entities.push({
      type: 'text_mention',
      offset: m.index,
      length: m[0].length,
      user: { id: hit.id, is_bot: false, first_name: hit.name, username: hit.username },
    });
  }
  return entities;
}

export async function startTelegram(token: string, tokenId: number): Promise<void> {
  const bot = new Bot(token);
  const allowed = new Set(config.telegramAllowedChatIds);
  const roster = new Map<number, Map<number, RosterEntry>>();

  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    if (allowed.size > 0 && !allowed.has(chatId)) {
      console.error(`[telegram] blocked chat ${chatId} — add it to TELEGRAM_ALLOWED_CHAT_IDS to allow`);
      await ctx.reply('This agent is private. Its operator has not allowlisted this chat.').catch(() => {});
      return;
    }
    if (ctx.from?.is_bot) return;
    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    if (isGroup && ctx.from) {
      let members = roster.get(ctx.chat.id);
      if (!members) {
        members = new Map();
        roster.set(ctx.chat.id, members);
      }
      members.delete(ctx.from.id);
      members.set(ctx.from.id, { id: ctx.from.id, name: displayName(ctx.from), username: ctx.from.username });
      if (members.size > ROSTER_LIMIT) {
        const oldest = members.keys().next().value;
        if (oldest !== undefined) members.delete(oldest);
      }
    }
    if (isGroup) {
      const text = ctx.message.text;
      const mention = `@${bot.botInfo.username.toLowerCase()}`;
      const mentioned = text.toLowerCase().includes(mention);
      const replyToBot = ctx.message.reply_to_message?.from?.id === bot.botInfo.id;
      if (!mentioned && !replyToBot && !isKnownCommand(text)) {
        const lower = text.toLowerCase();
        const aliases = [config.callsign, config.handle.replace(/^@/, '')]
          .map((s) => s.toLowerCase())
          .filter(Boolean);
        if (lower.includes('@') || aliases.some((a) => lower.includes(a))) {
          console.error(`[telegram] group ${chatId}: heard a possibly-addressed message but could not read a mention — ignored (${text.length} chars)`);
        }
        return;
      }
    }
    console.error(`[telegram] message from chat ${chatId} (${ctx.message.text.length} chars)${allowed.size ? '' : ' [open]'}`);
    const sessionKey = `tg:${ctx.chat.id}`;
    const turn = isGroup ? { group: true, speaker: displayName(ctx.from) } : undefined;
    await ctx.replyWithChatAction('typing').catch(() => {});
    const reply = await handleIncomingText(tokenId, sessionKey, ctx.message.text, turn, 'telegram');
    const decorated = llmMode() === 'mock' ? `[mock brain] ${reply}` : reply;
    const entries = isGroup ? [...(roster.get(ctx.chat.id)?.values() ?? [])] : [];
    for (const part of splitMessage(decorated)) {
      const entities = mentionEntities(part, entries, bot.botInfo.username);
      await ctx.reply(part, entities.length > 0 ? { entities } : undefined);
    }
    console.error(`[telegram] replied in chat ${chatId} (${decorated.length} chars)`);
  });

  bot.catch((err) => console.error('[telegram]', err.message));

  await bot.init();
  console.log(`[telegram] @${bot.botInfo.username} online`);

  void bot.start().catch((err) => console.error('[telegram] polling stopped:', (err as Error).message));
}

function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_LIMIT) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_LIMIT) {
    const cut = remaining.lastIndexOf('\n', TELEGRAM_LIMIT);
    const index = cut > TELEGRAM_LIMIT * 0.5 ? cut : TELEGRAM_LIMIT;
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}
