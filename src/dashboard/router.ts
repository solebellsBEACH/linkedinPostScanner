export const ROUTES = ['overview', 'jobs', 'job', 'history', 'chat', 'settings'] as const;

export type Route = (typeof ROUTES)[number];

/** Lê `#/rota` (ou `#/rota/param`). Desconhecida → 'overview'. */
export function getRoute(hash: string = location.hash): Route {
  const raw = hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : 'overview';
}
