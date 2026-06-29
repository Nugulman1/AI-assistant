/**
 * HN 기간별 베스트 수집·저장·조회. 48h 메인 브리핑(generateBriefing)과 독립 경로.
 * 수집 시점(scheduler 수집 cron, run:once)에 generateBriefing 과 나란히 호출돼 best_items 를
 * period 별로 통째 교체한다. 한 기간 수집이 실패해도 다른 기간·메인 브리핑에 영향 없게 격리.
 */
import { getDb, type BestItemRow } from './db.js';
import { fetchBestStories, type BestPeriod } from './sources/hn-best.js';

const PERIODS: BestPeriod[] = ['week', 'month', 'year'];
const LIMIT = 30; // 기간별 보관 상위 건수

export interface CollectBestResult {
  period: BestPeriod;
  count: number; // 저장한 건수
  ok: boolean; // 수집 성공 여부(실패해도 기존 데이터 유지)
}

/**
 * 주/월/년 베스트를 각각 수집해 best_items 에 교체 저장. now 는 테스트 주입용(기본 현재시각).
 * 한 기간 수집 실패는 그 기간만 건너뛰고(기존 행 유지) 나머지를 계속 채운다.
 */
export async function collectAndStoreBest(now = Date.now()): Promise<CollectBestResult[]> {
  const db = getDb();
  const nowSec = Math.floor(now / 1000);

  const del = db.prepare('DELETE FROM best_items WHERE period = ?');
  const ins = db.prepare(
    `INSERT INTO best_items
       (period, rank, external_id, title, url, external_url, author,
        points, comments, created_at, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const results: CollectBestResult[] = [];
  for (const period of PERIODS) {
    try {
      const stories = await fetchBestStories(period, nowSec, LIMIT);
      // 빈 결과(200+빈 hits·전부 title null)면 교체하지 않는다 — 기존 베스트를 날리지 않게.
      if (stories.length === 0) {
        console.warn(`[best] ${period} 수집 0건 — 기존 데이터 유지`);
        results.push({ period, count: 0, ok: false });
        continue;
      }
      const replace = db.transaction(() => {
        del.run(period); // 기존 기간 데이터 통째 교체
        stories.forEach((s, i) => {
          ins.run(
            period,
            i + 1, // rank: 1부터(이미 points 내림차순)
            s.externalId,
            s.title,
            s.url,
            s.externalUrl ?? null,
            s.author ?? null,
            s.points,
            s.comments,
            s.createdAt,
            now,
          );
        });
      });
      replace();
      console.log(`[best] ${period} 베스트 ${stories.length}건 저장`);
      results.push({ period, count: stories.length, ok: true });
    } catch (err) {
      console.warn(`[best] ${period} 수집 실패(기존 유지):`, (err as Error).message);
      results.push({ period, count: 0, ok: false });
    }
  }
  return results;
}

/** 한 기간의 베스트를 rank 순으로 조회(화면/API용). */
export function getBestStored(period: BestPeriod): BestItemRow[] {
  return getDb()
    .prepare('SELECT * FROM best_items WHERE period = ? ORDER BY rank')
    .all(period) as BestItemRow[];
}
