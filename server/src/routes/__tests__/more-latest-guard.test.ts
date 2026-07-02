import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 합격 기준: '갱신'(더보기)은 최신 브리핑에서만 허용된다.
 *
 * 근거: candidate_pool 은 최신 수집 run 이 소유하는 전역 대기열(브리핑 무관, 수집마다 통째 교체).
 * 과거 브리핑 id 로 POST /api/briefing/:id/more 를 호출하면 오늘 후보가 과거 브리핑의
 * more_json 에 영구 부착되고(역사 오염) 오늘 브리핑 몫은 소진된다(pool 도둑질).
 * 과거 브리핑 열람(날짜 이동) 기능이 이 경로를 처음으로 도달 가능하게 만들었으므로 서버에서 차단한다.
 *
 * 계약:
 *  1) 과거 브리핑 id 로 more 호출 → 409 + { error }, candidate_pool 미소비, 과거 more_json 무변화
 *  2) 최신 브리핑 id 로 more 호출 → 200 + items (기존 동작 유지)
 */

let app: { request: (p: string, init?: RequestInit) => Promise<Response> };
let token: string;
let db: import('better-sqlite3').Database;
let pastId: number;
let latestId: number;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'more-guard-'));
  process.env.DB_PATH = path.join(dir, 'test.sqlite');
  process.env.JWT_SECRET = 'test-secret';
  process.env.ANTHROPIC_API_KEY = ''; // AI 오프 → summarizeMore 제목 폴백 경로

  const { getDb } = await import('../../db.js');
  const { buildApp } = await import('../../routes.js');
  const { env } = await import('../../env.js');
  const { sign } = await import('hono/jwt');

  db = getDb();
  app = buildApp() as unknown as typeof app;
  token = await sign(
    { sub: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 },
    env.jwtSecret,
    'HS256',
  );

  const insBriefing = db.prepare(
    'INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json) VALUES (?, ?, ?, ?)',
  );
  pastId = Number(insBriefing.run(1000, '2026-07-01', '[]', '[]').lastInsertRowid);
  latestId = Number(insBriefing.run(2000, '2026-07-02', '[]', '[]').lastInsertRowid);

  // 오늘 수집분 후보 2건 (body 있음 → 크롤링 불필요, external_url 없음)
  const insPool = db.prepare(
    `INSERT INTO candidate_pool
       (collected_at, rank, source_id, external_id, title, url, author, score, comments,
        published_at, topicality, genre, body, external_url, url_hash, shown)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  );
  insPool.run(2000, 1, 1, 'cand-a', 'TODAY-candidate-A', 'https://ex.com/a', null, 10, 1, 2000, 0.5, '기타', '본문A', null, 'hash-a');
  insPool.run(2000, 2, 1, 'cand-b', 'TODAY-candidate-B', 'https://ex.com/b', null, 20, 2, 2000, 0.5, '기타', '본문B', null, 'hash-b');
});

const post = (id: number) =>
  app.request(`/api/briefing/${id}/more`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ n: 5 }),
  });

const poolUnshown = () =>
  (db.prepare('SELECT COUNT(*) AS n FROM candidate_pool WHERE shown = 0').get() as { n: number }).n;

describe('갱신은 최신 브리핑 전용', () => {
  it('과거 브리핑 id로 more 호출 시 409 + {error}, pool 미소비, more_json 무변화', async () => {
    const res = await post(pastId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
    // pool 이 소비되지 않았어야 한다
    expect(poolUnshown()).toBe(2);
    // 과거 브리핑 more_json 오염 없음
    const row = db.prepare('SELECT more_json FROM briefings WHERE id = ?').get(pastId) as {
      more_json: string;
    };
    expect(row.more_json).toBe('[]');
  });

  it('최신 브리핑 id로 more 호출은 기존대로 200 + items', async () => {
    const res = await post(latestId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; exhausted: boolean };
    expect(body.items.length).toBe(2);
    expect(poolUnshown()).toBe(0);
  });
});
