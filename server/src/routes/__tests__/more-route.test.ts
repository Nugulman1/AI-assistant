import { describe, it, expect, beforeAll, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 기준 1: POST /api/briefing/:id/more 에서 loadMore가 throw하면
 *         500 + JSON 에러 바디 { error: string } 을 반환해야 한다.
 *
 * 전제 모사: 실제 loadMore는 AI 키가 없어도 제목 폴백으로 성공하므로(throw 안 함),
 * "AI/DB 장애로 loadMore가 throw"하는 합격기준의 전제를 보장하려 loadMore를 모킹해 던진다.
 * routes.ts 가 briefing.js / scheduler.js 경유로 쓰는 심볼을 모두 채워 import 그래프를 보존.
 */
vi.mock('../../briefing.js', () => ({
  loadMore: vi.fn(async () => {
    throw new Error('AI 호출 실패 (테스트 모사)');
  }),
  getBriefingView: vi.fn(() => null),
  generateBriefing: vi.fn(async () => ({})),
}));

// 예상 인터페이스: buildApp(): Hono 앱, app.request(path, init) → Response.
let app: { request: (p: string, init?: RequestInit) => Promise<Response> };
let token: string;
let latestId: number;

beforeAll(async () => {
  // 격리: 임시 파일 DB로 getDb 싱글턴을 묶는다(실 dev DB 오염 방지). env 로드 전에 설정.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'more-route-'));
  process.env.DB_PATH = path.join(dir, 'test.sqlite');
  process.env.JWT_SECRET = 'test-secret';

  const { getDb } = await import('../../db.js');
  const { buildApp } = await import('../../routes.js');
  const { env } = await import('../../env.js');
  const { sign } = await import('hono/jwt');

  // more 는 최신 브리핑 전용 가드가 선행되므로(409), loadMore 도달 전제를 만들려면
  // 최신 브리핑을 시드하고 그 id 로 호출해야 한다. 검증 의도(throw → 500 + {error})는 불변.
  latestId = Number(
    getDb()
      .prepare(
        'INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json) VALUES (?, ?, ?, ?)',
      )
      .run(1000, '2026-07-01', '[]', '[]').lastInsertRowid,
  );

  app = buildApp() as unknown as typeof app;
  // requireAuth 통과용 토큰 — env.jwtSecret 과 동일 비밀로 서명(설정값/기본값 무관히 일치).
  token = await sign(
    { sub: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 },
    env.jwtSecret,
    'HS256',
  );
});

describe('POST /api/briefing/:id/more — loadMore 에러 처리', () => {
  it('loadMore가 throw하면 500 + JSON 에러 바디를 반환한다', async () => {
    const res = await app.request(`/api/briefing/${latestId}/more`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ n: 1 }),
    });

    // 합격기준: status 500 (현재도 Hono 기본 처리로 500은 나옴)
    expect(res.status).toBe(500);

    // 합격기준: 본문이 JSON { error: string } 여야 함.
    // items/exhausted는 클라이언트가 읽지 않으므로 응답에 포함하지 않음.
    // 현재(try-catch 없음): 본문이 text "Internal Server Error" → JSON 아님 → 여기서 RED.
    const raw = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
    expect(body, `응답 본문이 JSON이 아님 (현재 RED 지점). raw=${JSON.stringify(raw)}`).toBeDefined();
    expect(body).toMatchObject({
      error: expect.any(String),
    });
  });
});
