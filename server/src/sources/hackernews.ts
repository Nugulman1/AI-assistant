import type { SourceRow } from '../db.js';
import type { Candidate } from './index.js';
import { extractText } from './text.js';

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at_i: number | null;
  story_text: string | null;
}

/**
 * Hacker News 어댑터 — Algolia front_page API 한 번 호출로 점수·댓글(화제도 신호) 확보.
 * 링크는 항상 HN 토론 페이지로(외부 원문 대신 댓글 토론을 본다).
 * Ask/Show 텍스트 글의 story_text 는 본문으로 실어 요약에 쓴다.
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
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author ?? undefined,
      score: h.points ?? 0,
      comments: h.num_comments ?? 0,
      publishedAt: h.created_at_i ? h.created_at_i * 1000 : undefined,
      body: extractText(h.story_text),
      externalUrl: h.url ?? undefined, // 외부 링크 글의 원문(본문 크롤링용). 텍스트 글은 없음.
    }) satisfies Candidate);
}
