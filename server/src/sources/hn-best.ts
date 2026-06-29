/**
 * HN 기간별 베스트 어댑터 — 48h 메인(hackernews.ts, front_page)과 별개로 "기간 누적 화제"를 본다.
 * 주/월/년 창에서 점수 상위 글을 별도 best_items 로 보관(dedup·장르·요약 파이프라인 미경유).
 * Algolia 빈쿼리 기본 랭킹이 points 우선이긴 하나, points 정렬은 parseBestStories 에서 코드로 확정.
 */
export type BestPeriod = 'week' | 'month' | 'year';

/** 기간별 조회 윈도우(일). */
const PERIOD_DAYS: Record<BestPeriod, number> = {
  week: 7,
  month: 30,
  year: 365,
};

const DAY_SEC = 86400;

export interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at_i: number | null;
}

export interface BestStory {
  externalId: string;
  title: string;
  url: string; // 항상 HN 토론 페이지
  externalUrl?: string; // 외부 원문(있으면). 텍스트 글은 없음.
  author?: string;
  points: number;
  comments: number;
  createdAt: number; // epoch ms
}

/**
 * 기간별 베스트 검색 URL. cutoff = nowSec - days*86400 이후 created_at 글만,
 * tags=story 로 front_page 한정을 풀고(기간 베스트는 토론·텍스트도 포함), hitsPerPage=50 받아
 * 코드에서 points 정렬한다. `>` 는 raw 로 둔다(Algolia 가 그대로 받는다).
 */
export function buildBestSearchUrl(period: BestPeriod, nowSec: number): string {
  const cutoff = nowSec - PERIOD_DAYS[period] * DAY_SEC;
  return `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>${cutoff}&hitsPerPage=50`;
}

/**
 * Algolia 응답을 points 내림차순(null→0)으로 정렬해 상위 limit 건을 BestStory 로 매핑.
 * 제목 없는 hit 은 제외. url(원문)은 externalUrl 로, 표시 링크는 HN 토론으로.
 */
export function parseBestStories(json: { hits: AlgoliaHit[] }, limit: number): BestStory[] {
  return json.hits
    .filter((h) => h.title)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, limit)
    .map((h) => ({
      externalId: h.objectID,
      title: h.title!.trim(),
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      externalUrl: h.url ?? undefined,
      author: h.author ?? undefined,
      points: h.points ?? 0,
      comments: h.num_comments ?? 0,
      createdAt: (h.created_at_i ?? 0) * 1000,
    }));
}

/** 한 기간의 베스트를 실제로 수집(네트워크). 실패는 호출부에서 격리. */
export async function fetchBestStories(
  period: BestPeriod,
  nowSec: number,
  limit: number,
): Promise<BestStory[]> {
  const res = await fetch(buildBestSearchUrl(period, nowSec), {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HN best(${period}) HTTP ${res.status}`);
  const json = (await res.json()) as { hits: AlgoliaHit[] };
  return parseBestStories(json, limit);
}
