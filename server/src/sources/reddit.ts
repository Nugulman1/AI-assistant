import type { SourceRow } from '../db.js';
import type { Candidate } from './index.js';

interface RedditChild {
  data: {
    id: string;
    title: string;
    url: string;
    author: string;
    ups: number;
    num_comments: number;
    created_utc: number;
    permalink: string;
    stickied: boolean;
  };
}

/**
 * Reddit 어댑터 — r/<sub>/hot.json. ups·num_comments = 화제도 신호.
 * Reddit 은 User-Agent 없으면 차단하므로 명시.
 */
export async function fetchReddit(src: SourceRow): Promise<Candidate[]> {
  const sub = src.url.replace(/^r\//, '');
  const res = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=30`, {
    headers: { 'User-Agent': 'dev-news-briefing/1.0 (personal use)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  const data = (await res.json()) as { data: { children: RedditChild[] } };
  return data.data.children
    .map((c) => c.data)
    .filter((d) => !d.stickied)
    .map((d) => ({
      sourceId: src.id,
      sourceName: src.name,
      externalId: d.id,
      title: d.title.trim(),
      // 셀프포스트면 외부 url 이 reddit 으로 잡힘 → 댓글 토론 링크로 통일
      url: d.url && !d.url.includes('reddit.com') ? d.url : `https://www.reddit.com${d.permalink}`,
      author: d.author,
      score: d.ups ?? 0,
      comments: d.num_comments ?? 0,
      publishedAt: d.created_utc ? d.created_utc * 1000 : undefined,
    }) satisfies Candidate);
}
