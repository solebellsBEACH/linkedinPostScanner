import type { Settings } from './types';

export type Provider = Settings['provider'];
export type Theme = Settings['theme'];

export const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'gemini', 'groq', 'ollama'];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  maxRounds: 200,
  maxMinutes: 25,
  delayMinMs: 900,
  delayMaxMs: 2600,
};

/** Chaves usadas em chrome.storage.local. */
const K = {
  settings: 'settings',
  aiKeys: 'aiKeys',
  schemaVersion: 'schemaVersion',
} as const;

type AiKeys = Partial<Record<Provider, string>>;

type StorageShape = {
  [K.settings]: Partial<Settings>;
  [K.aiKeys]: AiKeys;
  [K.schemaVersion]: number;
};

async function read<Key extends keyof StorageShape>(key: Key): Promise<StorageShape[Key] | undefined> {
  const got: Record<string, unknown> = await chrome.storage.local.get(key);
  return got[key] as StorageShape[Key] | undefined;
}

async function write<Key extends keyof StorageShape>(key: Key, value: StorageShape[Key]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- settings

export async function getSettings(): Promise<Settings> {
  const stored = await read(K.settings);
  return isObject(stored) ? { ...DEFAULT_SETTINGS, ...stored } : { ...DEFAULT_SETTINGS };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next: Settings = { ...(await getSettings()), ...patch };
  await write(K.settings, next);
  return next;
}

export async function getTheme(): Promise<Theme> {
  return (await getSettings()).theme;
}

export async function setTheme(theme: Theme): Promise<void> {
  await setSettings({ theme });
}

// ---------------------------------------------------------------- chaves de IA
// Nunca logar o valor de uma chave.

async function readKeys(): Promise<AiKeys> {
  const stored = await read(K.aiKeys);
  return isObject(stored) ? stored : {};
}

export async function getApiKey(provider: Provider): Promise<string | undefined> {
  const key = (await readKeys())[provider];
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/** String vazia (ou só espaços) remove a chave do provedor. */
export async function setApiKey(provider: Provider, key: string): Promise<void> {
  const keys = await readKeys();
  const trimmed = key.trim();
  if (trimmed === '') delete keys[provider];
  else keys[provider] = trimmed;
  await write(K.aiKeys, keys);
}

/** Provedores com chave salva. Ollama não exige chave, então sempre conta. */
export async function listConfiguredProviders(): Promise<Provider[]> {
  const keys = await readKeys();
  return PROVIDERS.filter((p) => p === 'ollama' || (typeof keys[p] === 'string' && keys[p] !== ''));
}

// ---------------------------------------------------------------- schema

export async function getSchemaVersion(): Promise<number | undefined> {
  const v = await read(K.schemaVersion);
  return typeof v === 'number' ? v : undefined;
}

export async function setSchemaVersion(version: number): Promise<void> {
  await write(K.schemaVersion, version);
}
