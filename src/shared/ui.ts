import { ERROR_META, type ErrorCode } from './errors';
import type { Theme } from './storage';

type Props = Record<string, unknown>;

/**
 * Construtor de DOM mínimo — sem framework, sem innerHTML com texto externo.
 * `text` usa textContent; qualquer outro atributo vai por setAttribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }

  return node;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

export type ErrorAction = { label: string; onClick: () => void; primary?: boolean };

export type ErrorCardOptions = {
  code: ErrorCode;
  detail?: string;
  body?: string;
  actions?: ErrorAction[];
};

/** Cartão de erro do catálogo (docs/SPEC.md §11). */
export function renderErrorCard(options: ErrorCardOptions): HTMLElement {
  const meta = ERROR_META[options.code];

  const actions = h('div', { class: 'ec-actions' });
  for (const action of options.actions ?? []) {
    const button = h(
      'button',
      {
        class: action.primary ? 'ec-btn ec-btn-primary' : 'ec-btn',
        type: 'button',
        onClick: action.onClick,
      },
      action.label,
    );
    actions.append(button);
  }

  return h(
    'section',
    { class: 'ec', role: 'alert' },
    h('p', { class: 'ec-kicker', text: meta.area }),
    h('h2', { class: 'ec-title', text: meta.title }),
    options.body ? h('p', { class: 'ec-body', text: options.body }) : null,
    options.detail ? h('p', { class: 'ec-detail', text: options.detail }) : null,
    actions.childElementCount > 0 ? actions : null,
    h('code', { class: 'ec-code', text: options.code }),
  );
}

/** Link para uma rota do dashboard. */
export function dashboardUrl(hash: string): string {
  return chrome.runtime.getURL(`dashboard.html#/${hash}`);
}

export function openDashboard(hash: string): void {
  void chrome.tabs.create({ url: dashboardUrl(hash) });
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function formatDay(timestamp: number): string {
  const today = new Date();
  const date = new Date(timestamp);
  const sameDay =
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth() &&
    today.getDate() === date.getDate();
  if (sameDay) return 'Hoje';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long' }).format(date);
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}
