import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from '../core/config.js';
import { llmMode } from '../core/llm.js';
import { handleIncomingText } from './commands.js';

const DISCORD_LIMIT = 1900;

export async function startDiscord(token: string, tokenId: number): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const allowed = new Set(config.discordAllowedUserIds);

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const mentioned = client.user ? message.mentions.has(client.user) : false;
    if (message.guild && !mentioned) return;

    if (allowed.size > 0 && !allowed.has(message.author.id)) {
      console.error(`[discord] blocked user ${message.author.id} (${message.author.username}) — add it to DISCORD_ALLOWED_USER_IDS to allow`);
      await message.reply('This agent is private. Its operator has not allowlisted you.').catch(() => {});
      return;
    }

    const text = message.content.replace(/<@!?\d+>/g, '').trim();

    try {
      if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
        await message.channel.sendTyping().catch(() => {});
      }
      const reply = await handleIncomingText(tokenId, `dc:${message.channelId}`, text || '/help', undefined, 'discord');
      const decorated = llmMode() === 'mock' ? `[mock brain] ${reply}` : reply;
      for (const part of splitMessage(decorated)) {
        await message.reply({ content: part, allowedMentions: { repliedUser: false } });
      }
    } catch (err) {
      console.error('[discord]', err);
      await message.reply('hit an error — check the bot logs.').catch(() => {});
    }
  });

  client.once(Events.ClientReady, (ready) => {
    console.log(`[discord] ${ready.user.tag} online`);
  });

  await client.login(token);
}

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_LIMIT) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > DISCORD_LIMIT) {
    const cut = remaining.lastIndexOf('\n', DISCORD_LIMIT);
    const index = cut > DISCORD_LIMIT * 0.5 ? cut : DISCORD_LIMIT;
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}
