import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { storeTrending, getTrendingStored } from '../github-best.js';
import type { TrendingRepo } from '../sources/github-trending.js';

// 레드팀 공격 [1]/[2] 회귀가드 — 격리 보장이 데이터 레이어(storeTrending)에 있는지 검증한다.
// 합격기준: "스크래핑이 깨지거나 0건 수집돼도 기존 트렌딩을 통째 교체로 날리지 않는다."
// 박제 테스트(github-best.test.ts)는 비어있지 않은 배열만 다뤄 이 경로가 무검증이었음.

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

const repo = (name: string, stars: number, periodStars: number): TrendingRepo => ({
  name,
  url: `https://github.com/${name}`,
  description: `${name} desc`,
  language: null,
  stars,
  periodStars,
});

describe('storeTrending 격리 — 0건은 기존 데이터를 보존한다', () => {
  it('빈 배열로 재저장해도 기존 행이 살아있다(DELETE 우회)', () => {
    const db = makeDb();
    storeTrending('daily', [repo('a/one', 100, 10), repo('b/two', 50, 5)], 1, db);
    expect(getTrendingStored('daily', db)).toHaveLength(2);

    // 핵심: 0건 수집 = 스크래핑 깨짐. 통째 교체(DELETE→INSERT 0)로 날아가면 안 됨.
    const stored = storeTrending('daily', [], 2, db);

    // 기대값 출처: 빈 입력이면 저장 0건, 기존 2행은 그대로(이름·collected_at 불변).
    expect(stored).toBe(0);
    const rows = getTrendingStored('daily', db);
    expect(rows.map((r) => r.name)).toEqual(['a/one', 'b/two']);
    expect(rows.every((r) => r.collected_at === 1)).toBe(true); // 갱신 안 됨 = 옛 데이터 보존
  });

  it('빈 배열 저장이 다른 period에 영향 없다', () => {
    const db = makeDb();
    storeTrending('weekly', [repo('w/week', 200, 20)], 1, db);
    storeTrending('daily', [], 2, db);

    expect(getTrendingStored('weekly', db).map((r) => r.name)).toEqual(['w/week']);
    expect(getTrendingStored('daily', db)).toHaveLength(0);
  });
});
