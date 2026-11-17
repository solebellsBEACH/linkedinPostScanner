import { listJobs } from '../../shared/idb';
import { formatPercent, h } from '../../shared/ui';
import type { Job } from '../../shared/types';
import { card, cardTitle, emptyState, pageHeader } from './common';

type Filter = 'all' | 'remoto' | 'hibrido' | 'easy';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'remoto', label: 'Remoto' },
  { id: 'hibrido', label: 'Híbrido' },
  { id: 'easy', label: 'Easy Apply' },
];

let current: Filter = 'all';

function matches(job: Job, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'easy') return job.easyApply;
  if (filter === 'remoto') return job.mode === 'remoto';
  return job.mode === 'híbrido';
}

function matchClass(match: number | null): string {
  if (match === null) return 'is-low';
  if (match >= 80) return 'is-high';
  if (match >= 60) return 'is-mid';
  return 'is-low';
}

export async function renderJobs(): Promise<HTMLElement> {
  const jobs = await listJobs();
  const page = h('div', { class: 'page' });

  const tableHost = h('div', {});

  const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filtrar vagas' });
  const buttons = new Map<Filter, HTMLButtonElement>();

  const paint = (): void => {
    for (const [id, button] of buttons) {
      button.classList.toggle('is-active', id === current);
      button.setAttribute('aria-pressed', String(id === current));
    }

    const visible = jobs.filter((job) => matches(job, current));
    if (visible.length === 0) {
      tableHost.replaceChildren(emptyState('Nenhuma vaga neste filtro.', 'Rode o scroll no feed para coletar mais posts.'));
      return;
    }

    tableHost.replaceChildren(
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { text: 'Match' }),
              h('th', { text: 'Vaga' }),
              h('th', { text: 'Local' }),
              h('th', { text: 'Modelo' }),
              h('th', { text: 'Stack' }),
              h('th', { text: 'Publicada' }),
            ),
          ),
          h(
            'tbody',
            {},
            ...visible.map((job) =>
              h(
                'tr',
                {},
                h(
                  'td',
                  {},
                  h('span', { class: `job-match ${matchClass(job.match)}`, text: formatPercent(job.match) }),
                ),
                h(
                  'td',
                  {},
                  h('a', { class: 'job-link', href: `#/job/${encodeURIComponent(job.id)}`, text: job.title }),
                  h('span', { class: 'job-company', text: job.company }),
                ),
                h('td', { class: 'cell-muted', text: job.loc }),
                h('td', { class: 'cell-muted', text: job.mode }),
                h('td', { class: 'cell-muted', text: job.stack.join(' · ') || '—' }),
                h('td', { class: 'cell-muted', text: job.posted || '—' }),
              ),
            ),
          ),
        ),
      ),
    );
  };

  for (const filter of FILTERS) {
    const button = h('button', {
      class: 'segmented-btn',
      type: 'button',
      onClick: () => {
        current = filter.id;
        paint();
      },
    }) as HTMLButtonElement;
    button.textContent = filter.label;
    buttons.set(filter.id, button);
    segmented.append(button);
  }

  paint();

  page.append(
    pageHeader('Vagas', `${jobs.length} vagas detectadas nos posts coletados`),
    card(cardTitle('Filtros'), segmented),
    card(tableHost),
  );

  return page;
}
