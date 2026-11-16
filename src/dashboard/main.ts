import { getRoute, ROUTES } from './router';

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[PR] dashboard: #${id} ausente no HTML`);
  return el;
}

const view = must('view');
const nav = must('nav');

/** Renderiza a tela atual. Só textContent — nunca innerHTML com dado externo. */
function render(): void {
  const route = getRoute();

  for (const link of nav.querySelectorAll<HTMLAnchorElement>('a')) {
    const active = link.dataset.route === route;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const title = document.createElement('h2');
  title.className = 'page-title';
  title.textContent = ROUTES[route].title;

  const sub = document.createElement('p');
  sub.className = 'page-sub';
  sub.textContent = ROUTES[route].subtitle;

  view.replaceChildren(title, sub);
}

window.addEventListener('hashchange', render);
render();

console.log('[PR] dashboard ready', getRoute());
