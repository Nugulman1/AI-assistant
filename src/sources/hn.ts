import { fetchJson, WINDOW_MS } from './http.js';
import type { Candidate, SourceConfig } from './index.js';

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  created_at_i: number;
}

export async function fetchHn(cfg: Extract<SourceConfig, { type: 'hn' }>, now: number): Promise<Candidate[]> {
  const since = Math.floor((now - WINDOW_MS) / 1000);
  // numericFilters 의 '>' 는 반드시 퍼센트 인코딩해야 한다 — 날것으로 보내면 400.
  const params = new URLSearchParams({
    tags: 'story',
    numericFilters: `points>=${cfg.minPoints},created_at_i>=${since}`,
    hitsPerPage: '100',
  });
  const data = await fetchJson<{ hits: AlgoliaHit[] }>(
    `https://hn.algolia.com/api/v1/search_by_date?${params}`,
  );
  return data.hits.map((h) => ({
    sourceName: cfg.name,
    title: h.title?.trim() || '(제목 없음)',
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    publishedAt: h.created_at_i * 1000,
    hn: { id: h.objectID, points: h.points ?? 0, comments: h.num_comments ?? 0 },
  }));
}
