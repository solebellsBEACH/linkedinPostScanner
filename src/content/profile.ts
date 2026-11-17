import type { Profile } from '../shared/types';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Cabeçalhos que também são <h2> na página de perfil (build 2026) e não são o nome.
 * Medido em /in/<slug>/: "0 notifications", "Recent entity history", "Suggested for you",
 * "Analytics", "About", "Featured", "Activity", "Profile language", "Public profile & URL".
 */
const NOISE_HEADING =
  /^(0 notifications|notifications|recent|suggested for you|analytics|featured|activity|posts|comments|documents|people you may know|who your viewers also viewed|profile language|public profile|open to work|about|sobre|skills|compet[eê]ncias|experience|experi[eê]ncia|education|forma[çc][aã]o|licen[çc]as|certifica)/i;

const NOT_HEADLINE =
  /^(open to work|show details|show all|ver tudo|\d+\s+(connections?|conex[õo]es)|\d+\s+followers?|\d+\s+seguidores)/i;

function nameCandidates(): Element[] {
  const main = document.querySelector('main');
  if (!main) return [];
  return [
    ...(main.querySelector('h1') ? [main.querySelector('h1') as Element] : []),
    ...Array.from(main.querySelectorAll('h2')),
  ];
}

/** Nome do dono do perfil. Em 2026 costuma ser um <h2>, não <h1>. */
function readName(): string {
  const titleName = clean(document.title).split('|')[0] ?? '';
  const titleUsable = titleName.length > 1 && !/^(linkedin|feed|perfil|profile)$/i.test(titleName);
  const candidates = nameCandidates();

  for (const node of candidates) {
    const text = clean(node.textContent);
    if (!text || text.length > 60 || NOISE_HEADING.test(text)) continue;
    if (titleUsable && text === titleName) return text;
  }

  for (const node of candidates) {
    const text = clean(node.textContent);
    if (!text || text.length > 60 || NOISE_HEADING.test(text)) continue;
    if (text.split(' ').length <= 5) return text;
  }

  return titleUsable ? titleName : '';
}

/** Linhas do card superior (nome, headline, localização, "open to work"…). */
function topCardLines(name: string): string[] {
  const heading = nameCandidates().find((node) => clean(node.textContent) === name) ?? null;
  const host =
    heading?.closest('section') ?? heading?.parentElement?.parentElement?.parentElement ?? null;

  return (host?.innerText ?? '')
    .split('\n')
    .map((line) => clean(line))
    .filter((line) => line.length > 0);
}

/** Aproxima a seção a partir do título e sobe até achar a lista de itens. */
function sectionWithItems(heading: Element): Element | null {
  let node: Element | null = heading;
  for (let depth = 0; depth < 6 && node; depth += 1) {
    if (node.querySelector('li')) return node;
    node = node.parentElement;
  }
  return heading.closest('section');
}

function findSectionByHeading(labels: readonly string[]): Element | null {
  const headings = document.querySelectorAll('h2, h3, h4, [role="heading"]');
  for (const heading of headings) {
    const text = normalize(heading.textContent ?? '');
    if (!labels.some((label) => text === label || text.startsWith(label))) continue;
    const section = sectionWithItems(heading);
    if (section) return section;
  }
  return null;
}

/**
 * Skills: usa a seção "Competências" quando existe; no perfil atual ela
 * frequentemente não é renderizada, então cai para a stack declarada na
 * headline e no "Sobre" — suficiente para o match por interseção de stack.
 */
function readSkills(headline: string): string[] {
  const section = findSectionByHeading(['competencias', 'skills', 'competencias e habilidades']);
  const skills: string[] = [];

  if (section) {
    const nodes = section.querySelectorAll(
      'a[href*="details/skills"], li span[aria-hidden="true"], li span, li',
    );
    for (const node of nodes) {
      const text = clean(node.textContent);
      if (text.length < 2 || text.length > 60) continue;
      if (skills.some((skill) => normalize(skill) === normalize(text))) continue;
      skills.push(text);
      if (skills.length >= 30) break;
    }
  }

  if (skills.length > 0) return skills;

  const about = findSectionByHeading(['about', 'sobre']);
  const text = `${headline} ${about ? clean(about.textContent) : ''}`;
  for (const part of text.split(/[|•·,;/]|\s{2,}/)) {
    const token = clean(part);
    if (token.length < 2 || token.length > 32) continue;
    if (/^(senior|pleno|j[úu]nior|full|stack|and|with|years?|experience|building|scalable)$/i.test(token)) {
      continue;
    }
    if (skills.some((skill) => normalize(skill) === normalize(token))) continue;
    skills.push(token);
    if (skills.length >= 24) break;
  }
  return skills;
}

/** Lê o perfil dono da página /in/<slug>/ aberta. `null` se não der para identificar. */
export function readProfile(): Profile | null {
  const name = readName();
  if (!name) return null;

  const lines = topCardLines(name);
  const isLocation = (line: string): boolean =>
    /brazil|brasil|remoto|remote/i.test(line) || /^[^|]{2,40},\s*[^,|]{2,40}$/.test(line);
  const usable = (line: string): boolean =>
    line !== name && !NOT_HEADLINE.test(line) && line.length > 5 && line.length < 180;

  const headline = lines.find((line) => usable(line) && !isLocation(line)) ?? '';
  const location = lines.find((line) => usable(line) && line !== headline && isLocation(line)) ?? '';

  return {
    name,
    headline,
    location,
    skills: readSkills(headline),
    collectedAt: Date.now(),
  };
}
