import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
// 추론한 인터페이스 — 아직 미구현 모듈. import 실패로 RED 나는 게 정상.
// best.ts 와 동형 계약: period별 통째 교체 저장 + rank 순 조회.
// 단, best.ts 의 getDb() 싱글턴을 in-memory 로 테스트하기 위해 db 를 마지막 인자로 주입 가능하게 둔다
// (프로덕션은 인자 생략 → getDb() 싱글턴 사용; interest.ts 의 db 주입 테스트 패턴과 동일 취지).
import {
  storeTrending,
  getTrendingStored,
  type TrendingPeriod,
  type TrendingRow,
} from '../github-best.js';
import type { TrendingRepo } from '../sources/github-trending.js';

/** 테스트용 in-memory DB. github_trending 한 테이블만 만든다(계약 스키마). */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE github_trending (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      period       TEXT NOT NULL,
      rank         INTEGER NOT NULL,
      name         TEXT NOT NULL,
      url          TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      language     TEXT,
      stars        INTEGER NOT NULL DEFAULT 0,
      period_stars INTEGER NOT NULL DEFAULT 0,
      collected_at INTEGER NOT NULL
    );
  `);
  return db;
}

const repo = (name: string, stars: number, periodStars: number, language: string | null = null): TrendingRepo => ({
  name,
  url: `https://github.com/${name}`,
  description: `${name} desc`,
  language,
  stars,
  periodStars,
});

describe('storeTrending / getTrendingStored — period별 통째 교체 저장·조회', () => {
  it('저장→조회 라운드트립: 입력 순서대로 rank 1..n, 필드 보존', () => {
    const db = makeDb();
    const repos = [repo('a/one', 100, 10, 'Go'), repo('b/two', 50, 5, null)];
    storeTrending('daily', repos, 1700000000000, db);

    const rows = getTrendingStored('daily', db);
    // 기대값 출처: 위 입력. rank 는 입력 순서대로 1,2. periodStars→period_stars 컬럼 매핑.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({
      period: 'daily',
      rank: 1,
      name: 'a/one',
      url: 'https://github.com/a/one',
      description: 'a/one desc',
      language: 'Go',
      stars: 100,
      period_stars: 10,
      collected_at: 1700000000000,
    });
    expect(rows[1]).toMatchObject({ rank: 2, name: 'b/two', language: null, stars: 50, period_stars: 5 });
  });

  it('period 격리: daily 저장이 weekly 조회에 섞이지 않는다', () => {
    const db = makeDb();
    storeTrending('daily', [repo('a/one', 100, 10)], 1, db);
    storeTrending('weekly', [repo('w/week', 200, 20)], 2, db);

    expect(getTrendingStored('daily', db).map((r: TrendingRow) => r.name)).toEqual(['a/one']);
    expect(getTrendingStored('weekly', db).map((r: TrendingRow) => r.name)).toEqual(['w/week']);
  });

  it('재저장 시 같은 period 를 통째 교체한다(이전 행 사라짐)', () => {
    const db = makeDb();
    storeTrending('daily', [repo('a/one', 1, 1), repo('b/two', 2, 2)], 1, db);
    storeTrending('daily', [repo('c/three', 3, 3)], 2, db);

    const rows = getTrendingStored('daily', db);
    // 기대값 출처: 2차 저장만 남아야 함(통째 교체). 이전 a/one,b/two 는 사라짐.
    expect(rows.map((r) => r.name)).toEqual(['c/three']);
    expect(rows[0].rank).toBe(1);
  });
});

// TrendingPeriod 타입이 daily|weekly|monthly 임을 컴파일 타임에 못박는다(런타임 단언 아님).
const _periods: TrendingPeriod[] = ['daily', 'weekly', 'monthly'];
void _periods;
