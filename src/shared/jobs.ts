import type { Job, Post, Profile } from './types';

/** Termos que indicam vaga (pt + en). */
const JOB_SIGNAL =
  /\b(vagas?|contratando|contrata[çc][aã]o|contratar|hiring|hire|oportunidade|opportunity|remoto|remote|h[íi]brido|presencial|clt|pj|freelance|easy apply|est[áa]gio|internship|junior|j[úu]nior|pleno|mid|senior|s[êe]nior)\b/i;

/** Stacks reconhecidas (normalizadas, sem espaço/pontuação). */
const STACK_TERMS: readonly string[] = [
  'react',
  'reactnative',
  'next',
  'nextjs',
  'angular',
  'vue',
  'nuxt',
  'svelte',
  'node',
  'nodejs',
  'nestjs',
  'express',
  'fastify',
  'typescript',
  'javascript',
  'python',
  'django',
  'flask',
  'java',
  'spring',
  'kotlin',
  'golang',
  'go',
  'rust',
  'csharp',
  'dotnet',
  'php',
  'laravel',
  'ruby',
  'rails',
  'elixir',
  'aws',
  'azure',
  'gcp',
  'docker',
  'kubernetes',
  'terraform',
  'sql',
  'postgres',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'graphql',
  'rest',
  'tailwind',
  'sass',
  'jest',
  'cypress',
  'playwright',
  'figma',
  'flutter',
  'reactnative',
];

/** Sinônimos → forma canônica. */
const SYNONYMS: Record<string, string> = {
  reactjs: 'react',
  reactnative: 'reactnative',
  'react native': 'reactnative',
  'next.js': 'nextjs',
  next: 'nextjs',
  'node.js': 'nodejs',
  node: 'nodejs',
  nest: 'nestjs',
  ts: 'typescript',
  js: 'javascript',
  'c#': 'csharp',
  '.net': 'dotnet',
  net: 'dotnet',
  golang: 'go',
  postgres: 'postgresql',
  k8s: 'kubernetes',
  tf: 'terraform',
};

export function normalizeSkill(value: string): string {
  const clean = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9#+. ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = clean.replace(/[ .]/g, '');
  return SYNONYMS[clean] ?? SYNONYMS[compact] ?? compact;
}

/** Stacks citadas no texto, na ordem em que aparecem. */
export function detectStack(text: string): string[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9#+. ]/g, ' ').replace(/\s+/g, ' ')} `;
  const found: string[] = [];

  for (const term of STACK_TERMS) {
    const needle = term.includes(' ') ? term : term;
    if (haystack.includes(` ${needle} `) || haystack.includes(` ${needle},`) || haystack.includes(` ${needle}.`)) {
      const canonical = normalizeSkill(term);
      if (!found.includes(canonical)) found.push(canonical);
    }
  }

  // termos com espaço (react native) são checados separadamente
  if (haystack.includes(' react native ') && !found.includes('reactnative')) found.push('reactnative');

  return found;
}

export function looksLikeJob(post: Post): boolean {
  const text = `${post.text} ${post.authorHeadline}`;
  if (!JOB_SIGNAL.test(text)) return false;
  return detectStack(text).length > 0;
}

/**
 * Percentual de aderência entre a stack da vaga e as skills do perfil.
 * `null` quando a vaga não declara stack.
 */
export function computeMatch(stack: readonly string[], skills: readonly string[]): number | null {
  if (stack.length === 0) return null;
  if (skills.length === 0) return null;

  const profile = new Set(skills.map(normalizeSkill).filter((s) => s.length > 0));
  let hits = 0;
  for (const item of stack) {
    if (profile.has(normalizeSkill(item))) hits += 1;
  }
  return Math.round((hits / stack.length) * 100);
}

export type DraftJob = {
  title: string;
  company: string;
  loc: string;
  mode: Job['mode'];
  stack: string[];
  easyApply: boolean;
  post: Post;
};

/** Converte o rascunho vindo da IA/heurística num Job persistível. */
export function toJob(draft: DraftJob, profile: Profile | undefined, index: number): Job {
  const stack = draft.stack.map(normalizeSkill).filter((s) => s.length > 0);
  return {
    id: `${draft.post.activityId}:${index}`,
    title: draft.title.trim() || 'Vaga sem título',
    company: draft.company.trim() || draft.post.author || 'Empresa não informada',
    loc: draft.loc.trim() || 'Não informado',
    mode: draft.mode,
    stack,
    posted: draft.post.postedAt || '',
    easyApply: draft.easyApply,
    url: draft.post.url,
    sourceActivityId: draft.post.activityId,
    match: computeMatch(stack, profile?.skills ?? []),
  };
}

export function normalizeMode(raw: string): Job['mode'] {
  const value = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (value.includes('remot')) return 'remoto';
  if (value.includes('hibrid')) return 'híbrido';
  return 'presencial';
}
