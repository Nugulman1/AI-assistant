import { createHash } from 'node:crypto';
import type { Item } from './items.js';
import type { Candidate } from './sources/index.js';

/** firstSeenAt 이 아직 없는 Item — 호출자(applyToExisting)가 채운다. */
export type MergedItem = Omit<Item, 'firstSeenAt'>;

const TRACKING_PARAMS = new Set(['ref', 'ref_src', 'fbclid', 'gclid', 'igshid']);

/** 해시·트래킹 쿼리 제거, 호스트 소문자, 끝 슬래시 제거. URL 파싱이 안 되면 trim 만. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith('utm_') || key.startsWith('mc_')) u.searchParams.delete(key);
    }
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    const s = u.toString();
    return u.search ? s : s.replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

/** 소문자·영숫자·한글만 남긴 80자 — 다른 URL 로 올라온 같은 글을 잡는 보조 키. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 80);
}

export function itemId(url: string): string {
  return createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12);
}

export function isHnDiscussion(url: string): boolean {
  try {
    return new URL(url).hostname === 'news.ycombinator.com';
  } catch {
    return false;
  }
}

/** HN 토론 링크보다 외부 원문을 우선. */
export function preferUrl(current: string, incoming: string): string {
  return isHnDiscussion(current) && !isHnDiscussion(incoming) ? incoming : current;
}

export function preferHn(a: Item['hn'], b: Item['hn']): Item['hn'] {
  if (!a) return b;
  if (!b) return a;
  return b.points > a.points ? b : a;
}

export function unionSources(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const s of b) if (!out.includes(s)) out.push(s);
  return out;
}

function maxScore(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

interface Group {
  title: string;
  url: string;
  sources: string[];
  hn?: Item['hn'];
  score?: number;
  publishedAt: number;
}

/** 같은 정규화 URL 또는 같은 titleKey 인 후보를 한 건으로 묶는다. */
export function mergeCandidates(cands: Candidate[]): MergedItem[] {
  const groups: Group[] = [];
  const byUrl = new Map<string, Group>();
  const byTitle = new Map<string, Group>();

  for (const c of cands) {
    const nu = normalizeUrl(c.url);
    const tk = titleKey(c.title);
    let g = byUrl.get(nu) ?? (tk ? byTitle.get(tk) : undefined);
    if (g) {
      g.sources = unionSources(g.sources, [c.sourceName]);
      g.url = preferUrl(g.url, c.url);
      g.hn = preferHn(g.hn, c.hn);
      g.score = maxScore(g.score, c.score);
      g.publishedAt = Math.min(g.publishedAt, c.publishedAt);
    } else {
      g = { title: c.title, url: c.url, sources: [c.sourceName], hn: c.hn, score: c.score, publishedAt: c.publishedAt };
      groups.push(g);
    }
    byUrl.set(nu, g);
    if (tk) byTitle.set(tk, g);
  }

  return groups.map((g) => {
    const item: MergedItem = {
      id: itemId(g.url),
      title: g.title,
      url: g.url,
      sources: g.sources,
      publishedAt: new Date(g.publishedAt).toISOString(),
    };
    if (g.hn) item.hn = g.hn;
    if (g.score !== undefined) item.score = g.score;
    return item;
  });
}
