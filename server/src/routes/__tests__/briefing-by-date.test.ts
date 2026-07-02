import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';

/**
 * RED 박제: GET /api/briefing/by-date/:date 계약 (기준 1~5).
 * 구현 전이라 라우트가 없어 대부분 404 로 실패(RED)해야 정상.
 * 기대값은 계약 명세에서만 도출(구현 출력 베끼지 않음).
 *
 * 시드/호출 방식은 item-status.test / more-route.test 와 동일:
 *   mkdtemp 임시 DB + process.env.DB_PATH → getDb()로 스키마 생성 →
 *   buildApp() + hono/jwt sign 토큰 → app.request().
 * 픽스처는 db.ts 스키마 그대로 items/briefings 에 직접 INSERT.
 */

// 예상 인터페이스: buildApp(): Hono 앱, app.request(path, init) → Response.
// 예상 라우트: GET /api/briefing/by-date/:date (아직 미존재 → RED).
let app: { request: (p: string, init?: RequestInit) => Promise<Response> };
let db: Database.Database;
let token: string;

// 같은 날짜(2026-07-01)에 브리핑 2건 — 최신(id 큰 쪽) 반환 검증용
let idBriefingOld: number;
let idBriefingNew: number;

const urlOf = (title: string) => `https://example.com/${title}`;

function insertItem(title: string): number {
  const info = db
    .prepare(
      `INSERT INTO items (source_id, title, url, fetched_at, genre, summary, summary_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(1, title, urlOf(title), Date.now(), 'AI/LLM·에이전트', title, 'more');
  return Number(info.lastInsertRowid);
}

// briefings 한 건 삽입 → 생성된 id 반환. must_read_json/more_json 은 item id 배열(JSON).
function insertBriefing(
  createdAt: number,
  arrivalDate: string,
  mustIds: number[],
  moreIds: number[],
): number {
  const info = db
    .prepare(
      `INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(createdAt, arrivalDate, JSON.stringify(mustIds), JSON.stringify(moreIds));
  return Number(info.lastInsertRowid);
}

async function getByDate(date: string): Promise<Response> {
  return app.request(`/api/briefing/by-date/${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// 매칭되는 라우트가 없으면 Hono 기본 404 는 텍스트 본문("404 Not Found") → JSON 파싱 실패.
// 계약이 요구하는 { error } JSON 여부를 판정하기 위해 raw → JSON.parse 로 방어적으로 읽는다.
async function readJson(res: Response): Promise<unknown> {
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-by-date-'));
  process.env.DB_PATH = path.join(dir, 'test.sqlite');
  process.env.JWT_SECRET = 'test-secret';

  const { getDb } = await import('../../db.js');
  const { buildApp } = await import('../../routes.js');
  const { env } = await import('../../env.js');
  const { sign } = await import('hono/jwt');

  db = getDb(); // 스키마 생성 + config/sources 시드 (source id=1 존재)
  app = buildApp() as unknown as typeof app;
  token = await sign(
    { sub: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 },
    env.jwtSecret,
    'HS256',
  );

  // 아이템 시드
  const mustOld = insertItem('must-old');
  const moreOld = insertItem('more-old');
  const mustNew = insertItem('must-new');
  const moreNew = insertItem('more-new');

  // 같은 arrival_date='2026-07-01' 브리핑 2건. 나중에 넣은 쪽 id 가 더 큼(AUTOINCREMENT).
  const now = Date.now();
  idBriefingOld = insertBriefing(now - 1000, '2026-07-01', [mustOld], [moreOld]);
  idBriefingNew = insertBriefing(now, '2026-07-01', [mustNew], [moreNew]);
});

describe('GET /api/briefing/by-date/:date (RED 박제)', () => {
  // 선행조건: 나중 삽입분 id 가 더 크다(최신=큰 id 라는 기준 2의 전제).
  it('선행: 같은 날짜 두 브리핑 중 나중 삽입분 id 가 더 크다', () => {
    expect(idBriefingNew).toBeGreaterThan(idBriefingOld);
  });

  // 기준 1: 존재하는 날짜 → 200, {briefing:{id, arrivalDate:'2026-07-01', mustRead[], more[]}}
  it('기준1: 존재하는 날짜 조회 → 200 + 뷰 구조', async () => {
    const res = await getByDate('2026-07-01');
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      briefing?: { id: number; arrivalDate: string; mustRead: unknown[]; more: unknown[] };
    };
    expect(body?.briefing).toBeDefined();
    expect(typeof body!.briefing!.id).toBe('number');
    expect(body!.briefing!.arrivalDate).toBe('2026-07-01'); // 기준1 명시 값
    expect(Array.isArray(body!.briefing!.mustRead)).toBe(true);
    expect(Array.isArray(body!.briefing!.more)).toBe(true);
  });

  // 기준 2: 같은 날짜 복수 → id 큰 쪽(최신) 반환
  it('기준2: 같은 날짜 브리핑 복수면 id 큰 쪽(최신)을 반환', async () => {
    const res = await getByDate('2026-07-01');
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { briefing?: { id: number } };
    expect(body?.briefing?.id).toBe(idBriefingNew); // 기준2: 최신 = 큰 id
  });

  // 기준 3: 없는 날짜 → 404 + {error}
  it('기준3: 없는 날짜 → 404 + JSON {error}', async () => {
    const res = await getByDate('2020-01-01');
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error?: unknown };
    expect(body).toBeDefined(); // Hono 기본 404 는 text → 여기서 RED
    expect(typeof body!.error).not.toBe('undefined');
  });

  // 기준 4: 형식 오류 → 400 + {error}
  it('기준4: 잘못된 날짜 형식 → 400 + JSON {error}', async () => {
    const res = await getByDate('not-a-date');
    expect(res.status).toBe(400); // 라우트 미존재면 404 → RED
    const body = (await readJson(res)) as { error?: unknown };
    expect(body).toBeDefined();
    expect(typeof body!.error).not.toBe('undefined');
  });

  // 기준 5: 인증 필수 → 401 (주의: 라우트가 없어도 requireAuth('*')가 먼저 401 → 이미 GREEN 가능)
  it('기준5: Authorization 헤더 없이 → 401', async () => {
    const res = await app.request('/api/briefing/by-date/2026-07-01');
    expect(res.status).toBe(401);
  });
});
