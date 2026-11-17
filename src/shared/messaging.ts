import type { Post } from './types';
import { AppError, type ErrorCode } from './errors';

/** Estado do loop de scroll de uma aba, compartilhado entre SW e side panel. */
export type ScrollStatus = 'idle' | 'running' | 'done' | 'error';

export type ScrollState = {
  status: ScrollStatus;
  rounds: number;
  postCount: number;
  unrecognized: number;
  startedAt: number | null;
  strategy?: string;
  stopReason?: string;
  error?: { code: ErrorCode; detail?: string };
};

export const IDLE_STATE: ScrollState = {
  status: 'idle',
  rounds: 0,
  postCount: 0,
  unrecognized: 0,
  startedAt: null,
};

// ------------------------------------------------------- side panel → service worker

export type PanelRequest =
  | { type: 'START_SCROLL'; tabId: number }
  | { type: 'STOP_SCROLL'; tabId: number }
  | { type: 'GET_STATE'; tabId: number };

export type PanelResponse =
  | { ok: true; state: ScrollState }
  | { ok: false; code: ErrorCode; detail?: string };

// ------------------------------------------------------- service worker → side panel (Port)

export type PanelPush =
  | { type: 'STATE'; state: ScrollState }
  | { type: 'ERROR'; code: ErrorCode; detail?: string };

export const PANEL_PORT = 'pr-panel';
export const CONTENT_PORT = 'pr-content';

// ------------------------------------------------------- content script → service worker (Port)

export type ContentMessage =
  | { type: 'HELLO'; path: string }
  | { type: 'ROUND'; round: number; posts: number; scrollHeight: number; noProgress: number; strategy: string }
  | { type: 'POST_BATCH'; posts: Post[]; unrecognized: number }
  | { type: 'STOPPED'; reason: string }
  | { type: 'FAILED'; code: ErrorCode; detail?: string };

/** Ordem enviada do service worker para o content script. */
export type ContentCommand = { type: 'START' } | { type: 'STOP' };

/**
 * Comando pontual via chrome.runtime.sendMessage.
 * Sem resposta dentro de `timeoutMs` (ou sem receptor) → AppError('EXT_UNAVAILABLE').
 */
export function rpc<TReq, TRes>(req: TReq, timeoutMs = 8000): Promise<TRes> {
  return new Promise<TRes>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('EXT_UNAVAILABLE', `rpc sem resposta em ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.runtime
      .sendMessage(req)
      .then((res: TRes) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const detail = err instanceof Error ? err.message : String(err);
        console.warn('[PR] rpc falhou', detail);
        reject(new AppError('EXT_UNAVAILABLE', detail));
      });
  });
}
