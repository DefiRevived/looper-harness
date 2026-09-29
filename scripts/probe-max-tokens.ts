/**
 * What output ceiling does the configured provider actually enforce?
 * Probes max_tokens values with a 1-token request: an accepted value means the
 * ceiling is >= that; a 4xx names the real limit.
 */
import { config } from '../src/core/config.js';
import { llmApiKey } from '../src/core/settings.js';

const key = llmApiKey();
if (!key) {
  console.log('probe-max-tokens: no API key configured (mock mode) — nothing to probe.');
  process.exitCode = 0;
} else {
  console.log(`model=${config.deepseek.model} base=${config.deepseek.baseUrl}`);
  for (const max of [4096, 8192, 16384, 32768, 65536]) {
    const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [{ role: 'user', content: 'reply with the single word: ok' }],
        max_tokens: max,
        stream: false,
      }),
    });
    const body = await res.text();
    let note = body.slice(0, 200);
    try {
      const j = JSON.parse(body) as { error?: { message?: string }; usage?: { completion_tokens?: number } };
      note = j.error?.message ?? `ok (completion_tokens=${j.usage?.completion_tokens ?? '?'})`;
    } catch {
      // keep raw slice
    }
    console.log(`max_tokens=${String(max).padEnd(6)} → ${res.status} ${note}`);
  }
}
