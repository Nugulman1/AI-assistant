import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  storeTrending,
  getTrendingView,
  getUncachedTrendingNames,
  storeRepoSummaries,
} from '../github-best.js';
import type { TrendingRepo } from '../sources/github-trending.js';

/** 테스트용 in-memory DB — github_trending + 요약 캐시 두 테이블(계약 스키마). */
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
    CREATE TABLE github_repo_summaries (
      name          TEXT PRIMARY KEY,
      summary       TEXT NOT NULL,
      summarized_at INTEGER NOT NULL
    );
  `);
  return db;
}

const repo = (name: string): TrendingRepo => ({
  name,
  url: `https://github.com/${name}`,
  description: `${name} desc`,
  language: null,
  stars: 10,
  periodStars: 1,
});

describe('getTrendingView — 요약 캐시 LEFT JOIN', () => {
  it('요약 있는 리포엔 ai_summary, 없는 리포엔 null', () => {
    const db = makeDb();
    storeTrending('daily', [repo('a/one'), repo('b/two')], 1700000000000, db);
    storeRepoSummaries([{ name: 'a/one', summary: '한글 요약' }], 1700000001000, db);

    const rows = getTrendingView('daily', db);
    // 기대값 출처: 위 입력 — a/one 만 캐시에 넣었으므로 b/two 는 null 이어야 한다.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'a/one', ai_summary: '한글 요약' });
    expect(rows[1]).toMatchObject({ name: 'b/two', ai_summary: null });
  });

  it('rank 순 정렬 유지(getTrendingStored 계약과 동일)', () => {
    const db = makeDb();
    storeTrending('weekly', [repo('x/1'), repo('y/2'), repo('z/3')], 1, db);
    const rows = getTrendingView('weekly', db);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe('getUncachedTrendingNames — 요약 안 된 리포만', () => {
  it('캐시에 있는 리포는 제외, 기간 간 중복 이름은 1회만', () => {
    const db = makeDb();
    // a/one 은 daily·weekly 양쪽에 등장(중복), b/two 는 캐시 있음.
    storeTrending('daily', [repo('a/one'), repo('b/two')], 1, db);
    storeTrending('weekly', [repo('a/one'), repo('c/three')], 1, db);
    storeRepoSummaries([{ name: 'b/two', summary: 's' }], 1, db);

    const names = getUncachedTrendingNames(db);
    // 기대값 출처: 위 입력 — 미캐시 = a/one(중복 1회), c/three. b/two 는 캐시라 제외.
    expect(names.sort()).toEqual(['a/one', 'c/three']);
  });

  it('limit 상한 적용', () => {
    const db = makeDb();
    storeTrending('daily', [repo('a/1'), repo('a/2'), repo('a/3')], 1, db);
    expect(getUncachedTrendingNames(db, 2)).toHaveLength(2);
  });

  it('전부 캐시면 빈 배열', () => {
    const db = makeDb();
    storeTrending('daily', [repo('a/one')], 1, db);
    storeRepoSummaries([{ name: 'a/one', summary: 's' }], 1, db);
    expect(getUncachedTrendingNames(db)).toEqual([]);
  });
});

describe('storeRepoSummaries — 캐시 적재', () => {
  it('같은 이름 재적재는 교체(INSERT OR REPLACE), 행 수 불변', () => {
    const db = makeDb();
    storeRepoSummaries([{ name: 'a/one', summary: '첫 요약' }], 1, db);
    storeRepoSummaries([{ name: 'a/one', summary: '새 요약' }], 2, db);

    const rows = db.prepare('SELECT * FROM github_repo_summaries').all() as {
      name: string;
      summary: string;
      summarized_at: number;
    }[];
    // 기대값 출처: PK(name) 교체 의미론 — 1행만 남고 나중 값이 이긴다.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'a/one', summary: '새 요약', summarized_at: 2 });
  });
});
