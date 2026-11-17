export type Post = {
  activityId: string;
  author: string;
  authorHeadline: string;
  text: string;
  reactions: number;
  comments: number;
  reposts: number;
  postedAt: string;
  collectedAt: number;
  isSponsored: boolean;
  isRepost: boolean;
  mediaType: 'none' | 'image' | 'video';
  url: string;
  expanded: boolean;
};

export type Job = {
  id: string;
  title: string;
  company: string;
  loc: string;
  mode: 'remoto' | 'híbrido' | 'presencial';
  stack: string[];
  posted: string;
  easyApply: boolean;
  url: string;
  sourceActivityId: string;
  match: number | null;
};

export type Profile = {
  name: string;
  headline: string;
  location: string;
  skills: string[];
  collectedAt: number;
};

export type Analysis = {
  id: string;
  kind: 'resume' | 'prompt';
  query?: string;
  createdAt: number;
  postCount: number;
  unrecognized: number;
  topics: { name: string; count: number }[];
  bullets: { text: string; refs: string[] }[];
  jobs: Job[];
};

export type HistoryEntry = {
  id: string;
  analysisId: string;
  kind: 'resume' | 'prompt';
  title: string;
  meta: string;
  createdAt: number;
};

export type Settings = {
  theme: 'light' | 'dark';
  provider: 'anthropic' | 'openai' | 'gemini' | 'groq' | 'ollama';
  model: string;
  maxRounds: number;
  maxMinutes: number;
  delayMinMs: number;
  delayMaxMs: number;
};
