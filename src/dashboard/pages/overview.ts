import { getPostsSince, getProfile, listAnalyses, listJobs } from '../../shared/idb';
import { formatCount, formatDate, formatPercent, h } from '../../shared/ui';
import { card, cardTitle, emptyState, pageHeader, stat } from './common';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export async function renderOverview(): Promise<HTMLElement> {
  const [analyses, jobs, posts, profile] = await Promise.all([
    listAnalyses(50),
    listJobs(),
    getPostsSince(Date.now() - WEEK),
    getProfile(),
  ]);

  const resume = analyses.find((item) => item.kind === 'resume');
  const withMatch = jobs.filter((job) => job.match !== null);
  const average =
    withMatch.length > 0
      ? Math.round(withMatch.reduce((sum, job) => sum + (job.match ?? 0), 0) / withMatch.length)
      : null;

  const stats = h(
    'div',
    { class: 'stats' },
    stat('Posts (7 dias)', formatCount(posts.length), 'coletados nesta semana'),
    stat('Resumos', formatCount(analyses.filter((a) => a.kind === 'resume').length), 'análises salvas'),
    stat('Vagas', formatCount(jobs.length), 'detectadas nos posts'),
    stat('Match médio', formatPercent(average), profile ? `${profile.skills.length} skills no perfil` : 'perfil não lido'),
  );

  const header = pageHeader(
    'Visão geral',
    profile ? `Perfil: ${profile.name}${profile.headline ? ` · ${profile.headline}` : ''}` : 'Leia seu perfil abrindo linkedin.com/in/me',
  );

  const summaryCard = resume
    ? card(
        cardTitle('Último resumo', h('span', { class: 'card-meta', text: formatDate(resume.createdAt) })),
        h('p', { class: 'summary-count', text: `${formatCount(resume.postCount)} posts analisados` }),
        h(
          'ol',
          { class: 'bullets' },
          ...resume.bullets.slice(0, 4).map((bullet, index) =>
            h(
              'li',
              { class: 'bullet' },
              h('span', { class: 'bullet-index', text: String(index + 1).padStart(2, '0') }),
              h('span', { class: 'bullet-text', text: bullet.text }),
            ),
          ),
        ),
      )
    : card(cardTitle('Último resumo'), emptyState('Nenhum resumo ainda.', 'Abra o side panel no feed e gere um resumo.'));

  const topics = resume?.topics ?? [];
  const maxCount = topics.reduce((max, topic) => Math.max(max, topic.count), 0) || 1;
  const topicsCard = card(
    cardTitle('Temas', h('span', { class: 'card-meta', text: `${topics.length} assuntos` })),
    topics.length === 0
      ? emptyState('Sem temas ainda.')
      : h(
          'ul',
          { class: 'topic-list' },
          ...topics.map((topic) =>
            h(
              'li',
              { class: 'topic' },
              h('span', { class: 'topic-name', text: topic.name }),
              h(
                'span',
                { class: 'topic-bar' },
                h('span', {
                  class: 'topic-fill',
                  style: `width:${Math.max(6, Math.round((topic.count / maxCount) * 100))}%`,
                }),
              ),
              h('span', { class: 'topic-count', text: String(topic.count) }),
            ),
          ),
        ),
  );

  const best = [...jobs]
    .filter((job) => job.match !== null)
    .sort((a, b) => (b.match ?? 0) - (a.match ?? 0))
    .slice(0, 3);

  const matchesCard = card(
    cardTitle('Melhores matches'),
    best.length === 0
      ? emptyState('Nenhuma vaga com match calculado.', 'Abra seu perfil para o match funcionar.')
      : h(
          'ul',
          { class: 'job-list' },
          ...best.map((job) =>
            h(
              'li',
              { class: 'job-row' },
              h(
                'a',
                { class: 'job-link', href: `#/job/${encodeURIComponent(job.id)}` },
                h('span', { class: 'job-title', text: job.title }),
                h('span', { class: 'job-meta', text: [job.company, job.loc, job.mode].filter(Boolean).join(' · ') }),
              ),
              h('span', { class: `job-match ${matchClass(job.match ?? 0)}`, text: formatPercent(job.match) }),
            ),
          ),
        ),
  );

  return h(
    'div',
    { class: 'page' },
    header,
    stats,
    h('div', { class: 'grid-2' }, summaryCard, topicsCard),
    matchesCard,
  );
}

function matchClass(match: number): string {
  if (match >= 80) return 'is-high';
  if (match >= 60) return 'is-mid';
  return 'is-low';
}
