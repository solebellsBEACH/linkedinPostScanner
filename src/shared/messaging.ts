import type { Post } from './types';
import { AppError, type ErrorCode } from './errors';

export type ScrollStatus = 'idle' | 'running' | 'stopping' | 'done' | 'error';

export type ScrollState = {
  status: ScrollStatus;
  rounds: number;
  postCount: number;
  startedAt: number | null;
};

export type Message =
  | { type: 'START_SCROLL'; tabId?: number }
  | { type: 'STOP_SCROLL'; tabId?: number }
  | { type: 'POST_BATCH'; posts: Post[] }
  | { type: 'PROGRESS'; rounds: number; postCount: number; elapsedMs: number }
  | { type: 'STATE'; state: ScrollState }
  | { type: 'ERROR'; code: ErrorCode; detail?: string }
  | { type: 'GET_STATE'; tabId?: number };

export type MessageType = Message['type'];

export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/**
 * Comando pontual via chrome.runtime.sendMessage.
 * Sem resposta dentro de `timeoutMs` (ou sem receptor) → AppError('EXT_UNAVAILABLE').
 */
export function rpc<TReq extends Message, TRes>(req: TReq, timeoutMs = 8000): Promise<TRes> {
  return new Promise<TRes>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('EXT_UNAVAILABLE', `rpc ${req.type} sem resposta em ${timeoutMs}ms`));
    }, timeoutMs);

    chrome.runtime
      .sendMessage<TReq, TRes>(req)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const detail = err instanceof Error ? err.message : String(err);
        console.warn('[PR] rpc falhou', req.type, detail);
        reject(new AppError('EXT_UNAVAILABLE', detail));
      });
  });
}
