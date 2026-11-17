import { openDb } from './shared/idb';
import { getSchemaVersion, setSchemaVersion } from './shared/storage';

const SCHEMA_VERSION = 1;

/** Garante stores do IndexedDB e schemaVersion gravado. Falha silenciosa: SW não pode quebrar. */
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

const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//;

const PANEL_PATH = 'sidepanel.html';

/** Habilita o side panel só em abas do LinkedIn. Falha silenciosa: SW não pode quebrar. */
async function syncPanel(tabId: number, url: string | undefined): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: PANEL_PATH,
      enabled: LINKEDIN.test(url ?? ''),
    });
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

chrome.runtime.onInstalled.addListener(() => {
  void enableOnActionClick();
  void ensureSchema();
  console.log('[PR] onInstalled');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void syncPanel(tabId, changeInfo.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => syncPanel(tabId, tab.url))
    .catch((err: unknown) => console.warn('[PR] tabs.get falhou', tabId, err));
});

console.log('[PR] sw boot');
