import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 합격 기준(/best 라우트와 동형):
 *   GET /api/github-trending?period=daily|weekly|monthly (기본 daily) → 200 + JSON { period, collectedAt, items }
 *   잘못된 period 는 daily 로 폴백(/best 가 invalid→week 폴백하는 것과 동형).
 *   api.use('*', requireAuth) 하위이므로 유효 토큰 필요.
 *
 * RED 근거: 라우트가 아직 없다 → 유효 토큰으로 요청해도 매칭 라우트 없어 404 → expect(200) 실패.
 * (무인증 401 단언은 넣지 않는다 — requireAuth 미들웨어가 라우트 부재와 무관히 지금도 401을 내
 *  구현 전에도 통과해 RED 신호가 안 되기 때문.)
 */
let app: { request: (p: string, init?: RequestInit) => Promise<Response> };
let token: string;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-trending-route-'));
  process.env.DB_PATH = path.join(dir, 'test.sqlite');
  process.env.JWT_SECRET = 'test-secret';

  const { buildApp } = await import('../../routes.js');
  const { env } = await import('../../env.js');
  const { sign } = await import('hono/jwt');

  app = buildApp() as unknown as typeof app;
  token = await sign(
    { sub: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 },
    env.jwtSecret,
    'HS256',
  );
});

const authedGet = (qs: string) =>
  app.request(`/api/github-trending${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

describe('GET /api/github-trending — 기간별 조회 라우트', () => {
  it('period=daily → 200 + { period:"daily", items:[] } (데이터 없으면 빈 배열)', async () => {
    const res = await authedGet('?period=daily');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { period: string; items: unknown };
    expect(body.period).toBe('daily');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('period 누락 → 기본 daily', async () => {
    const res = await authedGet('');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { period: string };
    expect(body.period).toBe('daily');
  });

  it('잘못된 period(bogus) → daily 폴백', async () => {
    const res = await authedGet('?period=bogus');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { period: string };
    expect(body.period).toBe('daily');
  });

  it('period=weekly → period:"weekly" 그대로', async () => {
    const res = await authedGet('?period=weekly');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { period: string };
    expect(body.period).toBe('weekly');
  });
});
