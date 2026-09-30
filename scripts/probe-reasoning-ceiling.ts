/**
 * Why did a one-line reply hit the 32K output ceiling?
 *
 * Hypothesis: the completion budget is shared with the model's REASONING stream
 * (which the console shows live but never persists), so an open-ended prompt can
 * consume the entire ceiling while "thinking" and return almost no text. This
 * reproduces it at a small ceiling to keep the cost down.
 */
import { config } from '../src/core/config.js';
import { llmApiKey } from '../src/core/settings.js';

const key = llmApiKey();
if (!key) {
  console.log('probe-reasoning-ceiling: no API key configured — nothing to probe.');
  process.exitCode = 0;
} else {
  const prompt =
    'Look up all the tools and libraries you have available to you, then surprise me with a random game. Something people would enjoy spending hours playing.';
  for (const max of [1024, 4096]) {
    const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: max,
        stream: false,
      }),
    });
    const body = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string } }>;
      usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
      error?: { message?: string };
    };
    if (body.error) {
      console.log(`max_tokens=${max}: error ${body.error.message}`);
      continue;
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content ?? '';
    const reasoning = choice?.message?.reasoning_content ?? '';
    console.log(
      `max_tokens=${max} → finish_reason=${choice?.finish_reason} · completion_tokens=${body.usage?.completion_tokens} · reasoning_tokens=${body.usage?.completion_tokens_details?.reasoning_tokens ?? '?'} · content_chars=${content.length} · reasoning_chars=${reasoning.length}`,
    );
    console.log(`  content head: ${JSON.stringify(content.slice(0, 120))}`);
    console.log(`  reasoning tail: ${JSON.stringify(reasoning.slice(-160))}`);
  }
}
