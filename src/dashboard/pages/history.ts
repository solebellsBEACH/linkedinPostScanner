import { deleteAnalysis, getAnalysis, listAnalyses, listHistory } from '../../shared/idb';
import { formatDate, formatDay, h, renderErrorCard } from '../../shared/ui';
import type { Analysis, HistoryEntry } from '../../shared/types';
import { card, cardTitle, emptyState, pageHeader } from './common';

type Filter = 'all' | 'resume' | 'prompt';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tudo' },
  { id: 'resume', label: 'Resumos' },
  { id: 'prompt', label: 'Prompts' },
];

let current: Filter = 'all';

function groupByDay(entries: readonly HistoryEntry[]): Map<string, HistoryEntry[]> {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const key = formatDay(entry.createdAt);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

function detail(analysis: Analysis | undefined): HTMLElement {
  if (!analysis) {
    return renderErrorCard({
      code: 'DATA_CORRUPT',
      body: 'Esta análise não pôde ser lida do armazenamento.',
      actions: [{ label: 'Voltar ao histórico', primary: true, onClick: () => void renderHistory() }],
    });
  }

  return h(
    'div',
    { class: 'history-detail' },
    h('p', { class: 'card-meta', text: `${analysis.postCount} posts · ${analysis.jobs.length} vagas · ${analysis.bullets.length} pontos` }),
    h(
      'ol',
      { class: 'bullets' },
      ...analysis.bullets.map((bullet, index) =>
        h(
          'li',
          { class: 'bullet' },
          h('span', { class: 'bullet-index', text: String(index + 1).padStart(2, '0') }),
          h('span', { class: 'bullet-text', text: bullet.text }),
        ),
      ),
    ),
  );
}

export async function renderHistory(): Promise<HTMLElement> {
  const [entries, analyses] = await Promise.all([listHistory(200), listAnalyses(200)]);
  const byId = new Map(analyses.map((analysis) => [analysis.id, analysis]));

  const page = h('div', { class: 'page' });
  const host = h('div', { class: 'history-host' });
  const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filtrar histórico' });
  const buttons = new Map<Filter, HTMLButtonElement>();

  const paint = (): void => {
    for (const [id, button] of buttons) {
      button.classList.toggle('is-active', id === current);
      button.setAttribute('aria-pressed', String(id === current));
    }

    const visible = entries.filter((entry) => current === 'all' || entry.kind === current);
    if (visible.length === 0) {
      host.replaceChildren(emptyState('Nada no histórico ainda.', 'Gere um resumo no side panel para começar.'));
      return;
    }

    const groups = groupByDay(visible);
    const blocks: HTMLElement[] = [];

    for (const [day, list] of groups) {
      const rows = list.map((entry) => {
        const analysis = byId.get(entry.analysisId);
        const details = h('div', { class: 'history-details' });
        details.hidden = true;

        const button = h(
          'button',
          {
            class: 'history-row',
            type: 'button',
            onClick: () => {
              details.hidden = !details.hidden;
              if (!details.hidden && details.childElementCount === 0) {
                void getAnalysis(entry.analysisId).then((loaded) => {
                  if (!loaded) {
                    details.replaceChildren(
                      renderErrorCard({
                        code: 'DATA_CORRUPT',
                        body: 'Esta análise não pôde ser lida do armazenamento.',
                        actions: [
                          {
                            label: 'Remover análise',
                            primary: true,
                            onClick: () => {
                              void deleteAnalysis(entry.analysisId).then(() => {
                                details.replaceChildren(h('p', { class: 'cell-muted', text: 'Análise removida.' }));
                              });
                            },
                          },
                        ],
                      }),
                    );
                    return;
                  }
                  details.replaceChildren(detail(loaded));
                });
              }
            },
          },
          h('span', { class: 'history-kind', text: entry.kind === 'resume' ? 'RESUME' : 'PROMPT' }),
          h('span', { class: 'history-title', text: entry.title }),
          h('span', { class: 'history-meta', text: `${entry.meta} · ${formatDate(entry.createdAt)}` }),
        );

        if (analysis) {
          // pré-carrega nada: o detalhe é lido sob demanda
        }

        return h('div', { class: 'history-item' }, button, details);
      });

      blocks.push(h('section', { class: 'history-day' }, h('h3', { class: 'history-day-title', text: day }), ...rows));
    }

    host.replaceChildren(...blocks);
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

  page.append(pageHeader('Histórico', `${entries.length} entradas salvas`), card(cardTitle('Filtros'), segmented), card(host));
  return page;
}
