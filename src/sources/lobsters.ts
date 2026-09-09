import { fetchJson, WINDOW_MS } from './http.js';
import type { Candidate, SourceConfig } from './index.js';

interface LobstersStory {
  title: string;
  url: string;
  comments_url: string;
  score: number;
  created_at: string;
}

export async function fetchLobsters(
  cfg: Extract<SourceConfig, { type: 'lobsters' }>,
  now: number,
): Promise<Candidate[]> {
  const stories = await fetchJson<LobstersStory[]>('https://lobste.rs/hottest.json');
  const out: Candidate[] = [];
  for (const s of stories) {
    const publishedAt = Date.parse(s.created_at);
    if (Number.isNaN(publishedAt) || publishedAt < now - WINDOW_MS) continue;
    if (s.score < cfg.minScore) continue;
    out.push({
      sourceName: cfg.name,
      title: s.title?.trim() || '(제목 없음)',
      url: s.url || s.comments_url,
      publishedAt,
      score: s.score,
    });
  }
  return out;
}
