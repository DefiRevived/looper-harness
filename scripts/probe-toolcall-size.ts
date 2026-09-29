/**
 * Reproduction: WHY large builds failed, and that the fix holds.
 *
 * Asks the model to write one large file THROUGH a tool call (the same shape as
 * render_artifact carrying a build) twice:
 *   1. with no max_tokens — the old behaviour (provider default ceiling)
 *   2. with config.deepseek.maxOutputTokens — what the harness now sends
 *
 * Spends a few thousand output tokens per run; manual + diagnostic only.
 */
import { config } from '../src/core/config.js';
import { llmApiKey } from '../src/core/settings.js';

const key = llmApiKey();
if (!key) {
  console.log('probe-toolcall-size: no API key configured (mock mode) — nothing to probe.');
  process.exitCode = 0;
} else {
  const tool = {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write one file into the project.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
    },
  };
  const prompt =
    'Use write_file to create src/big.js. It must contain exactly 320 exported functions named f1..f320, one per line, ' +
    'each of the form `export function fN(){ return N; } // <pad this comment with words until the line is about 90 characters>`. ' +
    'Do not summarize or abbreviate — write the entire file through the tool.';

  interface Outcome {
    finish: string;
    kb: number;
    parsed: boolean;
    completion: number;
  }

  const attempt = async (maxTokens?: number, label = ''): Promise<Outcome> => {
    const started = Date.now();
    const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [{ role: 'user', content: prompt }],
        tools: [tool],
        tool_choice: 'auto',
        temperature: 0.2,
        stream: false,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      }),
    });
    const body = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
      usage?: { completion_tokens?: number };
      error?: { message?: string };
    };
    if (body.error) {
      console.log(`  ${label}: provider error — ${body.error.message}`);
      return { finish: 'error', kb: 0, parsed: false, completion: 0 };
    }
    const args = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? '';
    let parsed = false;
    try {
      JSON.parse(args);
      parsed = true;
    } catch {
      parsed = false;
    }
    const out: Outcome = {
      finish: body.choices?.[0]?.finish_reason ?? '(none)',
      kb: Number((args.length / 1024).toFixed(1)),
      parsed,
      completion: body.usage?.completion_tokens ?? 0,
    };
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(
      `  ${label}: finish_reason=${out.finish} · args=${out.kb}KB · tool-call JSON ${parsed ? 'PARSES ✓' : 'BROKEN ✗'} · completion_tokens=${out.completion} · ${secs}s`,
    );
    return out;
  };

  console.log(`model=${config.deepseek.model}`);
  console.log('\n1) OLD behaviour — no max_tokens (provider default ceiling):');
  const before = await attempt(undefined, 'default');

  console.log(`\n2) NOW — max_tokens=${config.deepseek.maxOutputTokens} (what the harness sends):`);
  const after = await attempt(config.deepseek.maxOutputTokens, 'fixed');

  console.log('\n--- verdict ---');
  console.log(
    before.parsed === false && after.parsed === true
      ? 'REPRODUCED AND FIXED: the default ceiling truncated the tool call (broken JSON — the "unparseable arguments" the agent hit); with the explicit ceiling the same write completes and parses.'
      : `default: parsed=${before.parsed}, finish=${before.finish} · fixed: parsed=${after.parsed}, finish=${after.finish} — read above; a clean default run means this provider's default was high enough for this size, so also rely on the truncation detector (it reports the ceiling whenever finish_reason=length).`,
  );
}
