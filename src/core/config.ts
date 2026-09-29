import 'dotenv/config';
import path from 'node:path';

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

const handle = env('LOOPER_HANDLE').replace(/^@/, '');

export const config = {
  rpcUrl: env('BASE_RPC_URL', 'https://mainnet.base.org'),
  sepoliaRpcUrl: env('BASE_SEPOLIA_RPC_URL'),
  contract: env('LOOPER_CONTRACT', '0x1649CD37f4748807b4882FC48765bA0B2aFfa94a') as `0x${string}`,
  // 0 = not configured — the console asks for a token id on first boot.
  defaultTokenId: Number(env('LOOPER_TOKEN_ID', '0')) || 0,
  callsign: env('LOOPER_CALLSIGN'),
  handle: handle ? `@${handle}` : '',
  host: env('HOST', '127.0.0.1'),
  port: Number(env('PORT', '4520')),
  deepseek: {
    apiKey: env('DEEPSEEK_API_KEY'),
    baseUrl: env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: env('DEEPSEEK_MODEL', 'deepseek-flash'),
    temperature: Number(env('DEEPSEEK_TEMPERATURE', '0.7')),
    // Output ceiling for every LLM call. The provider DEFAULT is small enough
    // to truncate a large tool call mid-JSON (which surfaces as 'unparseable
    // arguments' and blinds the agent) — verified against DeepSeek: values up
    // to 65536 are accepted. Env: LOOPER_MAX_OUTPUT_TOKENS.
    maxOutputTokens: Math.max(1024, Number(env('LOOPER_MAX_OUTPUT_TOKENS', '32768')) || 32768),
  },
  telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  discordBotToken: env('DISCORD_BOT_TOKEN'),
  apiToken: env('LOOPER_API_TOKEN'),
  // Ownership gate: activation requires a wallet signature matching ownerOf.
  // Default ON (public posture); LOOPER_REQUIRE_OWNERSHIP=false disables.
  requireOwnership: env('LOOPER_REQUIRE_OWNERSHIP', 'true') !== 'false',
  chatRateLimitPerMinute: Number(env('CHAT_RATE_LIMIT_PER_MINUTE', '0')),
  // run_module sandbox: when Node's permission model cannot be enforced on this
  // platform, the tool refuses by default (fail closed). Set true to allow
  // unguarded execution anyway — the operator accepts the risk.
  runUnsandboxed: env('LOOPER_RUN_UNSANDBOXED', 'false') === 'true',
  maxMessageChars: Number(env('LOOPER_MAX_MESSAGE_CHARS', '4000')),
  dream: {
    enabled: env('DREAM_ENABLED', 'true') !== 'false',
    hour: Math.min(23, Math.max(0, Number(env('DREAM_HOUR', '3')) || 3)),
  },
  telegramAllowedChatIds: env('TELEGRAM_ALLOWED_CHAT_IDS').split(',').map((s) => s.trim()).filter(Boolean),
  discordAllowedUserIds: env('DISCORD_ALLOWED_USER_IDS').split(',').map((s) => s.trim()).filter(Boolean),
  // Default agent-state location; first-run setup can relocate it (env wins).
  dataDir: path.resolve(env('LOOPER_DATA_DIR', 'data')),
};
