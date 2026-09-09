import Parser from 'rss-parser';
import { FETCH_TIMEOUT_MS, USER_AGENT, WINDOW_MS } from './http.js';
import type { Candidate, SourceConfig } from './index.js';

const MAX_PER_SOURCE = 20;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
});

export async function fetchRss(cfg: Extract<SourceConfig, { type: 'rss' }>, now: number): Promise<Candidate[]> {
  const feed = await parser.parseURL(cfg.url);
  const out: Candidate[] = [];
  for (const item of feed.items ?? []) {
    const raw = item.isoDate ?? item.pubDate;
    if (!raw || !item.link) continue;
    const publishedAt = Date.parse(raw);
    if (Number.isNaN(publishedAt) || publishedAt < now - WINDOW_MS) continue;
    out.push({
      sourceName: cfg.name,
      title: item.title?.trim() || '(제목 없음)',
      url: item.link.trim(),
      publishedAt,
    });
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_PER_SOURCE);
}
