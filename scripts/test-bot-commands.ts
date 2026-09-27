/**
 * Bot-command smoke test: /builds in DM vs group (visibility split),
 * /help suffix handling, and market_price on the telegram lane (live).
 */
import { handleIncomingText } from '../src/bot/commands.js';
import { executeToolCall, toolSpecsForSurface } from '../src/core/tools.js';

console.log('telegram lane:', toolSpecsForSurface('telegram').map((t) => t.function.name).join(', '));

console.log('\n--- DM: /builds ---');
console.log(await handleIncomingText(1, 'tg:111222333', '/builds'));

console.log('\n--- group: /builds (restricted view) ---');
console.log(await handleIncomingText(1, 'tg:-100555000111', '/builds', { group: true, speaker: 'guest' }));

console.log('\n--- group: /help@myagent_bot (suffix handling) ---');
console.log(await handleIncomingText(1, 'tg:-100555000111', '/help@myagent_bot', { group: true, speaker: 'guest' }));

console.log('\n--- telegram lane: market_price (live, USDC) ---');
const mp = await executeToolCall(
  {
    id: 'mp',
    type: 'function',
    function: { name: 'market_price', arguments: JSON.stringify({ token_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }) },
  },
  { sessionKey: 'tg:111222333', surface: 'telegram', tokenId: 1 },
);
console.log(mp.modelText);

console.log('\n--- telegram lane: read_wallet must stay refused ---');
const rw = await executeToolCall(
  { id: 'rw', type: 'function', function: { name: 'read_wallet', arguments: '{}' } },
  { sessionKey: 'tg:111222333', surface: 'telegram', tokenId: 1 },
);
console.log(rw.modelText);
