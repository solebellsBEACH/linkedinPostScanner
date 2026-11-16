export type Route = 'overview' | 'jobs' | 'job' | 'history' | 'chat' | 'settings';

export const ROUTES: Record<Route, { title: string; subtitle: string }> = {
  overview: { title: 'Visão geral', subtitle: 'Resumo do dia, temas e melhores matches.' },
  jobs: { title: 'Vagas', subtitle: 'Vagas encontradas nos posts, ordenadas por match.' },
  job: { title: 'Vaga', subtitle: 'Requisitos comparados com o seu perfil.' },
  history: { title: 'Histórico', subtitle: 'Resumos e prompts executados.' },
  chat: { title: 'Chat', subtitle: 'Respostas a partir dos posts analisados.' },
  settings: { title: 'Configurações', subtitle: 'Preferências, provedor de IA e dados.' },
};

/** Lê `#/rota` e devolve a rota, caindo em overview quando desconhecida. */
export function getRoute(): Route {
  const raw = location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return (raw in ROUTES ? raw : 'overview') as Route;
}
