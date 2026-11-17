import { isErrorCode } from '../shared/errors';
import { getTheme } from '../shared/storage';
import { applyTheme, h, renderErrorCard } from '../shared/ui';
import { parseRoute, TITLES, type ParsedRoute } from './router';
import { renderChat } from './pages/chat';
import { renderHistory } from './pages/history';
import { renderJob } from './pages/job';
import { renderJobs } from './pages/jobs';
import { renderOverview } from './pages/overview';
import { renderSettings } from './pages/settings';

const NAV: { hash: string; label: string; route: ParsedRoute['name'] }[] = [
  { hash: '#/overview', label: 'Visão geral', route: 'overview' },
  { hash: '#/jobs', label: 'Vagas', route: 'jobs' },
  { hash: '#/history', label: 'Histórico', route: 'history' },
  { hash: '#/chat', label: 'Perguntar', route: 'chat' },
  { hash: '#/settings', label: 'Configurações', route: 'settings' },
];

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[PR] elemento #${id} não encontrado`);
  return node;
}

const app = must('app');

const brand = h(
  'div',
  { class: 'brand' },
  h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
  h(
    'div',
    { class: 'brand-text' },
    h('span', { class: 'brand-name', text: 'Post Scanner' }),
    h('span', { class: 'brand-sub', text: 'LinkedIn' }),
  ),
);

const nav = h('nav', { class: 'nav', 'aria-label': 'Seções' });
const navLinks = new Map<string, HTMLAnchorElement>();

for (const item of NAV) {
  const link = h('a', { class: 'nav-link', href: item.hash, text: item.label }) as HTMLAnchorElement;
  navLinks.set(item.route, link);
  nav.append(link);
}

const version = chrome.runtime.getManifest().version;

const sidebar = h(
  'aside',
  { class: 'sidebar' },
  brand,
  nav,
  h('div', { class: 'sidebar-footer' }, h('span', { class: 'sidebar-version', text: `v${version}` })),
);

const content = h('main', { class: 'content' });

app.replaceChildren(h('div', { class: 'shell' }, sidebar, h('div', { class: 'content-wrap' }, content)));

function renderRoute(route: ParsedRoute): Promise<HTMLElement> {
  switch (route.name) {
    case 'overview':
      return renderOverview();
    case 'jobs':
      return renderJobs();
    case 'job':
      return renderJob(route.param);
    case 'history':
      return renderHistory();
    case 'chat':
      return renderChat();
    case 'settings':
      return renderSettings();
  }
}

let renderToken = 0;

function renderForcedError(code: string): void {
  if (!isErrorCode(code)) return;
  content.replaceChildren(
    h(
      'div',
      { class: 'page' },
      renderErrorCard({
        code,
        body: 'Modo de inspeção: este erro foi forçado por ?prError na URL.',
        actions: [
          {
            label: 'Voltar ao dashboard',
            primary: true,
            onClick: () => {
              history.replaceState(null, '', `${location.pathname}#/overview`);
              void render();
            },
          },
        ],
      }),
    ),
  );
}

async function render(): Promise<void> {
  const forced = new URLSearchParams(location.search).get('prError');
  if (forced) {
    renderForcedError(forced);
    return;
  }

  const route = parseRoute();
  const token = ++renderToken;

  for (const [name, link] of navLinks) {
    link.classList.toggle('is-active', name === route.name || (route.name === 'job' && name === 'jobs'));
  }

  document.title = `${TITLES[route.name]} · Post Scanner`;

  try {
    const node = await renderRoute(route);
    if (token !== renderToken) return;
    content.replaceChildren(node);
  } catch (err) {
    if (token !== renderToken) return;
    console.error('[PR] falha ao renderizar rota', route.name, err);
    content.replaceChildren(
      h(
        'div',
        { class: 'page' },
        renderErrorCard({
          code: 'EXT_UNAVAILABLE',
          detail: err instanceof Error ? err.message : String(err),
          body: 'Não foi possível carregar esta tela.',
          actions: [{ label: 'Recarregar', primary: true, onClick: () => location.reload() }],
        }),
      ),
    );
  }
}

window.addEventListener('hashchange', () => void render());

// O side panel grava no IndexedDB enquanto esta aba fica em background.
// Sem isso o dashboard mostra números velhos até trocar de rota.
let lastRefresh = 0;
function refreshIfStale(): void {
  const now = Date.now();
  if (now - lastRefresh < 1500) return;
  lastRefresh = now;
  if (!location.search.includes('prError')) void render();
}

document.addEventListener('visibilitychange', refreshIfStale);
window.addEventListener('focus', refreshIfStale);

async function boot(): Promise<void> {
  applyTheme(await getTheme());
  if (!location.hash || location.hash === '#') location.hash = '#/overview';
  await render();
  console.log('[PR] dashboard ready');
}

void boot();
