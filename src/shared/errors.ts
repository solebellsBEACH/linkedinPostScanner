/** Catálogo de erros — docs/SPEC.md §11. A ordem segue a tabela da spec. */
export const ERROR_CODES = [
  'SCROLL_NOT_FEED',
  'SCROLL_AUTH',
  'SCROLL_STALLED',
  'DOM_CHANGED',
  'SUMMARY_EMPTY',
  'SUMMARY_TOO_FEW',
  'PROMPT_EMPTY',
  'PROMPT_NO_RESULTS',
  'PROFILE_UNREADABLE',
  'AI_NO_KEY',
  'AI_401',
  'AI_429',
  'AI_TIMEOUT',
  'AI_LOCAL_OFFLINE',
  'AI_BAD_OUTPUT',
  'NETWORK_OFFLINE',
  'EXT_UNAVAILABLE',
  'VERSION_MISMATCH',
  'STORAGE_FULL',
  'DATA_CORRUPT',
  'CHAT_FAILED',
  'CHAT_NO_CORPUS',
  'JOB_CLOSED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorArea = 'Scroll' | 'Resumo' | 'Prompt' | 'IA' | 'Conexão' | 'Dashboard';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'AppError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export const ERROR_META: Record<ErrorCode, { area: ErrorArea; title: string }> = {
  SCROLL_NOT_FEED: { area: 'Scroll', title: 'Abra o feed do LinkedIn para começar' },
  SCROLL_AUTH: { area: 'Scroll', title: 'Você não está conectado ao LinkedIn' },
  SCROLL_STALLED: { area: 'Scroll', title: 'O feed parou de carregar novos posts' },
  DOM_CHANGED: { area: 'Scroll', title: 'O LinkedIn mudou o layout da página' },
  SUMMARY_EMPTY: { area: 'Resumo', title: 'Nenhum post coletado ainda' },
  SUMMARY_TOO_FEW: { area: 'Resumo', title: 'Poucos posts para um resumo útil' },
  PROMPT_EMPTY: { area: 'Prompt', title: 'Escreva uma pergunta antes de enviar' },
  PROMPT_NO_RESULTS: { area: 'Prompt', title: 'Nenhum post corresponde à sua pergunta' },
  PROFILE_UNREADABLE: { area: 'Prompt', title: 'Não foi possível ler seu perfil' },
  AI_NO_KEY: { area: 'IA', title: 'Nenhuma chave de IA configurada' },
  AI_401: { area: 'IA', title: 'A chave de IA foi recusada' },
  AI_429: { area: 'IA', title: 'Limite de uso do provedor atingido' },
  AI_TIMEOUT: { area: 'IA', title: 'A IA demorou demais para responder' },
  AI_LOCAL_OFFLINE: { area: 'IA', title: 'O Ollama local não está respondendo' },
  AI_BAD_OUTPUT: { area: 'IA', title: 'A IA devolveu uma resposta inválida' },
  NETWORK_OFFLINE: { area: 'Conexão', title: 'Sem conexão com a internet' },
  EXT_UNAVAILABLE: { area: 'Dashboard', title: 'A extensão não está respondendo' },
  VERSION_MISMATCH: { area: 'Dashboard', title: 'Versão dos dados incompatível com a extensão' },
  STORAGE_FULL: { area: 'Dashboard', title: 'Armazenamento local cheio' },
  DATA_CORRUPT: { area: 'Dashboard', title: 'Esta análise está corrompida' },
  CHAT_FAILED: { area: 'Dashboard', title: 'Não foi possível responder no chat' },
  CHAT_NO_CORPUS: { area: 'Dashboard', title: 'Nenhum post salvo para conversar' },
  JOB_CLOSED: { area: 'Dashboard', title: 'Esta vaga não está mais disponível' },
};
