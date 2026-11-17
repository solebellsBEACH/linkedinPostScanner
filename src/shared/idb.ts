import type { Analysis, HistoryEntry, Job, Post, Profile } from './types';
import { AppError } from './errors';

export const DB_NAME = 'post-scanner';
export const DB_VERSION = 1;

const PROFILE_ID = 'me';

type StoredProfile = Profile & { id: typeof PROFILE_ID };

/** Mapa store → tipo do registro. Garante tipagem de ponta a ponta. */
type StoreMap = {
  posts: Post;
  analyses: Analysis;
  jobs: Job;
  history: HistoryEntry;
  profile: StoredProfile;
};

type StoreName = keyof StoreMap;

const STORE_NAMES: readonly StoreName[] = ['posts', 'analyses', 'jobs', 'history', 'profile'];

// ---------------------------------------------------------------- primitivas

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(mapError(req.error));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(mapError(tx.error));
    tx.onabort = () => reject(mapError(tx.error));
  });
}

function mapError(err: DOMException | null): Error {
  if (err?.name === 'QuotaExceededError') return new AppError('STORAGE_FULL', err.message);
  return err ?? new Error('[PR] IndexedDB: erro desconhecido');
}

function upgrade(db: IDBDatabase): void {
  const has = (n: StoreName): boolean => db.objectStoreNames.contains(n);

  if (!has('posts')) {
    db.createObjectStore('posts', { keyPath: 'activityId' }).createIndex('collectedAt', 'collectedAt');
  }
  if (!has('analyses')) {
    db.createObjectStore('analyses', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
  }
  if (!has('jobs')) {
    db.createObjectStore('jobs', { keyPath: 'id' }).createIndex('sourceActivityId', 'sourceActivityId');
  }
  if (!has('history')) {
    db.createObjectStore('history', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
  }
  if (!has('profile')) {
    db.createObjectStore('profile', { keyPath: 'id' });
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Abre (e cria/atualiza) o banco. Conexão é reaproveitada por contexto. */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      const db = req.result;
      // Outra aba subiu a versão: fecha para não bloquear, reabre no próximo uso.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(mapError(req.error));
    };
    req.onblocked = () => console.warn('[PR] openDb bloqueado por outra conexão aberta');
  });

  return dbPromise;
}

async function store<S extends StoreName>(
  name: S,
  mode: IDBTransactionMode,
): Promise<{ tx: IDBTransaction; os: IDBObjectStore }> {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  return { tx, os: tx.objectStore(name) };
}

async function putMany<S extends StoreName>(name: S, values: readonly StoreMap[S][]): Promise<void> {
  if (values.length === 0) return;
  const { tx, os } = await store(name, 'readwrite');
  for (const v of values) os.put(v);
  await txDone(tx);
}

async function getOne<S extends StoreName>(name: S, key: IDBValidKey): Promise<StoreMap[S] | undefined> {
  const { os } = await store(name, 'readonly');
  return reqToPromise(os.get(key) as IDBRequest<StoreMap[S] | undefined>);
}

/** Percorre um índice em ordem decrescente (mais recente primeiro). */
async function listByIndexDesc<S extends StoreName>(
  name: S,
  index: string,
  limit: number,
): Promise<StoreMap[S][]> {
  const { tx, os } = await store(name, 'readonly');
  const out: StoreMap[S][] = [];
  const req = os.index(index).openCursor(null, 'prev');
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur || out.length >= limit) return;
    out.push(cur.value as StoreMap[S]);
    cur.continue();
  };
  req.onerror = () => tx.abort();
  await txDone(tx);
  return out;
}

// ---------------------------------------------------------------- posts

export function putPost(post: Post): Promise<void> {
  return putMany('posts', [post]);
}

export function putPosts(posts: readonly Post[]): Promise<void> {
  return putMany('posts', posts);
}

export function getPost(activityId: string): Promise<Post | undefined> {
  return getOne('posts', activityId);
}

export async function countPosts(): Promise<number> {
  const { os } = await store('posts', 'readonly');
  return reqToPromise(os.count());
}

/** Posts com `collectedAt >= since`, em ordem crescente de coleta. */
export async function getPostsSince(since: number): Promise<Post[]> {
  const { os } = await store('posts', 'readonly');
  const req = os.index('collectedAt').getAll(IDBKeyRange.lowerBound(since)) as IDBRequest<Post[]>;
  return reqToPromise(req);
}

/** Remove posts com `collectedAt < before`. Devolve quantos foram removidos. */
export async function deletePostsBefore(before: number): Promise<number> {
  const { tx, os } = await store('posts', 'readwrite');
  let removed = 0;
  const req = os.index('collectedAt').openCursor(IDBKeyRange.upperBound(before, true));
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return;
    cur.delete();
    removed++;
    cur.continue();
  };
  req.onerror = () => tx.abort();
  await txDone(tx);
  return removed;
}

// ---------------------------------------------------------------- analyses

export function putAnalysis(analysis: Analysis): Promise<void> {
  return putMany('analyses', [analysis]);
}

export function getAnalysis(id: string): Promise<Analysis | undefined> {
  return getOne('analyses', id);
}

/** Remove uma análise corrompida ou indesejada. */
export async function deleteAnalysis(id: string): Promise<void> {
  const { tx, os } = await store('analyses', 'readwrite');
  os.delete(id);
  await txDone(tx);
}

/** Análises mais recentes primeiro. */
export function listAnalyses(limit = Number.POSITIVE_INFINITY): Promise<Analysis[]> {
  return listByIndexDesc('analyses', 'createdAt', limit);
}

// ---------------------------------------------------------------- jobs

export function putJobs(jobs: readonly Job[]): Promise<void> {
  return putMany('jobs', jobs);
}

/**
 * A tela Vagas representa a última análise de resumo. Sem trocar o conjunto
 * inteiro, cada nova análise some com as antigas e a lista duplica.
 */
export async function replaceJobs(jobs: readonly Job[]): Promise<void> {
  const { os, tx } = await store('jobs', 'readwrite');
  os.clear();
  for (const job of jobs) os.put(job);
  await txDone(tx);
}

/** Todas as vagas, ou só as extraídas de um post específico. */
export async function listJobs(sourceActivityId?: string): Promise<Job[]> {
  const { os } = await store('jobs', 'readonly');
  const req =
    sourceActivityId === undefined
      ? (os.getAll() as IDBRequest<Job[]>)
      : (os.index('sourceActivityId').getAll(sourceActivityId) as IDBRequest<Job[]>);
  return reqToPromise(req);
}

// ---------------------------------------------------------------- history

export function putHistory(entry: HistoryEntry): Promise<void> {
  return putMany('history', [entry]);
}

/** Histórico mais recente primeiro. */
export function listHistory(limit = Number.POSITIVE_INFINITY): Promise<HistoryEntry[]> {
  return listByIndexDesc('history', 'createdAt', limit);
}

// ---------------------------------------------------------------- profile

export function putProfile(profile: Profile): Promise<void> {
  return putMany('profile', [{ ...profile, id: PROFILE_ID }]);
}

export async function getProfile(): Promise<Profile | undefined> {
  const stored = await getOne('profile', PROFILE_ID);
  if (!stored) return undefined;
  const { id: _id, ...profile } = stored;
  return profile;
}

// ---------------------------------------------------------------- manutenção

/**
 * Esvazia os stores de dados. Por padrão preserva `profile`
 * (SPEC §10: limpar histórico preserva settings e perfil).
 */
export async function clearAll(opts: { includeProfile?: boolean } = {}): Promise<void> {
  const names = STORE_NAMES.filter((n) => opts.includeProfile === true || n !== 'profile');
  const db = await openDb();
  const tx = db.transaction(names, 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  await txDone(tx);
}

export type StorageUsage = { usage: number; quota: number };

export async function estimateUsage(): Promise<StorageUsage> {
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch (err) {
    console.warn('[PR] navigator.storage.estimate falhou', err);
    return { usage: 0, quota: 0 };
  }
}
