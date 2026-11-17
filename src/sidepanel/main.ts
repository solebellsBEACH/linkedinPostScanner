import { AppError, isAppError, type ErrorCode } from '../shared/errors';
import { getApiKey, getSettings, getTheme, PROVIDERS } from '../shared/storage';
import { estimateUsage, getPostsSince, getProfile, putAnalysis, putHistory } from '../shared/idb';
import { analyze } from '../shared/summarize';
import {
  IDLE_STATE,
  PANEL_PORT,
  rpc,
  type PanelPush,
  type PanelRequest,
  type PanelResponse,
  type ScrollState,
} from '../shared/messaging';
import { PROVIDER_INFO } from '../shared/providers';
import { applyTheme, formatCount, h, openDashboard, renderErrorCard, type ErrorAction } from '../shared/ui';
import type { Analysis, Post } from '../shared/types';

// ------------------------------------------------------------------ estado

let tabId: number | null = null;
let tabUrl = '';
let isFeed = false;
let scrollState: ScrollState = { ...IDLE_STATE };
let mode: 'resume' | 'prompt' = 'resume';
let busy = false;
let lastPosts: Post[] = [];

// ------------------------------------------------------------------ helpers

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[PR] elemento #${id} não encontrado`);
  return node;
}

function errorCode(err: unknown): ErrorCode {
  if (isAppError(err)) return err.code;
  return 'EXT_UNAVAILABLE';
}

function errorDetail(err: unknown): string | undefined {
  if (isAppError(err)) return err.detail;
  return err instanceof Error ? err.message : undefined;
}

// ------------------------------------------------------------------ esqueleto

const app = must('app');

const dashLink = h(
  'a',
  {
    class: 'sp-dash-link',
    href: chrome.runtime.getURL('dashboard.html#/overview'),
    target: '_blank',
    rel: 'noreferrer',
    text: 'Dashboard ↗',
  },
);

const header = h(
  'header',
  { class: 'sp-header' },
  h('h1', { class: 'sp-title', text: 'Post Scanner' }),
  dashLink,
);

const toggle = h('button', {
  class: 'sp-switch',
  type: 'button',
  role: 'switch',
  'aria-checked': 'false',
  'aria-label': 'Ligar scroll automático',
}) as HTMLButtonElement;
toggle.append(h('span', { class: 'sp-switch-knob' }));

const counter = h('span', { class: 'sp-count', text: '0 posts lidos' });
const statusText = h('span', { class: 'sp-status', text: 'parado' });
const dot = h('span', { class: 'sp-dot', 'aria-hidden': 'true' });

const notice = h('p', { class: 'sp-notice', text: 'Abra o feed do LinkedIn para ligar o scroll.' });

const scrollCard = h(
  'section',
  { class: 'sp-scroll' },
  h(
    'div',
    { class: 'sp-row' },
    h('span', { class: 'sp-label', text: 'Scroll automático' }),
    toggle,
  ),
  h('p', { class: 'sp-meta' }, dot, counter, h('span', { class: 'sp-sep', text: '·' }), statusText),
  notice,
);

function tabButton(kind: 'resume' | 'prompt', label: string): HTMLButtonElement {
  const button = h('button', {
    class: 'sp-tab',
    type: 'button',
    role: 'tab',
    'aria-selected': 'false',
    onClick: () => {
      mode = kind;
      renderTabs();
    },
  }) as HTMLButtonElement;
  button.textContent = label;
  return button;
}

const tabResume = tabButton('resume', 'Gerar resumo');
const tabPrompt = tabButton('prompt', 'Analisar via prompt');
const tabs = h('div', { class: 'sp-tabs', role: 'tablist' }, tabResume, tabPrompt);

const textarea = h('textarea', {
  class: 'sp-textarea',
  rows: '3',
  placeholder: 'Ex.: quais vagas remotas de React foram anunciadas?',
  'aria-label': 'Pergunta sobre os posts',
}) as HTMLTextAreaElement;

const promptArea = h('div', { class: 'sp-prompt' }, textarea);

const cta = h('button', { class: 'sp-cta', type: 'button' }, 'Gerar resumo') as HTMLButtonElement;
const result = h('div', { class: 'sp-result' });

app.replaceChildren(header, scrollCard, tabs, promptArea, cta, result);

// ------------------------------------------------------------------ render

function renderTabs(): void {
  const resumeActive = mode === 'resume';
  tabResume.setAttribute('aria-selected', String(resumeActive));
  tabPrompt.setAttribute('aria-selected', String(!resumeActive));
  tabResume.classList.toggle('is-active', resumeActive);
  tabPrompt.classList.toggle('is-active', !resumeActive);
  promptArea.hidden = resumeActive;
  cta.textContent = resumeActive ? 'Gerar resumo' : 'Analisar';
}

function renderState(): void {
  const running = scrollState.status === 'running';
  toggle.setAttribute('aria-checked', String(running));
  toggle.classList.toggle('is-on', running);
  toggle.disabled = !isFeed || tabId === null;

  counter.textContent = `${formatCount(scrollState.postCount)} posts lidos`;

  if (scrollState.status === 'running') statusText.textContent = `rodada ${formatCount(scrollState.rounds)}`;
  else if (scrollState.status === 'done') statusText.textContent = 'concluído';
  else if (scrollState.status === 'error') statusText.textContent = 'erro';
  else statusText.textContent = 'parado';

  dot.className = `sp-dot ${
    scrollState.status === 'running' ? 'is-live' : scrollState.status === 'error' ? 'is-error' : ''
  }`;

  notice.hidden = isFeed && tabId !== null;
}

function setResult(node: HTMLElement | null): void {
  result.replaceChildren();
  if (node) result.append(node);
}

function renderIdle(): void {
  if (lastPosts.length === 0) {
    setResult(
      h(
        'div',
        { class: 'sp-empty' },
        h('p', { text: 'Ligue o scroll e deixe rodar por alguns minutos.' }),
        h('p', { class: 'sp-empty-sub', text: 'Depois volte aqui para resumir o que apareceu.' }),
      ),
    );
    return;
  }
  setResult(
    h(
      'div',
      { class: 'sp-empty' },
      h('p', { text: `${formatCount(lastPosts.length)} posts prontos para analisar.` }),
      h('p', { class: 'sp-empty-sub', text: 'Escolha uma opção acima e clique no botão.' }),
    ),
  );
}

function renderLoading(message: string): void {
  setResult(
    h(
      'div',
      { class: 'sp-loading' },
      h('span', { class: 'sp-spinner', 'aria-hidden': 'true' }),
      h('p', { class: 'sp-loading-text', text: message }),
    ),
  );
}

function renderAnalysis(analysis: Analysis): void {
  const bullets = analysis.bullets.slice(0, 5);

  const headerBlock = h(
    'div',
    { class: 'sp-result-head' },
    h('p', { class: 'sp-result-kicker', text: analysis.kind === 'resume' ? 'Resumo' : 'Resposta' }),
    h(
      'p',
      { class: 'sp-result-title', text: analysis.kind === 'resume' ? `${formatCount(analysis.postCount)} posts analisados` : analysis.query ?? '' },
    ),
  );

  const list = h('ol', { class: 'sp-bullets' });
  bullets.forEach((bullet, index) => {
    list.append(
      h(
        'li',
        { class: 'sp-bullet' },
        h('span', { class: 'sp-bullet-index', text: String(index + 1).padStart(2, '0') }),
        h('span', { class: 'sp-bullet-text', text: bullet.text }),
      ),
    );
  });

  const jobsBlock =
    analysis.jobs.length > 0
      ? h(
          'div',
          { class: 'sp-jobs' },
          h('p', { class: 'sp-jobs-title', text: `Vagas encontradas · ${analysis.jobs.length}` }),
          ...analysis.jobs.slice(0, 3).map((job) =>
            h(
              'div',
              { class: 'sp-job' },
              h('span', { class: 'sp-job-title', text: job.title }),
              h(
                'span',
                { class: 'sp-job-meta', text: [job.company, job.loc, job.mode].filter((v) => v.length > 0).join(' · ') },
              ),
              job.match === null ? null : h('span', { class: `sp-job-match ${matchClass(job.match)}`, text: `${job.match}%` }),
            ),
          ),
        )
      : null;

  const footer = h(
    'div',
    { class: 'sp-result-actions' },
    h('button', { class: 'sp-link-btn', type: 'button', onClick: () => openDashboard('history') }, 'Ver análise completa'),
  );

  setResult(
    h('section', { class: 'sp-result-card' }, headerBlock, list, jobsBlock, footer),
  );
}

function matchClass(match: number): string {
  if (match >= 80) return 'is-high';
  if (match >= 60) return 'is-mid';
  return 'is-low';
}

function actionsFor(code: ErrorCode): ErrorAction[] {
  switch (code) {
    case 'AI_NO_KEY':
    case 'AI_401':
      return [{ label: 'Configurar chave', primary: true, onClick: () => openDashboard('settings') }];
    case 'AI_429':
      return [
        { label: 'Tentar de novo', primary: true, onClick: () => void runAnalysis() },
        { label: 'Trocar provedor', onClick: () => openDashboard('settings') },
      ];
    case 'AI_TIMEOUT':
    case 'AI_BAD_OUTPUT':
    case 'NETWORK_OFFLINE':
    case 'AI_LOCAL_OFFLINE':
      return [{ label: 'Tentar de novo', primary: true, onClick: () => void runAnalysis() }];
    case 'SUMMARY_EMPTY':
    case 'SUMMARY_TOO_FEW':
    case 'SCROLL_NOT_FEED':
      return [
        { label: 'Ligar o scroll', primary: true, onClick: () => void toggleScroll(true) },
        { label: 'Abrir o feed', onClick: () => void chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' }) },
      ];
    case 'PROMPT_EMPTY':
      return [{ label: 'Editar prompt', primary: true, onClick: () => textarea.focus() }];
    case 'PROMPT_NO_RESULTS':
      return [
        { label: 'Tentar de novo', primary: true, onClick: () => void runAnalysis() },
        { label: 'Editar prompt', onClick: () => textarea.focus() },
      ];
    case 'PROFILE_UNREADABLE':
      return [
        { label: 'Abrir meu perfil', primary: true, onClick: () => void chrome.tabs.create({ url: 'https://www.linkedin.com/in/me/' }) },
        { label: 'Ver vagas sem match', onClick: () => void runAnalysis({ ignoreProfile: true }) },
      ];
    case 'EXT_UNAVAILABLE':
      return [{ label: 'Recarregar a página', primary: true, onClick: () => chrome.tabs.reload() }];
    default:
      return [{ label: 'Tentar de novo', primary: true, onClick: () => void runAnalysis() }];
  }
}

function renderFailure(err: unknown): void {
  const code = errorCode(err);
  setResult(renderErrorCard({ code, detail: errorDetail(err), actions: actionsFor(code) }));
}

// ------------------------------------------------------------------ ações

async function toggleScroll(forceStart?: boolean): Promise<void> {
  if (tabId === null) return;
  const shouldStart = forceStart ?? scrollState.status !== 'running';

  try {
    if (shouldStart) {
      const settings = await getSettings();
      const response = await rpc<PanelRequest, PanelResponse>({
        type: 'START_SCROLL',
        tabId,
        limits: { maxRounds: settings.maxRounds, maxMinutes: settings.maxMinutes },
      });
      if (!response.ok) throw new AppError(response.code, response.detail);
      scrollState = response.state;
    } else {
      const response = await rpc<PanelRequest, PanelResponse>({ type: 'STOP_SCROLL', tabId });
      if (!response.ok) throw new AppError(response.code, response.detail);
      scrollState = response.state;
    }
  } catch (err) {
    renderFailure(err);
    return;
  }

  renderState();
}

async function runAnalysis(options: { ignoreProfile?: boolean } = {}): Promise<void> {
  if (busy) return;
  busy = true;
  cta.disabled = true;

  try {
    const settings = await getSettings();
    const apiKey = await getApiKey(settings.provider);
    if (PROVIDER_INFO[settings.provider].needsKey && !apiKey) {
      throw new AppError('AI_NO_KEY', `provedor ${settings.provider} sem chave`);
    }

    const usage = await estimateUsage();
    if (usage.quota > 0 && usage.usage / usage.quota > 0.92) {
      throw new AppError('STORAGE_FULL', `${Math.round((usage.usage / usage.quota) * 100)}% da cota usada`);
    }

    const all = await getPostsSince(0);
    lastPosts = all.slice(-300);
    if (lastPosts.length === 0) throw new AppError(mode === 'prompt' ? 'PROMPT_NO_RESULTS' : 'SUMMARY_EMPTY');

    renderLoading('Preparando análise…');

    const profile = options.ignoreProfile ? undefined : await getProfile();
    const analysis = await analyze({
      kind: mode,
      query: textarea.value,
      posts: lastPosts,
      ...(profile ? { profile } : {}),
      settings,
      ...(apiKey ? { apiKey } : {}),
      unrecognized: scrollState.unrecognized,
      ...(options.ignoreProfile ? { allowNoProfile: true } : {}),
      onProgress: (message) => renderLoading(message),
    });

    await putAnalysis(analysis);
    await putHistory({
      id: crypto.randomUUID(),
      analysisId: analysis.id,
      kind: analysis.kind,
      title: analysis.kind === 'resume' ? `Resumo de ${analysis.postCount} posts` : analysis.query ?? 'Pergunta',
      meta: `${analysis.bullets.length} pontos · ${analysis.jobs.length} vagas`,
      createdAt: analysis.createdAt,
    });

    renderAnalysis(analysis);
  } catch (err) {
    console.warn('[PR] análise falhou', err);
    renderFailure(err);
  } finally {
    busy = false;
    cta.disabled = false;
  }
}

toggle.addEventListener('click', () => void toggleScroll());
cta.addEventListener('click', () => void runAnalysis());

// ------------------------------------------------------------------ porta do SW

function connectPort(): void {
  const port = chrome.runtime.connect({ name: PANEL_PORT });
  port.onMessage.addListener((message: PanelPush) => {
    if (message.type === 'STATE') {
      scrollState = message.state;
      renderState();
    } else if (message.type === 'ERROR') {
      renderFailure(new AppError(message.code, message.detail));
    }
  });
  port.onDisconnect.addListener(() => {
    setTimeout(connectPort, 1000);
  });
}

// ------------------------------------------------------------------ init

async function init(): Promise<void> {
  applyTheme(await getTheme());
  renderTabs();
  renderIdle();

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  tabId = tab?.id ?? null;
  tabUrl = tab?.url ?? '';
  isFeed = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/(feed|search\/results\/content)/.test(tabUrl);

  renderState();

  try {
    const response = await rpc<PanelRequest, PanelResponse>({ type: 'GET_STATE', tabId: tabId ?? -1 });
    if (response.ok) scrollState = response.state;
  } catch {
    // SW ainda acordando: a porta vai trazer o estado
  }

  renderState();
  connectPort();

  if (!isFeed) {
    setResult(
      h(
        'div',
        { class: 'sp-empty' },
        h('p', { text: 'Esta aba não é o feed do LinkedIn.' }),
        h('p', { class: 'sp-empty-sub', text: 'Abra linkedin.com/feed e o painel passa a funcionar aqui.' }),
      ),
    );
  }
}

console.log('[PR] side panel ready', PROVIDERS.length, 'provedores');
void init();
