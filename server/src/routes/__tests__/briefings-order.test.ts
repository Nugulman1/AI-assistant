// 레드팀 공격 [2] 재현: created_at·id 역전 시 /api/briefing(최신) vs /api/briefings(목록) 정렬 불일치
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sign } from 'hono/jwt';

let app: any;
let token: string;
let db: any;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro2-'));
  process.env.DB_PATH = path.join(dir, 'test.sqlite');
  process.env.JWT_SECRET = 'test-secret';
  const { getDb } = await import('../../db.js');
  const { buildApp } = await import('../../routes.js');
  const { env } = await import('../../env.js');
  db = getDb();
  app = buildApp();
  token = await sign({ sub: 'owner', exp: Math.floor(Date.now() / 1000) + 3600 }, env.jwtSecret, 'HS256');

  // 시계역행 시나리오: X(id 작음, created_at 큼=진짜 최신) → 역행 후 Y(id 큼, created_at 작음)
  db.prepare(
    `INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json) VALUES (?, ?, ?, ?)`,
  ).run(2000, '2026-07-01', '[]', '[]'); // id=1, created_at=2000 (진짜 최신)
  db.prepare(
    `INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json) VALUES (?, ?, ?, ?)`,
  ).run(1000, '2026-07-02', '[]', '[]'); // id=2, created_at=1000 (역행 후 생성)
});

const get = (p: string) =>
  app.request(p, { headers: { Authorization: `Bearer ${token}` } });

describe('공격[2] 재현: 정렬키 불일치', () => {
  it('최신 브리핑(created_at DESC)과 목록 첫 항목(현재 정렬)이 같은 브리핑인가', async () => {
    const latest = await (await get('/api/briefing')).json();
    const list = await (await get('/api/briefings')).json();
    console.log('latest.id =', latest.briefing.id, '/ list[0].id =', list.briefings[0].id);
    // 불일치하면 navIndex>0 → 최신인데 "지난 브리핑" 뱃지 + 다음→ 활성
    expect(list.briefings[0].id).toBe(latest.briefing.id);
  });
});
