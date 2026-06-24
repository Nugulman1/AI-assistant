import type { SourceRow } from '../db.js';
import type { Candidate } from './index.js';

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at_i: number | null;
}

/**
 * Hacker News 어댑터 — Algolia front_page API 한 번 호출로 점수·댓글(화제도 신호) 확보.
 * url 이 없는 Ask/Show 텍스트 글은 HN 토론 페이지로 대체.
 */
export async function fetchHackerNews(src: SourceRow): Promise<Candidate[]> {
  const res = await fetch(
    'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40',
    { signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`HN HTTP ${res.status}`);
  const data = (await res.json()) as { hits: AlgoliaHit[] };
  return data.hits
    .filter((h) => h.title)
    .map((h) => ({
      sourceId: src.id,
      sourceName: src.name,
      externalId: h.objectID,
      title: h.title!.trim(),
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author ?? undefined,
      score: h.points ?? 0,
      comments: h.num_comments ?? 0,
      publishedAt: h.created_at_i ? h.created_at_i * 1000 : undefined,
    }) satisfies Candidate);
}
