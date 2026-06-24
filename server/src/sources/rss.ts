import Parser from 'rss-parser';
import type { SourceRow } from '../db.js';
import type { Candidate } from './index.js';

const parser = new Parser({ timeout: 15000 });

/** RSS/Atom 통합 수집. 점수 신호 없음(화제도=0) → z-정규화에서 소스 내 동률 처리됨. */
export async function fetchRss(src: SourceRow): Promise<Candidate[]> {
  const feed = await parser.parseURL(src.url);
  const items = feed.items ?? [];
  return items.slice(0, 30).map((it) => {
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
    } satisfies Candidate;
  }).filter((c) => c.url);
}
