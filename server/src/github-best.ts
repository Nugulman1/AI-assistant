/**
 * GitHub 트렌딩 기간별 저장·조회·수집. best.ts(HN 베스트)와 동형 — 48h 메인 브리핑과 독립 경로.
 * period(daily/weekly/monthly) 별로 github_trending 테이블을 통째 교체한다.
 * db 인자는 테스트(in-memory) 주입용 — 생략 시 getDb() 싱글턴(프로덕션).
 */
import type Database from 'better-sqlite3';
import { getDb } from './db.js';
import {
  fetchTrending,
  type TrendingPeriod,
  type TrendingRepo,
} from './sources/github-trending.js';

export type { TrendingPeriod };

const PERIODS: TrendingPeriod[] = ['daily', 'weekly', 'monthly'];

export interface TrendingRow {
  id: number;
  period: string;
  rank: number;
  name: string;
  url: string;
  description: string;
  language: string | null;
  stars: number;
  period_stars: number;
  collected_at: number;
}

export interface CollectTrendingResult {
  period: TrendingPeriod;
  count: number;
  ok: boolean;
}

/**
 * 한 기간의 트렌딩을 통째 교체 저장(DELETE WHERE period → INSERT rank 1..n, 트랜잭션).
 * 입력 순서가 곧 rank(트렌딩 페이지 노출 순서). 저장 건수를 반환. db 생략 시 getDb().
 */
export function storeTrending(
  period: TrendingPeriod,
  repos: TrendingRepo[],
  collectedAt: number,
  db: Database.Database = getDb(),
): number {
  // 0건이면 통째 교체하지 않는다(DELETE 건너뜀) — 수집 실패·파싱 0건이 기존 트렌딩을
  // 날리지 않게 격리 보장을 데이터 레이어에 둔다. 합격기준 "스크래핑 깨져도 기존 유지".
  if (repos.length === 0) return 0;
  const del = db.prepare('DELETE FROM github_trending WHERE period = ?');
  const ins = db.prepare(
    `INSERT INTO github_trending
       (period, rank, name, url, description, language, stars, period_stars, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const replace = db.transaction(() => {
    del.run(period); // 기존 기간 데이터 통째 교체
    repos.forEach((r, i) => {
      ins.run(
        period,
        i + 1, // rank: 1부터(노출 순서)
        r.name,
        r.url,
        r.description,
        r.language,
        r.stars,
        r.periodStars,
        collectedAt,
      );
    });
  });
  replace();
  return repos.length;
}

/** 한 기간의 트렌딩을 rank 순으로 조회(화면/API용). db 생략 시 getDb(). */
export function getTrendingStored(
  period: TrendingPeriod,
  db: Database.Database = getDb(),
): TrendingRow[] {
  return db
    .prepare('SELECT * FROM github_trending WHERE period = ? ORDER BY rank')
    .all(period) as TrendingRow[];
}

/**
 * 일/주/월 트렌딩을 각각 수집해 통째 교체 저장. now 는 테스트 주입용(기본 현재시각).
 * 한 기간 수집 실패/0건은 그 기간만 건너뛰고(기존 행 유지) 나머지를 계속 채운다(best.ts 동형).
 */
export async function collectAndStoreTrending(
  now = Date.now(),
): Promise<CollectTrendingResult[]> {
  const results: CollectTrendingResult[] = [];
  for (const period of PERIODS) {
    try {
      const repos = await fetchTrending(period);
      // 빈 결과(수집 실패·파싱 0건)면 교체하지 않는다 — 기존 트렌딩을 날리지 않게.
      if (repos.length === 0) {
        console.warn(`[github-trending] ${period} 수집 0건 — 기존 데이터 유지`);
        results.push({ period, count: 0, ok: false });
        continue;
      }
      const count = storeTrending(period, repos, now);
      console.log(`[github-trending] ${period} 트렌딩 ${count}건 저장`);
      results.push({ period, count, ok: true });
    } catch (err) {
      console.warn(`[github-trending] ${period} 저장 실패(기존 유지):`, (err as Error).message);
      results.push({ period, count: 0, ok: false });
    }
  }
  return results;
}
