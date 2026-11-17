import type { Settings } from './types';

export type Provider = Settings['provider'];

export type ProviderInfo = {
  id: Provider;
  label: string;
  defaultModel: string;
  models: readonly string[];
  needsKey: boolean;
  hint: string;
};

export const PROVIDER_ORDER: readonly Provider[] = ['anthropic', 'openai', 'gemini', 'groq', 'ollama'];

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    needsKey: true,
    hint: 'console.anthropic.com → API Keys',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini'],
    needsKey: true,
    hint: 'platform.openai.com → API Keys',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    needsKey: true,
    hint: 'aistudio.google.com → Get API key',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    needsKey: true,
    hint: 'console.groq.com → API Keys',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5', 'mistral'],
    needsKey: false,
    hint: 'ollama serve · http://localhost:11434',
  },
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type CallOptions = {
  provider: Provider;
  model: string;
  apiKey?: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (chunk: string) => void;
  timeoutMs?: number;
};

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: PROVIDER_INFO.anthropic.defaultModel,
  openai: PROVIDER_INFO.openai.defaultModel,
  gemini: PROVIDER_INFO.gemini.defaultModel,
  groq: PROVIDER_INFO.groq.defaultModel,
  ollama: PROVIDER_INFO.ollama.defaultModel,
};
