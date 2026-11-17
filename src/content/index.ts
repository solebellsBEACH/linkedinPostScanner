import {
  CONTENT_PORT,
  type ContentCommand,
  type ContentMessage,
} from '../shared/messaging';
import { readProfile } from './profile';
import { getState, startScroll, stopScroll, type ScrollEvent } from './scroll';

// ---------------------------------------------------------------- porta com o SW

let port: chrome.runtime.Port | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const queue: ContentMessage[] = [];

function flush(): void {
  if (!port) return;
  while (queue.length > 0) {
    const msg = queue.shift();
    if (!msg) break;
    try {
      port.postMessage(msg);
    } catch {
      if (msg) queue.unshift(msg);
      break;
    }
  }
}

function send(message: ContentMessage): void {
  if (port) {
    try {
      port.postMessage(message);
      return;
    } catch {
      port = null;
    }
  }
  queue.push(message);
  if (queue.length > 500) queue.shift();
}

function connect(): void {
  if (port) return;
  try {
    port = chrome.runtime.connect({ name: CONTENT_PORT });
  } catch (err) {
    console.warn('[PR] não consegui conectar ao service worker', err);
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener((message: ContentCommand) => {
    if (message.type === 'START') {
      startScroll(handle, message.limits);
    } else if (message.type === 'STOP') {
      stopScroll('manual');
    }
  });

  port.onDisconnect.addListener(() => {
    // Normal em MV3: o SW dorme quando fica ocioso. O loop continua neste script.
    port = null;
    scheduleReconnect();
  });

  send({ type: 'HELLO', path: location.pathname });
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
    flush();
  }, 1000);
}

connect();

// ---------------------------------------------------------------- eventos do loop

const debugEnabled = new URLSearchParams(location.search).get('prDebug') === '1';
let overlay: HTMLElement | null = null;

function debugLine(): string {
  const s = getState();
  const hidden = document.visibilityState === 'hidden' ? ' · oculta' : '';
  return `rodada ${s.round} · posts ${s.posts} · scrollHeight ${s.scrollHeight} · semProgresso ${s.noProgress} · ${s.strategy}${hidden}`;
}

function paintDebug(): void {
  if (!debugEnabled) return;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pr-debug';
    overlay.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'padding:8px 10px',
      'border-radius:8px',
      'background:rgba(17,24,39,.92)',
      'color:#f9fafb',
      'font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
      'pointer-events:none',
      'max-width:320px',
      'white-space:pre-wrap',
    ].join(';');
    document.body.appendChild(overlay);
  }
  overlay.textContent = debugLine();
}

function handle(event: ScrollEvent): void {
  switch (event.type) {
    case 'round':
      send({
        type: 'ROUND',
        round: event.round,
        posts: event.posts,
        scrollHeight: event.scrollHeight,
        noProgress: event.noProgress,
        strategy: event.strategy,
      });
      if (event.round % 5 === 0)
        console.log('[PR] round', event.round, 'posts', event.posts, 'sh', event.scrollHeight, 'noProg', event.noProgress);
      paintDebug();
      break;
    case 'posts':
      send({ type: 'POST_BATCH', posts: event.posts, unrecognized: event.unrecognized });
      console.log('[PR] posts +', event.posts.length, 'total', event.total);
      paintDebug();
      break;
    case 'stop':
      send({ type: 'STOPPED', reason: event.reason });
      console.log('[PR] scroll parado:', event.reason);
      paintDebug();
      break;
    case 'error':
      send({ type: 'FAILED', code: event.code, detail: event.detail });
      console.warn('[PR] erro', event.code, event.detail ?? '');
      break;
  }
}

// ---------------------------------------------------------------- gatilhos

console.log('[PR] content ready', location.pathname);

document.addEventListener('pr:start', () => startScroll(handle));
document.addEventListener('pr:stop', () => stopScroll('manual'));

if (debugEnabled) {
  paintDebug();
  setTimeout(() => startScroll(handle), 3000);
}

// ---------------------------------------------------------------- perfil

function captureProfile(attempt = 0): void {
  const profile = readProfile();
  if (profile) {
    send({ type: 'PROFILE', profile });
    console.log('[PR] perfil lido', profile.name, profile.skills.length, 'skills');
    return;
  }
  // O nome/topcard às vezes hidrata depois do DOMContentLoaded; tenta de novo.
  if (attempt < 5) {
    setTimeout(() => captureProfile(attempt + 1), 2000);
    return;
  }
  console.warn('[PR] perfil não identificado nesta página');
}

if (location.pathname.startsWith('/in/')) setTimeout(() => captureProfile(), 1500);

// LinkedIn é SPA: abrir /in/<slug>/ sem recarregar não dispara o content script de novo.
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  if (lastPath.startsWith('/in/')) setTimeout(() => captureProfile(), 1500);
}, 1500);
