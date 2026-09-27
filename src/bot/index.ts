import { config } from '../core/config.js';
import { llmMode } from '../core/llm.js';
import { startDiscord } from './discord.js';
import { startTelegram } from './telegram.js';

const tokenId = config.defaultTokenId;

if (!tokenId) {
  console.error('[bot] LOOPER_TOKEN_ID is not set — the bot needs to know which token to embody. Add it to .env and rerun.');
  process.exit(1);
}

const started: string[] = [];

if (config.telegramBotToken) {
  try {
    await startTelegram(config.telegramBotToken, tokenId);
    started.push('telegram');
  } catch (err) {
    console.error(`[telegram] failed to start: ${(err as Error).message}`);
  }
}

if (config.discordBotToken) {
  try {
    await startDiscord(config.discordBotToken, tokenId);
    started.push('discord');
  } catch (err) {
    console.error(
      `[discord] failed to start: ${(err as Error).message}\n` +
        '  hint: for guild messages the "Message Content Intent" must be enabled in the Discord developer portal.',
    );
  }
}

if (!started.length) {
  console.log('');
  console.log('  No bot adapters started.');
  console.log('  Fill TELEGRAM_BOT_TOKEN and/or DISCORD_BOT_TOKEN in .env, then rerun: npm run bot');
  console.log('');
  process.exit(0);
}

if (started.includes('telegram') && config.telegramAllowedChatIds.length === 0) {
  console.warn('[bot] telegram is OPEN — anyone who DMs this bot can use the agent (set TELEGRAM_ALLOWED_CHAT_IDS to restrict; blocked attempts are logged with their chat id)');
}
if (started.includes('discord') && config.discordAllowedUserIds.length === 0) {
  console.warn('[bot] discord is OPEN — anyone who can DM/mention this bot can use the agent (set DISCORD_ALLOWED_USER_IDS to restrict; blocked attempts are logged with their user id)');
}

console.log(`[bot] online: ${started.join(', ')} — Looper #${tokenId} (brain: ${llmMode()})`);
