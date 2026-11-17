import { h } from '../../shared/ui';

export function pageHeader(title: string, subtitle?: string): HTMLElement {
  return h(
    'header',
    { class: 'page-header' },
    h('h1', { class: 'page-title', text: title }),
    subtitle ? h('p', { class: 'page-subtitle', text: subtitle }) : null,
  );
}

export function card(...children: (Node | string | null)[]): HTMLElement {
  const node = h('section', { class: 'card' });
  for (const child of children) {
    if (child === null) continue;
    node.append(child);
  }
  return node;
}

export function cardTitle(text: string, action?: Node): HTMLElement {
  return h(
    'div',
    { class: 'card-head' },
    h('h2', { class: 'card-title', text }),
    action ?? null,
  );
}

export function stat(label: string, value: string, hint?: string): HTMLElement {
  return h(
    'div',
    { class: 'stat' },
    h('p', { class: 'stat-label', text: label }),
    h('p', { class: 'stat-value', text: value }),
    hint ? h('p', { class: 'stat-hint', text: hint }) : null,
  );
}

export function emptyState(text: string, sub?: string): HTMLElement {
  return h(
    'div',
    { class: 'empty-state' },
    h('p', { class: 'empty-title', text }),
    sub ? h('p', { class: 'empty-sub', text: sub }) : null,
  );
}
