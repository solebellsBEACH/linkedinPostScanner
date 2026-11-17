import { AppError } from './errors';
import {
  DEFAULT_MODEL,
  PROVIDER_INFO,
  type CallOptions,
  type ChatMessage,
  type Provider,
} from './providers';

type Built = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  stream: 'sse' | 'ndjson' | 'none';
};

const ANTHROPIC_VERSION = '2023-06-01';

function build(
  provider: Provider,
  model: string,
  apiKey: string | undefined,
  system: string | undefined,
  messages: ChatMessage[],
  maxTokens: number,
  stream: boolean,
): Built {
  const key = apiKey ?? '';
  const chat = messages.filter((m) => m.role !== 'system');

  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: { model, max_tokens: maxTokens, system, messages: chat, stream },
        stream: stream ? 'sse' : 'none',
      };

    case 'openai':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: {
          model,
          max_tokens: maxTokens,
          messages: system ? [{ role: 'system', content: system }, ...chat] : chat,
          stream,
        },
        stream: stream ? 'sse' : 'none',
      };

    case 'groq':
      return {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: {
          model,
          max_tokens: maxTokens,
          messages: system ? [{ role: 'system', content: system }, ...chat] : chat,
          stream,
        },
        stream: stream ? 'sse' : 'none',
      };

    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        headers: { 'content-type': 'application/json' },
        body: {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: maxTokens },
        },
        stream: 'none',
      };

    case 'ollama':
      return {
        url: 'http://localhost:11434/api/chat',
        headers: { 'content-type': 'application/json' },
        body: {
          model,
          messages: system ? [{ role: 'system', content: system }, ...chat] : chat,
          stream,
          options: { num_predict: maxTokens },
        },
        stream: stream ? 'ndjson' : 'none',
      };
  }
}

function mapHttpError(status: number, detail: string): AppError {
  if (status === 401 || status === 403) return new AppError('AI_401', detail);
  if (status === 429) return new AppError('AI_429', detail);
  if (status === 404) return new AppError('AI_BAD_OUTPUT', `modelo não encontrado: ${detail}`);
  return new AppError('AI_BAD_OUTPUT', `HTTP ${status}: ${detail}`);
}

function mapFetchError(err: unknown, provider: Provider): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') return new AppError('AI_TIMEOUT');
  if (err instanceof Error && /abort/i.test(err.message)) return new AppError('AI_TIMEOUT');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new AppError('NETWORK_OFFLINE', err instanceof Error ? err.message : undefined);
  }
  if (provider === 'ollama') {
    return new AppError('AI_LOCAL_OFFLINE', err instanceof Error ? err.message : undefined);
  }
  return new AppError('NETWORK_OFFLINE', err instanceof Error ? err.message : undefined);
}

function textFromJson(provider: Provider, json: unknown): string {
  const data = json as Record<string, unknown>;

  switch (provider) {
    case 'anthropic': {
      const blocks = (data['content'] ?? []) as { type?: string; text?: string }[];
      return blocks.map((b) => b.text ?? '').join('');
    }
    case 'openai':
    case 'groq': {
      const choices = (data['choices'] ?? []) as { message?: { content?: string } }[];
      return choices[0]?.message?.content ?? '';
    }
    case 'gemini': {
      const candidates = (data['candidates'] ?? []) as {
        content?: { parts?: { text?: string }[] };
      }[];
      const parts = candidates[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('');
    }
    case 'ollama': {
      const message = data['message'] as { content?: string } | undefined;
      return message?.content ?? '';
    }
  }
}

function deltaFromSse(provider: Provider, payload: string): string {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return '';
  }

  if (provider === 'anthropic') {
    if (json['type'] !== 'content_block_delta') return '';
    const delta = json['delta'] as { text?: string } | undefined;
    return delta?.text ?? '';
  }

  const choices = (json['choices'] ?? []) as { delta?: { content?: string } }[];
  return choices[0]?.delta?.content ?? '';
}

type StreamSink = (piece: string) => void;

function parseSseBlock(block: string, provider: Provider): string {
  let out = '';
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    out += deltaFromSse(provider, payload);
  }
  return out;
}

function parseNdjsonLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  try {
    const json = JSON.parse(trimmed) as { message?: { content?: string } };
    return json.message?.content ?? '';
  } catch {
    return '';
  }
}

/** Lê o corpo incrementalmente: SSE ou NDJSON. */
async function readStream(
  response: Response,
  provider: Provider,
  format: 'sse' | 'ndjson',
  sink: StreamSink | undefined,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('AI_BAD_OUTPUT', 'resposta sem corpo');

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const push = (piece: string): void => {
    if (!piece) return;
    full += piece;
    sink?.(piece);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    if (format === 'sse') {
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        push(parseSseBlock(buffer.slice(0, index), provider));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\n\n');
      }
    } else {
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        push(parseNdjsonLine(buffer.slice(0, index)));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    }
  }

  if (buffer.trim().length > 0) {
    push(format === 'sse' ? parseSseBlock(buffer, provider) : parseNdjsonLine(buffer));
  }

  return full;
}

/** Chamada única de chat. Streaming opcional via `onToken`. */
export async function callAI(options: CallOptions): Promise<string> {
  const info = PROVIDER_INFO[options.provider];
  if (info.needsKey && !options.apiKey) throw new AppError('AI_NO_KEY');

  const model = options.model || DEFAULT_MODEL[options.provider];
  const wantsStream = typeof options.onToken === 'function' && options.provider !== 'gemini';
  const built = build(
    options.provider,
    model,
    options.apiKey,
    options.system,
    options.messages,
    options.maxTokens ?? 2048,
    wantsStream,
  );

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const response = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw mapHttpError(response.status, detail);
    }

    if (built.stream === 'none') {
      const json: unknown = await response.json();
      return textFromJson(options.provider, json);
    }

    if (built.stream === 'sse') {
      return await readStream(response, options.provider, 'sse', options.onToken);
    }

    return await readStream(response, options.provider, 'ndjson', options.onToken);
  } catch (err) {
    throw mapFetchError(err, options.provider);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

/**
 * Chamada com saída estruturada: exige JSON, valida e tenta 1 vez de novo.
 * Qualquer falha de contrato vira AI_BAD_OUTPUT.
 */
export async function structured<T>(
  options: CallOptions,
  validate: (value: unknown) => T | null,
): Promise<T> {
  const run = async (retry: boolean): Promise<T> => {
    const text = await callAI(options);
    const json = extractJson(text);
    if (json) {
      try {
        const parsed: unknown = JSON.parse(json);
        const valid = validate(parsed);
        if (valid !== null) return valid;
      } catch {
        // cai no retry
      }
    }
    if (retry) {
      const retryOptions: CallOptions = {
        ...options,
        messages: [
          ...options.messages,
          { role: 'assistant', content: text.slice(0, 4000) },
          { role: 'user', content: 'Responda novamente APENAS com JSON válido, sem texto antes ou depois.' },
        ],
        onToken: undefined,
      };
      return run(false);
    }
    throw new AppError('AI_BAD_OUTPUT', 'resposta não é JSON válido segundo o contrato');
  };

  return run(true);
}

/** Testa a chave com uma chamada mínima. Devolve a latência em ms. */
export async function testKey(provider: Provider, model: string, apiKey?: string): Promise<number> {
  const started = performance.now();
  await callAI({
    provider,
    model: model || DEFAULT_MODEL[provider],
    apiKey,
    messages: [{ role: 'user', content: 'Responda apenas: ok' }],
    maxTokens: 4,
    timeoutMs: 20_000,
  });
  return Math.round(performance.now() - started);
}
