import { openDb, putPosts, putProfile } from './shared/idb';
import { getSchemaVersion, setSchemaVersion } from './shared/storage';
import {
  CONTENT_PORT,
  IDLE_STATE,
  PANEL_PORT,
  type ContentMessage,
  type PanelPush,
  type PanelRequest,
  type PanelResponse,
  type ScrollState,
} from './shared/messaging';

const SCHEMA_VERSION = 1;
const PANEL_PATH = 'sidepanel.html';
const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//;

// ------------------------------------------------------------------ estado por aba

const states = new Map<number, ScrollState>();
const contentPorts = new Map<number, chrome.runtime.Port>();
const panelPorts = new Set<chrome.runtime.Port>();

function stateOf(tabId: number): ScrollState {
  const current = states.get(tabId);
  return current ? { ...current } : { ...IDLE_STATE };
}

function pushToPanels(message: PanelPush): void {
  for (const port of panelPorts) {
    try {
      port.postMessage(message);
    } catch {
      panelPorts.delete(port);
    }
  }
}

function patchState(tabId: number, patch: Partial<ScrollState>): ScrollState {
  const next: ScrollState = { ...stateOf(tabId), ...patch };
  states.set(tabId, next);
  pushToPanels({ type: 'STATE', state: next });
  return next;
}

// ------------------------------------------------------------------ schema

async function ensureSchema(): Promise<void> {
  try {
    if ((await getSchemaVersion()) === SCHEMA_VERSION) return;
    await openDb();
    await setSchemaVersion(SCHEMA_VERSION);
    console.log('[PR] schema v1 pronto');
  } catch (err) {
    console.warn('[PR] ensureSchema falhou', err);
  }
}

void ensureSchema();

// ------------------------------------------------------------------ side panel por aba

async function syncPanel(tabId: number, url: string | undefined): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: LINKEDIN.test(url ?? '') });
  } catch (err) {
    console.warn('[PR] syncPanel falhou', tabId, err);
  }
}

async function enableOnActionClick(): Promise<void> {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn('[PR] setPanelBehavior falhou (Chrome < 114?)', err);
  }
}

void enableOnActionClick();

// ------------------------------------------------------------------ portas

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PANEL_PORT) {
    panelPorts.add(port);
    port.onDisconnect.addListener(() => panelPorts.delete(port));
    return;
  }

  if (port.name !== CONTENT_PORT) return;

  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) {
    port.disconnect();
    return;
  }

  contentPorts.set(tabId, port);

  port.onDisconnect.addListener(() => {
    if (contentPorts.get(tabId) === port) contentPorts.delete(tabId);
  });

  port.onMessage.addListener((message: ContentMessage) => {
    void handleContent(tabId, port, message);
  });
});

async function handleContent(tabId: number, port: chrome.runtime.Port, message: ContentMessage): Promise<void> {
  switch (message.type) {
    case 'HELLO': {
      // Nada a fazer: se o SW reiniciou, o próximo ROUND re-registra o estado.
      // Nunca reiniciar o scroll sem o usuário pedir.
      console.log('[PR] content conectado', message.path);
      break;
    }
    case 'ROUND':
      patchState(tabId, {
        status: 'running',
        rounds: message.round,
        postCount: Math.max(stateOf(tabId).postCount, message.posts),
        strategy: message.strategy,
      });
      break;
    case 'POST_BATCH': {
      try {
        await putPosts(message.posts);
      } catch (err) {
        console.warn('[PR] falha ao gravar posts', err);
        patchState(tabId, {
          status: 'error',
          error: { code: 'STORAGE_FULL', detail: err instanceof Error ? err.message : String(err) },
        });
        pushToPanels({ type: 'ERROR', code: 'STORAGE_FULL' });
        return;
      }
      // postCount vem do total acumulado no content script (mensagem ROUND).
      if (message.unrecognized > 0) {
        patchState(tabId, { unrecognized: stateOf(tabId).unrecognized + message.unrecognized });
      }
      break;
    }
    case 'PROFILE': {
      try {
        await putProfile(message.profile);
        console.log('[PR] perfil salvo', message.profile.name);
      } catch (err) {
        console.warn('[PR] falha ao salvar perfil', err);
      }
      break;
    }
    case 'STOPPED':
      patchState(tabId, {
        status: stateOf(tabId).status === 'error' ? 'error' : 'done',
        stopReason: message.reason,
      });
      break;
    case 'FAILED':
      patchState(tabId, { status: 'error', error: { code: message.code, detail: message.detail } });
      pushToPanels({ type: 'ERROR', code: message.code, detail: message.detail });
      break;
  }
}

// ------------------------------------------------------------------ comandos do painel

chrome.runtime.onMessage.addListener((request: PanelRequest, _sender, sendResponse) => {
  void (async () => {
    const reply = (response: PanelResponse): void => sendResponse(response);

    try {
      if (request.type === 'GET_STATE') {
        reply({ ok: true, state: stateOf(request.tabId) });
        return;
      }

      const port = contentPorts.get(request.tabId);
      if (!port) {
        reply({
          ok: false,
          code: 'EXT_UNAVAILABLE',
          detail: 'content script não conectado nesta aba — recarregue a página do LinkedIn',
        });
        return;
      }

      if (request.type === 'START_SCROLL') {
        patchState(request.tabId, {
          status: 'running',
          rounds: 0,
          postCount: 0,
          unrecognized: 0,
          startedAt: Date.now(),
          stopReason: undefined,
          error: undefined,
        });
        port.postMessage({ type: 'START', limits: request.limits });
      } else {
        port.postMessage({ type: 'STOP' });
      }

      reply({ ok: true, state: stateOf(request.tabId) });
    } catch (err) {
      reply({ ok: false, code: 'EXT_UNAVAILABLE', detail: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true;
});

// ------------------------------------------------------------------ abas

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void syncPanel(tabId, changeInfo.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => syncPanel(tabId, tab.url))
    .catch((err: unknown) => console.warn('[PR] tabs.get falhou', tabId, err));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  states.delete(tabId);
  contentPorts.delete(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  void enableOnActionClick();
  void ensureSchema();
  console.log('[PR] onInstalled');
});

console.log('[PR] sw boot');
