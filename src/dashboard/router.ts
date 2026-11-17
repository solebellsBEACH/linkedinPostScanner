export const ROUTES = ['overview', 'jobs', 'job', 'history', 'chat', 'settings'] as const;

export type Route = (typeof ROUTES)[number];

export type ParsedRoute = { name: Route; param?: string };

export const TITLES: Record<Route, string> = {
  overview: 'Visão geral',
  jobs: 'Vagas',
  job: 'Detalhe da vaga',
  history: 'Histórico',
  chat: 'Perguntar',
  settings: 'Configurações',
};

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

/** `#/job/123` → `{ name: 'job', param: '123' }`; inválido cai em `overview`. */
export function parseRoute(hash: string = location.hash): ParsedRoute {
  const raw = hash.replace(/^#\/?/, '').trim();
  if (raw.length === 0) return { name: 'overview' };

  const [name, ...rest] = raw.split('/');
  if (!name || !isRoute(name)) return { name: 'overview' };

  const param = rest.join('/');
  return param.length > 0 ? { name, param: decodeURIComponent(param) } : { name };
}

export function getRoute(): Route {
  return parseRoute().name;
}
