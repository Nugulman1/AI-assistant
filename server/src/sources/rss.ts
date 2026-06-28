import Parser from 'rss-parser';
import type { SourceRow } from '../db.js';
import type { Candidate } from './index.js';
import { extractText } from './text.js';

const parser = new Parser({ timeout: 15000 });

const DAY = 24 * 60 * 60 * 1000;

/**
 * RSS/Atom 통합 수집. 점수 신호 없음(화제도=0) → z-정규화에서 소스 내 동률 처리됨.
 * 피드 원순서가 아니라 **발행시각 내림차순 정렬 → 48h 컷 → 소스당 50건** 으로 상한.
 * Date.parse 가 NaN 인(발행시각 불명) 항목은 컷에서 자연 탈락한다.
 */
export async function fetchRss(src: SourceRow): Promise<Candidate[]> {
  const feed = await parser.parseURL(src.url);
  const items = feed.items ?? [];
  const cutoff = Date.now() - 2 * DAY;
  return items
    .map((it) => {
      const published = it.isoDate ?? it.pubDate;
      return {
        sourceId: src.id,
        sourceName: src.name,
        externalId: it.guid ?? it.link ?? it.title,
        title: (it.title ?? '(제목 없음)').trim(),
        url: it.link ?? '',
        author: it.creator ?? (it as { author?: string }).author,
        score: 0,
        comments: 0,
        publishedAt: published ? Date.parse(published) : undefined,
        // arXiv 초록·블로그 본문이 피드에 이미 들어있다 — 평문으로 실어 요약에 쓴다.
        body: extractText(it.contentSnippet ?? it.content),
      } satisfies Candidate;
    })
    .filter((c) => c.url && c.publishedAt != null && !Number.isNaN(c.publishedAt) && c.publishedAt >= cutoff)
    .sort((a, b) => b.publishedAt! - a.publishedAt!)
    .slice(0, 50);
}
