// Service worker: só roteia. Nunca roda o loop de scroll, nunca chama IA.
const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//;

/** Habilita o side panel apenas em abas do LinkedIn. */
async function syncPanel(tabId: number, url: string | undefined): Promise<void> {
  const enabled = !!url && LINKEDIN.test(url);
  try {
    await chrome.sidePanel.setOptions({ tabId, path: 'sidepanel.html', enabled });
  } catch {
    // aba já fechada (corrida normal entre onUpdated e onActivated)
  }
}

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  console.log('[PR] sw ready');
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' || info.url) void syncPanel(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then((tab) => syncPanel(tabId, tab.url))
    .catch(() => undefined);
});

console.log('[PR] sw boot', new Date().toISOString());
