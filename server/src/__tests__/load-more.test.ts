import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 기준 2: candidate_pool 이 비어있을 때 loadMore(id, n) → { items: [], exhausted: true }.
 *
 * 실제 loadMore 를 호출한다(모킹 없음). 임시 파일 DB로 getDb 싱글턴을 묶고,
 * 갓 생성한 빈 DB(candidate_pool 0행) 상태에서 호출한다.
 * 이 기준은 현재 구현에서도 통과(GREEN)할 가능성이 큼 — 통과 여부를 보고에 명시.
 */
// 예상 인터페이스: loadMore(briefingId: number, count: number)
//   → Promise<{ items: MoreItem[]; exhausted: boolean }>
let loadMore: (
  briefingId: number,
  count: number,
) => Promise<{ items: unknown[]; exhausted: boolean }>;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-more-'));
  process.env.DB_PATH = path.join(dir, 'test.sqlite');

  const { getDb } = await import('../db.js');
  getDb(); // 스키마 생성 + config 시드. candidate_pool 은 빈 상태.

  ({ loadMore } = await import('../briefing.js'));
});

describe('loadMore — 풀 소진', () => {
  it('candidate_pool 이 비어있으면 { items: [], exhausted: true } 를 반환한다', async () => {
    const res = await loadMore(999, 7);
    expect(res).toEqual({ items: [], exhausted: true });
  });
});
