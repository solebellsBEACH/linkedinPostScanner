function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[PR] elemento #${id} não encontrado`);
  return node;
}

const app = must('app');

const header = document.createElement('header');
header.className = 'sp-header';

const title = document.createElement('h1');
title.className = 'sp-title';
title.textContent = 'Post Scanner';

const dashLink = document.createElement('a');
dashLink.className = 'sp-dash-link';
dashLink.textContent = 'Dashboard ↗';
dashLink.href = chrome.runtime.getURL('dashboard.html#/overview');
dashLink.target = '_blank';
dashLink.rel = 'noreferrer';

header.append(title, dashLink);

const body = document.createElement('p');
body.className = 'sp-placeholder';
body.textContent = 'Fase 1 — esqueleto carregado.';

app.replaceChildren(header, body);

console.log('[PR] side panel ready');
