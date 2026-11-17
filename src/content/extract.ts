import type { Post } from '../shared/types';

const ACTIVITY_IN_HREF = /\/feed\/update\/urn:li:activity:(\d+)/;
const ANY_ACTIVITY = /urn:li:activity:(\d+)/;

export type ExtractResult = { posts: Post[]; unrecognized: number };

/** Extrai o activityId de um href do LinkedIn. */
export function activityIdFromHref(href: string): string | null {
  const match = ACTIVITY_IN_HREF.exec(href) ?? ANY_ACTIVITY.exec(href);
  return match?.[1] ?? null;
}

/**
 * Converte contadores do LinkedIn em número.
 * Aceita `1.234`, `1,234`, `1,2 mil`, `1.2K`, `412`, `3 mi`.
 */
export function parseCount(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const match = /^([\d.,]+)\s*(mil|milhão|milhões|k|m|mi)?$/.exec(text);
  if (!match) return null;

  const digits = match[1];
  const unit = match[2];
  if (!digits) return null;

  const hasComma = digits.includes(',');
  const hasDot = digits.includes('.');
  let normalized = digits;

  if (unit) {
    // `1,2 mil` / `1,2 mi` / `1.2K`
    normalized = digits.replace(',', '.');
  } else if (hasComma && hasDot) {
    normalized =
      digits.lastIndexOf(',') > digits.lastIndexOf('.')
        ? digits.replace(/\./g, '').replace(',', '.')
        : digits.replace(/,/g, '');
  } else if (hasComma) {
    const tail = digits.split(',')[1] ?? '';
    normalized = tail.length === 3 ? digits.replace(',', '') : digits.replace(',', '.');
  } else if (hasDot) {
    const tail = digits.split('.')[1] ?? '';
    normalized = tail.length === 3 ? digits.replace(/\./g, '') : digits;
  }

  const multiplier = unit === 'mil' || unit === 'k' ? 1_000 : unit ? 1_000_000 : 1;
  const value = Number(normalized) * multiplier;
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function countFromText(text: string, nouns: readonly string[]): number {
  for (const noun of nouns) {
    const re = new RegExp(`(\\d[\\d.,]*\\s*(?:mil|milh\\w*|k|m|mi)?)\\s*${noun}`, 'i');
    const match = re.exec(text);
    const raw = match?.[1];
    if (raw) {
      const parsed = parseCount(raw);
      if (parsed !== null) return parsed;
    }
  }
  return 0;
}

/** Marcadores do item virtualizado que envolve um post. */
const CARD_ROOT = '[data-lazy-mount-id],[data-virtualized-item],[data-testid="main-feed-card"]';
const POST_TEXT_BOX = '[data-testid="expandable-text-box"]';
const POST_MENU =
  'button[aria-label^="Open control menu for post by"],button[aria-label^="Abrir menu de controle da publicação de"]';
const REACTION_STATE =
  '[aria-label^="Reaction button state"],[aria-label^="Estado do botão de reação"]';
/** Elementos que carregam o URN da atividade (link do post, comentário, componente). */
const URN_HOLDERS =
  'a[href*="urn:li:activity:"],[componentkey*="urn:li:activity:"],[id*="urn:li:activity:"],[data-urn*="urn:li:activity:"]';

/** Sobe do corpo do texto até o item virtualizado que representa o post. */
function cardFromBody(body: Element): HTMLElement | null {
  let node: Element | null = body;
  for (let depth = 0; depth < 14 && node; depth += 1) {
    if (node instanceof HTMLElement && node.matches(CARD_ROOT)) return node;
    node = node.parentElement;
  }
  return null;
}

/** Diferencia post de comentário: só post tem menu "post by" ou botão de reação. */
function isPostCard(card: HTMLElement): boolean {
  return card.querySelector(POST_MENU) !== null || card.querySelector(REACTION_STATE) !== null;
}

function shortHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Resolve o id do post. Em 2026 a maioria dos cards não linka o próprio URN:
 * o link de atividade aparece em poucos posts, então caímos para URNs de
 * comentários/componentes dentro do card e, por último, para um hash estável.
 */
function idForCard(card: HTMLElement, author: string, text: string): string {
  for (const el of Array.from(card.querySelectorAll(URN_HOLDERS))) {
    const raw =
      el.getAttribute('href') ?? el.getAttribute('componentkey') ?? el.getAttribute('data-urn') ?? el.id ?? '';
    const match = ANY_ACTIVITY.exec(raw);
    if (match?.[1]) return match[1];
  }
  const key = card.getAttribute('componentkey') ?? card.getAttribute('data-lazy-mount-id') ?? '';
  if (key) return `ck:${key}`;
  return `h:${shortHash(`${author}|${text.slice(0, 120)}`)}`;
}

/** Cards de post montados agora, já com o id resolvido (um por post). */
function collectCards(container: ParentNode): { id: string; card: HTMLElement }[] {
  const out: { id: string; card: HTMLElement }[] = [];
  const ids = new Set<string>();
  for (const body of Array.from(container.querySelectorAll(POST_TEXT_BOX))) {
    const card = cardFromBody(body);
    if (!card || !isPostCard(card)) continue;
    const text = textOf(body);
    if (!text) continue;
    const id = idForCard(card, readAuthor(card), text);
    if (ids.has(id)) continue;
    ids.add(id);
    out.push({ id, card });
  }
  return out;
}

function readAuthor(card: HTMLElement): string {
  const menuButton = card.querySelector(
    'button[aria-label^="Open control menu for post by"],button[aria-label^="Abrir menu de controle da publicação de"]',
  );
  const label = menuButton?.getAttribute('aria-label') ?? '';
  const fromLabel = /(?:post by|publicação de)\s+(.+)$/i.exec(label)?.[1];
  if (fromLabel?.trim()) return fromLabel.trim();

  const profileLink = card.querySelector('a[href*="/in/"]');
  const fromLink = textOf(profileLink);
  if (fromLink) return fromLink;

  return '';
}

function readHeadline(card: HTMLElement, author: string): string {
  const profileLink = card.querySelector('a[href*="/in/"]');
  const block = profileLink?.parentElement?.parentElement ?? profileLink?.parentElement ?? null;
  const raw = textOf(block);
  if (!raw) return '';

  return raw
    .replace(author, '')
    .replace(/^[\s•·|]+/, '')
    .split('•')
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
    .slice(0, 2)
    .join(' · ')
    .slice(0, 180);
}

function readPostedAt(card: HTMLElement, author: string): string {
  const header = textOf(card).slice(0, 400);
  const re =
    /(\d+)\s*(min|mins|minuto|minutos|m|h|hora|horas|hrs?|d|dia|dias|sem|semana|semanas|m[êe]s|meses|ano|anos|y|yr|yrs|w|wk|wks|mo)\b/i;
  const match = re.exec(header.replace(author, ''));
  return match?.[0] ?? '';
}

async function expandIfTruncated(card: HTMLElement): Promise<boolean> {
  const button = card.querySelector<HTMLElement>('[data-testid="expandable-text-button"]');
  if (!button) return false;
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return true;
}

function readPost(activityId: string, card: HTMLElement, expanded: boolean): Post | null {
  const text = textOf(card.querySelector('[data-testid="expandable-text-box"]'));
  if (!text) return null;

  const flat = textOf(card);
  const author = readAuthor(card);
  const href =
    card.querySelector<HTMLAnchorElement>('a[href*="urn:li:activity:"]')?.href ??
    (/^\d+$/.test(activityId) ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/` : '');

  const hasVideo = card.querySelector('video, [data-testid="video-player"]') !== null;
  const hasImage = card.querySelector('img[src*="dms/image"], img[src*="media"]') !== null;

  return {
    activityId,
    author,
    authorHeadline: readHeadline(card, author),
    text,
    reactions: countFromText(flat, ['reaç\\w*', 'reaction\\w*']),
    comments: countFromText(flat, ['coment\\w*', 'comment\\w*']),
    reposts: countFromText(flat, ['repost\\w*', 'compartilh\\w*', 'republic\\w*']),
    postedAt: readPostedAt(card, author),
    collectedAt: Date.now(),
    isSponsored: /\b(promovido|sponsored)\b/i.test(flat),
    isRepost: /\b(repostou|reposted)\b/i.test(flat),
    mediaType: hasVideo ? 'video' : hasImage ? 'image' : 'none',
    url: href,
    expanded,
  };
}

function findCardById(container: ParentNode, activityId: string): HTMLElement | null {
  return collectCards(container).find((entry) => entry.id === activityId)?.card ?? null;
}

/**
 * Lê todos os posts montados no container.
 * `seen` evita reprocessar (a lista é virtualizada e recicla nós).
 */
export async function extractPosts(container: ParentNode, seen: Set<string>): Promise<ExtractResult> {
  const posts: Post[] = [];
  let unrecognized = 0;

  for (const { id, card } of collectCards(container)) {
    if (seen.has(id)) continue;
    const expanded = await expandIfTruncated(card);
    // A expansão re-renderiza o nó: relê o card atual antes de extrair.
    const fresh = expanded ? (findCardById(container, id) ?? card) : card;
    const post = readPost(id, fresh, expanded);
    // Marca como visto mesmo quando falha: sem isso o post travaria o loop.
    seen.add(id);
    if (!post) {
      unrecognized += 1;
      continue;
    }
    posts.push(post);
  }

  return { posts, unrecognized };
}

/** ids dos posts montados agora (para medir progresso sem extrair). */
export function visibleActivityIds(container: ParentNode): Set<string> {
  return new Set(collectCards(container).map((entry) => entry.id));
}
