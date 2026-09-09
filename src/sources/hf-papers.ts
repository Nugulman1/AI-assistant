import { fetchJson, WINDOW_MS } from './http.js';
import type { Candidate, SourceConfig } from './index.js';

/** daily_papers 응답 한 항목. 최상위 publishedAt 이 데일리 게재일, paper 안에 id·upvotes. */
interface DailyPaper {
  publishedAt: string;
  title: string;
  paper: { id: string; title: string; upvotes: number };
}

export async function fetchHfPapers(
  cfg: Extract<SourceConfig, { type: 'hf-papers' }>,
  now: number,
): Promise<Candidate[]> {
  const papers = await fetchJson<DailyPaper[]>('https://huggingface.co/api/daily_papers?limit=50');
  return papers
    .map((p) => ({ p, publishedAt: Date.parse(p.publishedAt) }))
    .filter(({ publishedAt }) => !Number.isNaN(publishedAt) && publishedAt >= now - WINDOW_MS)
    .sort((a, b) => (b.p.paper.upvotes ?? 0) - (a.p.paper.upvotes ?? 0))
    .slice(0, cfg.top)
    .map(({ p, publishedAt }) => ({
      sourceName: cfg.name,
      title: (p.title || p.paper.title)?.trim() || '(제목 없음)',
      url: `https://huggingface.co/papers/${p.paper.id}`,
      publishedAt,
      score: p.paper.upvotes ?? 0,
    }));
}
