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

/** Encontra o card do post caminhando a partir do link do post. */
function findCard(anchor: Element): HTMLElement | null {
  let node: Element | null = anchor;
  let best: HTMLElement | null = null;

  for (let depth = 0; depth < 12 && node; depth += 1) {
    const el = node as HTMLElement;
    if (depth > 0 && el.querySelector('[data-testid="expandable-text-box"]')) {
      best = el;
      const hasChrome =
        el.hasAttribute('data-virtualized-item') ||
        el.hasAttribute('data-lazy-mount-id') ||
        el.hasAttribute('componentkey') ||
        el.querySelector('button[aria-label^="Open control menu"]') !== null ||
        el.querySelector('button[aria-label^="Abrir menu de controle"]') !== null;
      if (hasChrome) return el;
    }
    node = el.parentElement;
  }
  return best;
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
    `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`;

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

/**
 * Lê todos os posts montados no container.
 * `seen` evita reprocessar (a lista é virtualizada e recicla nós).
 */
export async function extractPosts(container: ParentNode, seen: Set<string>): Promise<ExtractResult> {
  const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href*="urn:li:activity:"]'));
  const byId = new Map<string, HTMLElement>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') ?? '';
    const id = activityIdFromHref(href);
    if (!id || seen.has(id) || byId.has(id)) continue;
    const card = findCard(anchor);
    if (card) byId.set(id, card);
  }

  const posts: Post[] = [];
  let unrecognized = 0;

  for (const [id, card] of byId) {
    const expanded = await expandIfTruncated(card);
    const post = readPost(id, card, expanded);
    if (!post) {
      unrecognized += 1;
      continue;
    }
    seen.add(id);
    posts.push(post);
  }

  return { posts, unrecognized };
}

/** activityIds presentes no DOM agora (para medir progresso sem extrair). */
export function visibleActivityIds(container: ParentNode): Set<string> {
  const ids = new Set<string>();
  for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href*="urn:li:activity:"]')) {
    const id = activityIdFromHref(anchor.getAttribute('href') ?? '');
    if (id) ids.add(id);
  }
  return ids;
}
