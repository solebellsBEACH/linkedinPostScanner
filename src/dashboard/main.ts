import { getRoute } from './router';
import type { Route } from './router';

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`[PR] elemento #${id} não encontrado`);
  return node;
}

const NAV: { route: Route; label: string }[] = [
  { route: 'overview', label: 'Visão geral' },
  { route: 'jobs', label: 'Vagas' },
  { route: 'history', label: 'Histórico' },
  { route: 'chat', label: 'Chat' },
  { route: 'settings', label: 'Configurações' },
];

const TITLES: Record<Route, string> = {
  overview: 'Visão geral',
  jobs: 'Vagas',
  job: 'Vaga',
  history: 'Histórico',
  chat: 'Chat',
  settings: 'Configurações',
};

const app = must('app');

const sidebar = document.createElement('nav');
sidebar.className = 'db-sidebar';

const brand = document.createElement('div');
brand.className = 'db-brand';
brand.textContent = 'Post Scanner';
sidebar.append(brand);

const navList = document.createElement('ul');
navList.className = 'db-nav';

for (const item of NAV) {
  const li = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'db-nav-link';
  link.href = `#/${item.route}`;
  link.dataset.route = item.route;
  link.textContent = item.label;
  li.append(link);
  navList.append(li);
}

sidebar.append(navList);

const main = document.createElement('main');
main.className = 'db-main';

const crumb = document.createElement('div');
crumb.className = 'db-crumb';
crumb.textContent = 'Fase 1';

const heading = document.createElement('h1');
heading.className = 'db-heading';

main.append(crumb, heading);

app.replaceChildren(sidebar, main);

function render(): void {
  const route = getRoute();
  heading.textContent = TITLES[route];
  document.title = `${TITLES[route]} — Post Scanner`;

  for (const link of navList.querySelectorAll<HTMLAnchorElement>('.db-nav-link')) {
    const active = link.dataset.route === route;
    link.classList.toggle('is-active', active);
  }
}

window.addEventListener('hashchange', render);
render();

console.log('[PR] dashboard ready', location.hash);
