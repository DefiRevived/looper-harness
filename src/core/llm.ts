import { config } from './config.js';
import { llmApiKey } from './settings.js';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  /** Set when the provider cut the call short: the JSON args are INCOMPLETE. */
  truncated?: boolean;
  /** Why it was cut: 'ceiling' = hit the token limit · 'stream' = stream ended with no terminator. */
  truncatedReason?: 'ceiling' | 'stream';
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type StreamStep =
  | { type: 'text'; text: string }
  // The model's live reasoning stream (DeepSeek `reasoning_content`). Display-
  // only by design: never persisted, never fed back — providers reject it in
  // history, and the console shows it as it happens, then lets it go.
  | { type: 'reasoning'; text: string }
  // While the model composes a (possibly huge) tool call, nothing else streams
  // — these throttled pulses keep the console honest about what is happening.
  | { type: 'tool_progress'; name: string; argsChars: number }
  | { type: 'tool_calls'; toolCalls: ToolCall[] };

export type LlmMode = 'live' | 'mock';

/**
 * Some OpenAI-compatible endpoints reject max_tokens above their own ceiling.
 * Asking too much must never break every call, so the first rejection turns
 * the parameter off for the process (with a loud warning) and we carry on.
 */
let maxTokensSupported = true;

export function llmMode(): LlmMode {
  return llmApiKey() ? 'live' : 'mock';
}

/**
 * Streams a completion as structured steps: text deltas and/or completed tool
 * calls. Works against any OpenAI-compatible chat completions endpoint;
 * defaults to DeepSeek. Without an API key it falls back to the local mock
 * brain (mock never emits tool calls).
 */
export async function* streamSteps(messages: ChatMessage[], tools?: ToolSpec[], opts?: { signal?: AbortSignal }): AsyncGenerator<StreamStep> {
  if (llmMode() === 'mock') {
    for await (const step of mockStream(messages)) {
      if (opts?.signal?.aborted) throw new Error('stopped by operator');
      yield step;
    }
    return;
  }

  const url = `${config.deepseek.baseUrl}/chat/completions`;

  // A big tool call (e.g. re-emitting a whole build file) can stream for
  // minutes. A hard total timeout kills healthy generations mid-flight, so
  // instead: a window for time-to-first-byte, then an idle watchdog that
  // resets on every chunk. Stalled connections still abort; slow ones live.
  const ctrl = new AbortController();
  // The operator's stop button aborts the request's signal — chain it so the
  // upstream LLM fetch is cut immediately, mid-generation.
  const external = opts?.signal;
  const onExternalAbort = (): void => ctrl.abort(external?.reason ?? new Error('stopped by operator'));
  if (external?.aborted) onExternalAbort();
  else external?.addEventListener('abort', onExternalAbort, { once: true });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = (ms: number, note: string) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ctrl.abort(new Error(note)), ms);
  };
  armIdle(90_000, 'LLM stream produced no data for 90s — aborted');

  try {
    const requestBody = (): Record<string, unknown> => ({
      model: config.deepseek.model,
      messages,
      stream: true,
      temperature: config.deepseek.temperature,
      // Explicit ceiling: without it the provider default applies and a large
      // tool call (one build file) is cut off mid-JSON.
      ...(maxTokensSupported ? { max_tokens: config.deepseek.maxOutputTokens } : {}),
      ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
    });
    const send = (): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmApiKey()}`,
        },
        body: JSON.stringify(requestBody()),
        signal: ctrl.signal,
      });

    let res = await send();
    let detail = '';
    if (!res.ok || !res.body) {
      detail = await res.text().catch(() => '');
      if (maxTokensSupported && /max_tokens/i.test(detail)) {
        maxTokensSupported = false;
        console.warn(
          '[llm] provider rejected max_tokens — retrying without it. Large tool calls may now truncate at the provider default.',
        );
        res = await send();
        detail = res.ok ? '' : await res.text().catch(() => '');
      }
    }
    if (!res.ok || !res.body) {
      throw new Error(`LLM request failed (${res.status}): ${detail.slice(0, 400) || 'no body'}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const pending = new Map<number, ToolCall>();
    let buffer = '';
    let finished = false;
    let lastCallProgress = 0;
    // 'length' = the provider stopped at the output ceiling, not at a natural
    // end: anything still streaming (esp. tool-call arguments) is INCOMPLETE.
    let finishReason = '';
    // Normal streams announce their own end (a finish_reason, then [DONE] —
    // verified against the provider). A stream that ends with NEITHER was cut:
    // whatever was in flight is incomplete. That is the case that used to reach
    // the tool layer as "unparseable JSON", with nothing to act on.
    let sawFinish = false;
    let sawDone = false;
    let streamedAny = false;

    while (!finished) {
      const { done, value } = await reader.read();
      armIdle(180_000, 'LLM stream stalled — no data for 180s, aborted');
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          sawDone = true;
          finished = true;
          break;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{
              finish_reason?: string | null;
              delta?: {
                content?: string;
                reasoning_content?: string;
                tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
              };
            }>;
          };
          const choiceFr = parsed.choices?.[0]?.finish_reason;
          if (choiceFr) {
            finishReason = choiceFr;
            sawFinish = true;
          }
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning_content) yield { type: 'reasoning', text: delta.reasoning_content };
          if (delta?.content) {
            streamedAny = true;
            yield { type: 'text', text: delta.content };
          }
          for (const frag of delta?.tool_calls ?? []) {
            const idx = frag.index ?? 0;
            const acc = pending.get(idx) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
            if (frag.id) acc.id = frag.id;
            if (frag.function?.name) acc.function.name += frag.function.name;
            if (frag.function?.arguments) acc.function.arguments += frag.function.arguments;
            pending.set(idx, acc);
          }
          // A big tool call (whole-file writes, multi-KB arguments) can compose
          // for minutes with nothing else on the wire — pulse its progress so
          // the console can show that the model is still writing.
          if (delta?.tool_calls?.length && pending.size > 0) {
            const now = Date.now();
            if (now - lastCallProgress >= 900) {
              const argsChars = [...pending.values()].reduce((n, c) => n + c.function.arguments.length, 0);
              if (argsChars >= 120) {
                lastCallProgress = now;
                const names = [...pending.values()].map((c) => c.function.name).filter(Boolean);
                yield { type: 'tool_progress', name: names.join(' + ') || 'tool call', argsChars };
              }
            }
          }
        } catch {
          // ignore keep-alive / partial frames
        }
      }
    }

    const cut = finishReason === 'length';
    const abandoned = !sawFinish && !sawDone;
    if (pending.size > 0) {
      const toolCalls = [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);
      // Either way the arguments are incomplete: flag them so the executor can
      // name the real cause instead of a parse error, and the model can re-issue
      // in smaller pieces instead of burning the turn on the same oversized call.
      if (cut || abandoned) {
        for (const call of toolCalls) {
          call.truncated = true;
          call.truncatedReason = cut ? 'ceiling' : 'stream';
        }
      }
      yield { type: 'tool_calls', toolCalls };
    } else if (cut) {
      // Text-only reply that hit the ceiling: say it out loud rather than let a
      // half-written answer read as finished.
      yield {
        type: 'text',
        text: "\n\n[output cut off at the provider's token ceiling — the reply above is incomplete]",
      };
    } else if (abandoned && streamedAny) {
      yield {
        type: 'text',
        text: '\n\n[connection cut mid-reply — the text above is incomplete; re-run if it matters]',
      };
    }
  } finally {
    clearTimeout(idleTimer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

/** Text-only streaming — the classic path used by Telegram/Discord/MCP. */
export async function* streamReply(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncGenerator<string> {
  for await (const step of streamSteps(messages, undefined, opts)) {
    if (step.type === 'text') yield step.text;
  }
}

export async function completeReply(messages: ChatMessage[]): Promise<string> {
  let full = '';
  for await (const delta of streamReply(messages)) full += delta;
  return full;
}

// ---------------------------------------------------------------------------
// Mock brain: deterministic, codex-flavored stand-in used when no API key is
// configured. Never pretends to be the live model — replies are tagged.
// ---------------------------------------------------------------------------

async function* mockStream(messages: ChatMessage[]): AsyncGenerator<StreamStep> {
  // The mock brain never pretends: its "thought stream" says exactly what it is.
  const thoughts = [
    'mock brain — no API key, so this thought stream is canned.\n',
    'a live key (setup ⚙) streams the real reasoning here, token by token.\n',
    'classifying the request and picking a working order…\n',
  ];
  for (const line of thoughts) {
    yield { type: 'reasoning', text: line };
    await new Promise((resolve) => setTimeout(resolve, 90));
  }
  const text = mockReply(messages);
  const chunk = 6;
  for (let i = 0; i < text.length; i += chunk) {
    yield { type: 'text', text: text.slice(i, i + chunk) };
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

function mockReply(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content.trim() ?? '';
  const lower = lastUser.toLowerCase();
  const task = lastUser.length > 140 ? `${lastUser.slice(0, 137)}…` : lastUser;

  let steps: string[];
  if (/triage|fail|broke|broken|error|incident|down|outage/.test(lower)) {
    steps = [
      'Pin the failure: exact time, single repro, first bad state.',
      'Isolate: bisect the change set — disable half, test, keep the half that still breaks.',
      'Root-cause in one line, then stop the bleeding with the smallest safe patch.',
      'Write the receipt: what broke, why, what changed, how it is watched now.',
    ];
  } else if (/harden|secure|lock|protect|permission|access/.test(lower)) {
    steps = [
      'Enumerate the surface: who can touch what, and with what credential.',
      'Close the widest hole first — an unauthenticated path beats a theoretical one.',
      'Fail closed: missing data means deny, not allow.',
      'Log the before/after permission table as the receipt.',
    ];
  } else if (/cleanup|clean up|tidy|debt|refactor|organize/.test(lower)) {
    steps = [
      'Inventory the mess in place — no reorganizing in your head.',
      'Fix the one mess that touches the most downstream work first.',
      'Delete dead weight only after a clean run proves it dead.',
      'Receipt: what moved, what died, what survived.',
    ];
  } else {
    steps = [
      'Define done in one sentence — that is the acceptance test.',
      'Slice the work into the smallest steps that each leave the repo working.',
      'Execute in order; log a receipt per step (what changed, how it was verified).',
      'Close with the one risk you could not remove.',
    ];
  }

  return [
    `Blunt version first: "${task || 'no task in the message'}".`,
    '',
    'Working order:',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    config.defaultTokenId > 0 ? `— #${config.defaultTokenId}` : '— agent',
  ].join('\n');
}
