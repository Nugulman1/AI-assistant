import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { computeGenreWeights, READ_WEIGHT } from '../interest.js';

/** 테스트용 in-memory DB. interest 가 읽는 두 테이블만 만든다. */
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      genre TEXT,
      kind TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE read_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      genre TEXT,
      clicked_at INTEGER NOT NULL
    );
  `);
  return db;
}

function addFeedback(db: Database.Database, itemId: number, genre: string, kind: 'like' | 'dislike') {
  db.prepare('INSERT INTO feedback (item_id, genre, kind, created_at) VALUES (?,?,?,0)').run(
    itemId,
    genre,
    kind,
  );
}
function addRead(db: Database.Database, itemId: number, genre: string) {
  db.prepare('INSERT INTO read_events (item_id, genre, clicked_at) VALUES (?,?,0)').run(itemId, genre);
}

describe('computeGenreWeights', () => {
  it('신호 0이면 빈 가중치 + N=0 (콜드스타트)', () => {
    const db = makeDb();
    const { weights, totalSignal } = computeGenreWeights(db);
    expect(weights.size).toBe(0);
    expect(totalSignal).toBe(0);
  });

  it('좋아요는 양수, 관심없음은 음수 가중치', () => {
    const db = makeDb();
    addFeedback(db, 1, '보안', 'like');
    addFeedback(db, 2, '논문·연구', 'dislike');
    const { weights, totalSignal } = computeGenreWeights(db);
    expect(weights.get('보안')!).toBeGreaterThan(0);
    expect(weights.get('논문·연구')!).toBeLessThan(0);
    expect(totalSignal).toBe(2); // read 는 N 에 안 들어감
  });

  it('정규화 가중치는 [-1,1] 안에서 포화한다', () => {
    const db = makeDb();
    for (let i = 0; i < 100; i++) addFeedback(db, i, '보안', 'like');
    const { weights } = computeGenreWeights(db);
    expect(weights.get('보안')!).toBeGreaterThan(0.99);
    expect(weights.get('보안')!).toBeLessThanOrEqual(1);
  });

  it('원문열기는 보조신호로 약하게(READ_WEIGHT) 더해지되 N 에는 미포함', () => {
    const db = makeDb();
    addRead(db, 1, '웹·프론트');
    const { weights, totalSignal } = computeGenreWeights(db);
    expect(weights.get('웹·프론트')!).toBeGreaterThan(0); // tanh(READ_WEIGHT/3) > 0
    expect(weights.get('웹·프론트')!).toBeLessThan(Math.tanh(1 / 3)); // 좋아요 1개보다 약함
    expect(totalSignal).toBe(0);
    void READ_WEIGHT;
  });

  it('좋아요와 관심없음이 같은 장르에서 상쇄된다', () => {
    const db = makeDb();
    addFeedback(db, 1, '보안', 'like');
    addFeedback(db, 2, '보안', 'dislike');
    const { weights, totalSignal } = computeGenreWeights(db);
    expect(Math.abs(weights.get('보안') ?? 0)).toBeLessThan(1e-9); // 1 - 1 = 0
    expect(totalSignal).toBe(2);
  });
});
