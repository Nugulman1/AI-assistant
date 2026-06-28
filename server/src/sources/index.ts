import type { SourceRow } from '../db.js';
import { fetchRss } from './rss.js';
import { fetchHackerNews } from './hackernews.js';
import { fetchReddit } from './reddit.js';

/** 모든 소스가 공통으로 내놓는 수집 후보. 화제도 원신호는 score/comments. */
export interface Candidate {
  sourceId: number;
  sourceName: string;
  externalId?: string;
  title: string;
  url: string;
  author?: string;
  score: number; // HN/Reddit 점수, RSS 는 0
  comments: number;
  publishedAt?: number; // epoch ms
  body?: string; // 본문/초록 발췌 (있으면 요약을 제목 아닌 본문 기반으로)
  externalUrl?: string; // 표시 url 과 별개인 원문 주소(HN 토론링크의 외부 원문 등). 본문 크롤링용.
}

/** 소스 한 개에서 후보들을 수집. 실패해도 빈 배열로 격리(한 소스 죽어도 전체 안 죽게). */
export async function collectFromSource(src: SourceRow): Promise<Candidate[]> {
  try {
    switch (src.type) {
      case 'rss':
        return await fetchRss(src);
      case 'hackernews':
        return await fetchHackerNews(src);
      case 'reddit':
        return await fetchReddit(src);
      default:
        return [];
    }
  } catch (err) {
    console.warn(`[collect] 소스 "${src.name}" 수집 실패:`, (err as Error).message);
    return [];
  }
}

/** 활성 소스 전체를 병렬 수집해 후보를 합친다. */
export async function collectAll(sources: SourceRow[]): Promise<Candidate[]> {
  const batches = await Promise.all(sources.map((s) => collectFromSource(s)));
  return batches.flat();
}
