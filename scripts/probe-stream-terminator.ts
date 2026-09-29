/**
 * Does the STREAMED response always announce its own end?
 *
 * The truncation detector needs to know whether a stream that ends without a
 * finish_reason is (a) normal, or (b) a cut — otherwise it would either miss
 * every cut or cry wolf on every reply. Prints the raw terminator evidence.
 */
import { config } from '../src/core/config.js';
import { llmApiKey } from '../src/core/settings.js';

const key = llmApiKey();
if (!key) {
  console.log('probe-stream-terminator: no API key configured (mock mode) — nothing to probe.');
  process.exitCode = 0;
} else {
  const run = async (label: string, body: Record<string, unknown>): Promise<void> => {
    const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: config.deepseek.model, stream: true, temperature: 0.2, ...body }),
    });
    if (!res.ok || !res.body) {
      console.log(`  ${label}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let frames = 0;
    let sawFinish = false;
    let finishValue = '(none)';
    let sawDone = false;
    let contentChars = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          sawDone = true;
          continue;
        }
        frames++;
        try {
          const j = JSON.parse(payload) as {
            choices?: Array<{ finish_reason?: string | null; delta?: { content?: string; tool_calls?: unknown[] } }>;
          };
          const fr = j.choices?.[0]?.finish_reason;
          if (fr) {
            sawFinish = true;
            finishValue = fr;
          }
          contentChars += j.choices?.[0]?.delta?.content?.length ?? 0;
        } catch {
          // partial frame
        }
      }
    }
    console.log(`  ${label}: frames=${frames} · finish_reason=${sawFinish ? `YES (${finishValue})` : 'NO'} · [DONE]=${sawDone ? 'YES' : 'NO'} · textChars=${contentChars}`);
  };

  console.log(`model=${config.deepseek.model}`);
  await run('text reply    ', { messages: [{ role: 'user', content: 'reply with exactly: ok' }] });
  await run('tool call     ', {
    messages: [{ role: 'user', content: 'Use save to store the note "hello".' }],
    tools: [
      {
        type: 'function',
        function: { name: 'save', description: 'save a note', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      },
    ],
    tool_choice: 'auto',
  });
}
