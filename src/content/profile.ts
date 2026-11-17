import type { Profile } from '../shared/types';

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function findSectionByHeading(labels: readonly string[]): Element | null {
  const headings = document.querySelectorAll('h2, h3, [role="heading"]');
  for (const heading of headings) {
    const text = normalize(heading.textContent ?? '');
    if (!labels.some((label) => text === label || text.startsWith(label))) continue;
    const section = heading.closest('section') ?? heading.parentElement?.parentElement;
    if (section) return section;
  }
  return null;
}

function readSkills(): string[] {
  const section = findSectionByHeading(['competencias', 'skills', 'competencias e habilidades']);
  if (!section) return [];

  const nodes = section.querySelectorAll('a[href*="details/skills"], li span[aria-hidden="true"], li span');
  const skills: string[] = [];
  for (const node of nodes) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 60) continue;
    if (skills.some((s) => normalize(s) === normalize(text))) continue;
    skills.push(text);
    if (skills.length >= 30) break;
  }
  return skills;
}

/** Lê o perfil dono da página /in/<slug>/ aberta. `null` se não der para identificar. */
export function readProfile(): Profile | null {
  const heading = document.querySelector('main h1');
  const name = (heading?.textContent ?? '').replace(/\s+/g, ' ').trim();

  if (!name) return null;

  const top = heading?.closest('section') ?? heading?.parentElement ?? null;
  const lines = (top?.innerText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const headline = lines.find((line) => line !== name && line.length > 3 && line.length < 160) ?? '';
  const location =
    lines.find((line) => /brazil|brasil/i.test(line) || /,\s*[A-Z]{2}\b/.test(line)) ?? '';

  return {
    name,
    headline,
    location,
    skills: readSkills(),
    collectedAt: Date.now(),
  };
}
