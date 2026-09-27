/**
 * Smoke test for the read_looper tool: exercises the exact code path the
 * agent uses (executeToolCall) against a sibling token (#420) and prints the
 * sourced-data block that would be handed to the model.
 */
import { executeToolCall } from '../src/core/tools.js';

const ctx = { sessionKey: 'web:999991', surface: 'web' as const, tokenId: 999991 };
const res = await executeToolCall(
  { id: 'call-1', type: 'function', function: { name: 'read_looper', arguments: JSON.stringify({ token_id: 420 }) } },
  ctx,
);
console.log(res.modelText);
