import type { Post } from '../shared/types';
import type { ErrorCode } from '../shared/errors';
import { extractPosts, visibleActivityIds } from './extract';

export type StopReason =
  | 'end-marker'
  | 'stalled'
  | 'max-rounds'
  | 'max-time'
  | 'route-change'
  | 'manual'
  | 'not-feed'
  | 'auth'
  | 'rate-limit';

export type ScrollEvent =
  | {
      type: 'round';
      round: number;
      posts: number;
      scrollHeight: number;
      noProgress: number;
      strategy: string;
    }
  | { type: 'posts'; posts: Post[]; unrecognized: number; total: number }
  | { type: 'stop'; reason: StopReason }
  | { type: 'error'; code: ErrorCode; detail?: string };

type Snapshot = {
  running: boolean;
  round: number;
  posts: number;
  scrollHeight: number;
  noProgress: number;
  strategy: string;
};

const END_MARKERS = [
  'are these results helpful',
  'do you find this post valuable',
  'voce acha estas publicacoes uteis',
  'voce acha esta publicacao util',
  'about accessibility',
];

const PAGINATION_TEXTS = [
  'show more results',
  'ver mais resultados',
  'mostrar mais resultados',
  'load more',
  'carregar mais',
  'show more posts',
  'ver mais publicacoes',
  'ver mais publicações',
];

const AUTHWALL_PATH = /authwall|checkpoint|uas\/login|\/login/;
const RATE_LIMIT_TEXT = /(limite|limit|muitas solicita|too many requests|rate)/i;

const MAX_ROUNDS = 400;
const MAX_MINUTES = 25;
const STALL_ROUNDS = 10;
const END_ROUNDS = 6;
const MAX_DELAY_MS = 2600;
const MIN_DELAY_MS = 900;

let running = false;
let onEvent: ((event: ScrollEvent) => void) | null = null;
let startPath = '';
let startedAt = 0;
let loopToken = 0;

const seen = new Set<string>();

const state: Snapshot = {
  running: false,
  round: 0,
  posts: 0,
  scrollHeight: 0,
  noProgress: 0,
  strategy: 'none',
};

// ------------------------------------------------------------------ utilidades

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(event: ScrollEvent): void {
  try {
    onEvent?.(event);
  } catch (err) {
    console.warn('[PR] handler de evento falhou', err);
  }
}

function rand(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isScrollable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const overflow = getComputedStyle(el).overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  return el.scrollHeight > el.clientHeight + 100;
}

/** docs/SPEC.md §3.1 */
export function findScrollRoot(): { el: HTMLElement; strategy: string } {
  const workspace = document.getElementById('workspace');
  if (workspace instanceof HTMLElement && workspace.scrollHeight > workspace.clientHeight + 100) {
    return { el: workspace, strategy: 'workspace' };
  }

  const anchors = ['[data-testid="mainFeed"]', '[data-testid="lazy-column"]'];
  for (const selector of anchors) {
    const node = document.querySelector(selector);
    if (!node) continue;
    let parent: Element | null = node.parentElement;
    for (let depth = 0; depth < 10 && parent; depth += 1) {
      if (isScrollable(parent)) {
        return { el: parent, strategy: `${selector}-ancestor` };
      }
      parent = parent.parentElement;
    }
  }

  const scrolling = document.scrollingElement;
  if (scrolling instanceof HTMLElement && scrolling.scrollHeight > scrolling.clientHeight + 100) {
    return { el: scrolling, strategy: 'scrollingElement' };
  }

  return { el: document.documentElement, strategy: 'documentElement' };
}

export function isPaginationButton(el: Element): boolean {
  if (
    el.closest(
      '[data-virtualized-item],[data-lazy-mount-id],[role="dialog"],.vjs-*,[data-testid="dialog-content"],[data-testid="expandable-text-button"]',
    )
  ) {
    return false;
  }
  const text = normalizeText(el.textContent ?? '').trim();
  if (!text) return false;
  return PAGINATION_TEXTS.includes(text) || text.startsWith('show more results') || text.startsWith('ver mais resultados');
}

function findPaginationButton(): HTMLElement | null {
  const explicit = document.querySelector<HTMLElement>('[data-testid="load-more"]');
  if (explicit && !explicit.closest('[data-virtualized-item]')) return explicit;

  const candidates = document.querySelectorAll<HTMLElement>('button,a[role="button"]');
  for (const candidate of candidates) {
    if (!isPaginationButton(candidate)) continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return candidate;
  }
  return null;
}

function hasEndMarker(root: HTMLElement): boolean {
  const text = normalizeText(root.textContent ?? '');
  return END_MARKERS.some((marker) => text.includes(marker));
}

function findRateLimitToast(): string | null {
  const toasts = document.querySelectorAll('[data-testid="toasts-title"], [role="alert"]');
  for (const toast of toasts) {
    const text = toast.textContent ?? '';
    if (RATE_LIMIT_TEXT.test(normalizeText(text))) return text.trim();
  }
  return null;
}

async function waitForIdle(maxMs = 5000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const busy = document.querySelector('[aria-busy="true"], [role="progressbar"]');
    if (!busy) return;
    await sleep(250);
  }
}

async function waitWhileHidden(token: number): Promise<void> {
  while (document.hidden && running && token === loopToken) {
    await sleep(500);
  }
}

function lastVirtualizedItem(root: HTMLElement): HTMLElement | null {
  const items = root.querySelectorAll<HTMLElement>('[data-virtualized-item],[data-lazy-mount-id]');
  return items.length > 0 ? (items[items.length - 1] ?? null) : null;
}

// ------------------------------------------------------------------ módulo

export function getState(): Snapshot {
  return { ...state };
}

export function stopScroll(reason: StopReason = 'manual'): void {
  if (!running) return;
  running = false;
  state.running = false;
  loopToken += 1;
  emit({ type: 'stop', reason });
}

export function startScroll(handler: (event: ScrollEvent) => void): void {
  if (running) {
    console.warn('[PR] startScroll ignorado: já existe um loop rodando');
    return;
  }

  const path = location.pathname;
  if (!path.startsWith('/feed/') && !path.startsWith('/search/results/content')) {
    handler({ type: 'error', code: 'SCROLL_NOT_FEED', detail: path });
    return;
  }

  onEvent = handler;
  running = true;
  loopToken += 1;
  startPath = path;
  startedAt = Date.now();

  state.running = true;
  state.round = 0;
  state.noProgress = 0;
  state.posts = seen.size;

  const { el: root, strategy } = findScrollRoot();
  state.strategy = strategy;
  state.scrollHeight = root.scrollHeight;
  console.log('[PR] scroll root', strategy, root.scrollHeight, root.clientHeight);

  void runLoop(root, loopToken);
}

async function runLoop(root: HTMLElement, token: number): Promise<void> {
  let textLen = (root.textContent ?? '').length;
  let nextLongPause = rand(10, 18);

  try {
    while (running && token === loopToken) {
      await waitWhileHidden(token);
      if (!running || token !== loopToken) break;

      if (AUTHWALL_PATH.test(location.pathname)) {
        emit({ type: 'stop', reason: 'auth' });
        break;
      }
      if (location.pathname !== startPath) {
        emit({ type: 'stop', reason: 'route-change' });
        break;
      }
      if (state.round >= MAX_ROUNDS) {
        emit({ type: 'stop', reason: 'max-rounds' });
        break;
      }
      if (Date.now() - startedAt > MAX_MINUTES * 60_000) {
        emit({ type: 'stop', reason: 'max-time' });
        break;
      }

      state.round += 1;

      // 1. rola de verdade (três vias)
      root.scrollBy({ top: Math.round(root.clientHeight * 0.85), behavior: 'instant' });
      root.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: Math.round(root.clientHeight * 0.8),
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );

      // 2. sentinela a cada 3 rodadas
      if (state.round % 3 === 0) {
        lastVirtualizedItem(root)?.scrollIntoView({ block: 'end' });
      }
      // 3. micro-scroll para cima a cada 7 rodadas (força o virtualizador a remontar)
      if (state.round % 7 === 0) {
        root.scrollBy({ top: -Math.round(root.clientHeight * 0.25), behavior: 'instant' });
      }

      await waitForIdle();
      await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));

      // 4. extrai posts montados
      const { posts, unrecognized } = await extractPosts(root, seen);
      if (posts.length > 0) {
        state.posts = seen.size;
        emit({ type: 'posts', posts, unrecognized, total: state.posts });
      }

      // 5. mede progresso por três sinais independentes
      const scrollHeight = root.scrollHeight;
      const newTextLen = (root.textContent ?? '').length;
      const domIds = visibleActivityIds(root);
      let unseen = 0;
      for (const id of domIds) if (!seen.has(id)) unseen += 1;

      const progressed =
        scrollHeight !== state.scrollHeight || newTextLen !== textLen || unseen > 0 || posts.length > 0;

      state.scrollHeight = scrollHeight;
      textLen = newTextLen;
      state.noProgress = progressed ? 0 : state.noProgress + 1;

      emit({
        type: 'round',
        round: state.round,
        posts: state.posts,
        scrollHeight,
        noProgress: state.noProgress,
        strategy: state.strategy,
      });

      const toast = findRateLimitToast();
      if (toast) {
        emit({ type: 'error', code: 'SCROLL_STALLED', detail: toast });
        emit({ type: 'stop', reason: 'rate-limit' });
        break;
      }

      const endMarker = hasEndMarker(root);
      const pagination = findPaginationButton();
      if (pagination) {
        pagination.scrollIntoView({ block: 'center' });
        await sleep(rand(1500, 3000));
        state.noProgress = 0;
        continue;
      }

      if (state.noProgress >= END_ROUNDS && endMarker) {
        emit({ type: 'stop', reason: 'end-marker' });
        break;
      }
      if (state.noProgress >= STALL_ROUNDS) {
        emit({ type: 'stop', reason: 'stalled' });
        break;
      }

      // 6. pausa longa periódica
      if (state.round >= nextLongPause) {
        await sleep(rand(4000, 9000));
        nextLongPause = state.round + rand(10, 18);
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[PR] loop falhou', err);
    emit({ type: 'error', code: 'DOM_CHANGED', detail });
  } finally {
    running = false;
    state.running = false;
  }
}
