import { getProfile, listJobs } from '../../shared/idb';
import { normalizeSkill } from '../../shared/jobs';
import { formatPercent, h, renderErrorCard } from '../../shared/ui';
import { card, cardTitle, pageHeader } from './common';

export async function renderJob(param: string | undefined): Promise<HTMLElement> {
  const [jobs, profile] = await Promise.all([listJobs(), getProfile()]);
  const job = param ? jobs.find((item) => item.id === param) : undefined;

  if (!job) {
    return h(
      'div',
      { class: 'page' },
      pageHeader('Detalhe da vaga'),
      renderErrorCard({
        code: 'JOB_CLOSED',
        body: 'Esta vaga não está mais no armazenamento local.',
        actions: [{ label: 'Ver todas as vagas', primary: true, onClick: () => (location.hash = '#/jobs') }],
      }),
    );
  }

  const profileSkills = new Set((profile?.skills ?? []).map(normalizeSkill).filter((s) => s.length > 0));
  const rows = job.stack.map((skill) => {
    const has = profileSkills.has(normalizeSkill(skill));
    return { skill, has };
  });
  const hits = rows.filter((row) => row.has).length;
  const total = rows.length;

  const matchValue = job.match;

  const summary = h(
    'div',
    { class: 'job-hero' },
    h(
      'div',
      { class: 'job-hero-main' },
      h('p', { class: 'job-company-lg', text: job.company }),
      h('h1', { class: 'job-title-lg', text: job.title }),
      h(
        'p',
        { class: 'job-facts', text: [job.loc, job.mode, job.easyApply ? 'Easy Apply' : 'Candidatura externa'].join(' · ') },
      ),
    ),
    h(
      'div',
      { class: 'job-score' },
      h('span', { class: 'job-score-value', text: formatPercent(matchValue) }),
      h('span', { class: 'job-score-label', text: `${hits} de ${total} requisitos` }),
    ),
  );

  const requirementList = h(
    'ul',
    { class: 'req-list' },
    ...rows.map((row) =>
      h(
        'li',
        { class: `req ${row.has ? 'req-yes' : 'req-no'}` },
        h('span', { class: 'req-mark', text: row.has ? '✓' : '–', 'aria-hidden': 'true' }),
        h('span', { class: 'req-name', text: row.skill }),
        h('span', { class: 'req-state', text: row.has ? 'no seu perfil' : 'não encontrado' }),
      ),
    ),
  );

  const facts = h(
    'dl',
    { class: 'facts' },
    h('dt', { text: 'Publicada' }),
    h('dd', { text: job.posted || '—' }),
    h('dt', { text: 'Modelo' }),
    h('dd', { text: job.mode }),
    h('dt', { text: 'Candidatura' }),
    h('dd', { text: job.easyApply ? 'Easy Apply' : 'Externa' }),
    h('dt', { text: 'Fonte' }),
    h(
      'dd',
      {},
      h('a', { href: job.url, target: '_blank', rel: 'noreferrer', text: 'Ver post no LinkedIn' }),
    ),
  );

  return h(
    'div',
    { class: 'page' },
    pageHeader('Detalhe da vaga', 'Requisitos comparados com as skills do seu perfil'),
    card(summary),
    h(
      'div',
      { class: 'grid-2' },
      card(
        cardTitle('Requisitos × perfil', h('span', { class: 'card-meta', text: `${hits}/${total}` })),
        total === 0 ? h('p', { class: 'cell-muted', text: 'A vaga não declara stack.' }) : requirementList,
      ),
      card(cardTitle('Informações'), facts),
    ),
  );
}
