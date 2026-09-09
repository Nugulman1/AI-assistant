import { fetchHn } from './hn.js';
import { fetchLobsters } from './lobsters.js';
import { fetchHfPapers } from './hf-papers.js';
import { fetchRss } from './rss.js';

/** 소스가 내놓는 원시 후보. merge 가 URL·제목으로 묶어 Item 으로 만든다. */
export interface Candidate {
  sourceName: string;
  title: string;
  url: string;
  /** epoch ms */
  publishedAt: number;
  hn?: { id: string; points: number; comments: number };
  score?: number;
}

/** sources.json 한 항목. */
export type SourceConfig =
  | { type: 'hn'; name: string; minPoints: number }
  | { type: 'lobsters'; name: string; minScore: number }
  | { type: 'hf-papers'; name: string; top: number }
  | { type: 'rss'; name: string; url: string };

export interface SourceResult {
  name: string;
  items: Candidate[];
  /** 실패했으면 사유. 실패한 소스는 items 가 빈 배열. */
  error?: string;
}

function fetchSource(cfg: SourceConfig, now: number): Promise<Candidate[]> {
  switch (cfg.type) {
    case 'hn':
      return fetchHn(cfg, now);
    case 'lobsters':
      return fetchLobsters(cfg, now);
    case 'hf-papers':
      return fetchHfPapers(cfg, now);
    case 'rss':
      return fetchRss(cfg, now);
  }
}

/** 전 소스 병렬 수집. 한 소스의 실패는 그 소스만 빈 배열로 격리한다. */
export async function collectAll(configs: SourceConfig[], now = Date.now()): Promise<SourceResult[]> {
  return Promise.all(
    configs.map(async (cfg): Promise<SourceResult> => {
      try {
        return { name: cfg.name, items: await fetchSource(cfg, now) };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.warn(`[${cfg.name}] 수집 실패: ${error}`);
        return { name: cfg.name, items: [], error };
      }
    }),
  );
}
