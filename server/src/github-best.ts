/**
 * GitHub 트렌딩 기간별 저장·조회·수집. best.ts(HN 베스트)와 동형 — 48h 메인 브리핑과 독립 경로.
 * period(daily/weekly/monthly) 별로 github_trending 테이블을 통째 교체한다.
 * db 인자는 테스트(in-memory) 주입용 — 생략 시 getDb() 싱글턴(프로덕션).
 */
import type Database from 'better-sqlite3';
import { getDb } from './db.js';
import {
  fetchReadme,
  fetchTrending,
  type TrendingPeriod,
  type TrendingRepo,
} from './sources/github-trending.js';
import { summarizeRepos, type RepoSummary } from './ai/repo-summary.js';

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

/** 화면/API용 행 — 이름 키 요약 캐시를 LEFT JOIN 해 ai_summary(없으면 null)를 붙인다. */
export interface TrendingViewRow extends TrendingRow {
  ai_summary: string | null;
}

/** 한 기간의 트렌딩을 rank 순으로, AI 요약을 붙여 조회. db 생략 시 getDb(). */
export function getTrendingView(
  period: TrendingPeriod,
  db: Database.Database = getDb(),
): TrendingViewRow[] {
  return db
    .prepare(
      `SELECT t.*, s.summary AS ai_summary
         FROM github_trending t
         LEFT JOIN github_repo_summaries s ON s.name = t.name
        WHERE t.period = ? ORDER BY t.rank`,
    )
    .all(period) as TrendingViewRow[];
}

/** 현재 트렌딩에 있는데 요약 캐시에 없는 리포 이름들(중복 제거, rank 순, limit 상한). */
export function getUncachedTrendingNames(
  db: Database.Database = getDb(),
  limit = 60,
): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT t.name
         FROM github_trending t
         LEFT JOIN github_repo_summaries s ON s.name = t.name
        WHERE s.name IS NULL
        ORDER BY t.period, t.rank
        LIMIT ?`,
    )
    .all(limit) as { name: string }[];
  return rows.map((r) => r.name);
}

/** 요약들을 캐시에 적재(INSERT OR REPLACE). 적재 건수 반환. */
export function storeRepoSummaries(
  summaries: RepoSummary[],
  summarizedAt: number,
  db: Database.Database = getDb(),
): number {
  const ins = db.prepare(
    `INSERT OR REPLACE INTO github_repo_summaries (name, summary, summarized_at)
     VALUES (?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const s of summaries) ins.run(s.name, s.summary, summarizedAt);
  });
  tx();
  return summaries.length;
}

/**
 * 요약 캐시에 없는 트렌딩 리포들의 README 를 가져와 AI 한국어 요약 후 캐시 적재.
 * 실패는 리포 단위로 격리(요약 안 된 리포는 다음 사이클에 자연 재시도). 적재 건수 반환.
 * db 는 테스트 주입용 — 단, fetch/AI 는 네트워크라 단위테스트 대상이 아니다.
 */
export async function summarizeTrendingRepos(
  now = Date.now(),
  db: Database.Database = getDb(),
): Promise<number> {
  const names = getUncachedTrendingNames(db);
  if (names.length === 0) return 0;

  // 리포 메타(설명·언어)는 아무 period 행에서나 가져오면 된다(이름 기준 동일).
  const metaStmt = db.prepare(
    'SELECT description, language FROM github_trending WHERE name = ? LIMIT 1',
  );
  const inputs = [];
  for (const name of names) {
    const meta = metaStmt.get(name) as
      | { description: string; language: string | null }
      | undefined;
    // README 실패는 null — 설명만으로 요약 진행.
    const readme = await fetchReadme(name);
    inputs.push({
      name,
      description: meta?.description ?? '',
      language: meta?.language ?? null,
      readme,
    });
  }

  const summaries = await summarizeRepos(inputs);
  const stored = storeRepoSummaries(summaries, now, db);
  console.log(
    `[github-trending] 요약 ${stored}/${names.length}건 캐시 적재`,
  );
  return stored;
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
