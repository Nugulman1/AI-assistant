import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type Database from 'better-sqlite3';

/**
 * RED 박제: 읽음/북마크 상태관리 백엔드 합격 기준 (AC1~AC8).
 * 구현 전이라 item_status 테이블 / POST /api/status / GET /api/bookmarks 가 없어
 * 실패(RED)해야 정상. 기대값은 사용자 합격 기준에서만 가져옴(구현 출력 베끼지 않음).
 *
 * 시드 방식: generateBriefing 은 네트워크/AI 의존이라 직접 SQL insert 로 source/items/briefing 생성
 *           (load-more.test 처럼 getDb() 후 격리 임시 DB 에 직접 상태 구성하는 통합 스타일).
 * 호출 방식: more-route.test 와 동일 — buildApp() + JWT 토큰 + app.request(path, init).
 */

// 예상 인터페이스: buildApp(): Hono 앱, app.request(path, init) → Response.
let app: { request: (p: string, init?: RequestInit) => Promise<Response> };
let db: Database.Database;
let token: string;

// 시드한 item id (테스트별 격리용으로 별도 id 사용)
let idRead: number; // AC2, AC5, AC7
let idBook: number; // AC3
let idPartial: number; // AC4
let idView: number; // AC6 (상태 미설정 → 기본 false)
let idBookmarkList: number; // AC8 — 현재 브리핑에 담긴 북마크
let idCrossBriefing: number; // AC8 — 오래된 별도 브리핑 + 48h 밖 아이템(영구성 변별)

const urlOf = (title: string) => `https://example.com/${title}`;

function insertItem(title: string, fetchedAt: number = Date.now()): number {
  const info = db
    .prepare(
      `INSERT INTO items (source_id, title, url, fetched_at, genre)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(1, title, urlOf(title), fetchedAt, 'AI/LLM·에이전트');
  return Number(info.lastInsertRowid);
}

async function postStatus(body: Record<string, unknown>): Promise<Response> {
  return app.request('/api/status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getBriefing(): Promise<{ briefing: { mustRead: any[]; more: any[] } | null }> {
  const res = await app.request('/api/briefing', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

// GET /api/briefing 응답에서 id 로 item 을 찾음(mustRead/more 양쪽 탐색)
function findInView(view: { mustRead: any[]; more: any[] } | null, id: number) {
  if (!view) return undefined;
  return [...view.mustRead, ...view.more].find((it) => it.id === id);
}

beforeAll(async () => {
  // 격리: 임시 파일 DB 로 getDb 싱글턴을 묶는다. env 로드 전에 설정.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'item-status-'));
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
  idRead = insertItem('read-target');
  idBook = insertItem('book-target');
  idPartial = insertItem('partial-target');
  idView = insertItem('view-target');
  idBookmarkList = insertItem('bookmark-list-target');
  // 영구성 변별용: 30일 전 fetched_at(48h 밖) + 오래된 별도 브리핑에만 담김
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  idCrossBriefing = insertItem('cross-briefing-target', Date.now() - THIRTY_DAYS);

  // 현재(최신) 브리핑: 위 아이템들을 더보기에 담아 GET /api/briefing 에 노출
  db.prepare(
    `INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json)
     VALUES (?, ?, ?, ?)`,
  ).run(
    Date.now(),
    '2026-06-30',
    JSON.stringify([]),
    JSON.stringify([idRead, idBook, idPartial, idView, idBookmarkList]),
  );

  // 오래된 별도 브리핑: idCrossBriefing 만 담음. getBriefingView()는 최신 1건만 보므로
  // GET /api/briefing 에는 안 나오고 /api/bookmarks 만 이 아이템을 영구 반환해야 함.
  db.prepare(
    `INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json)
     VALUES (?, ?, ?, ?)`,
  ).run(
    Date.now() - THIRTY_DAYS,
    '2026-05-31',
    JSON.stringify([]),
    JSON.stringify([idCrossBriefing]),
  );
});

describe('읽음/북마크 상태관리 백엔드 (RED 박제)', () => {
  // AC1: getDb() 후 item_status 테이블이 존재
  it('AC1: item_status 테이블이 존재한다', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='item_status'`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('item_status');
  });

  // AC2: POST /api/status { isRead:true } → state.isRead=true, isBookmarked=false, DB is_read=1
  it('AC2: isRead:true 설정 → state 반영 + DB is_read=1', async () => {
    const res = await postStatus({ itemId: idRead, isRead: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { isRead: boolean; isBookmarked: boolean } };
    expect(body.state.isRead).toBe(true);
    expect(body.state.isBookmarked).toBe(false);

    const row = db
      .prepare('SELECT is_read FROM item_status WHERE item_id = ?')
      .get(idRead) as { is_read: number } | undefined;
    expect(row?.is_read).toBe(1);
  });

  // AC3: POST /api/status { isBookmarked:true } → state.isBookmarked=true
  it('AC3: isBookmarked:true 설정 → state.isBookmarked=true', async () => {
    const res = await postStatus({ itemId: idBook, isBookmarked: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { isBookmarked: boolean } };
    expect(body.state.isBookmarked).toBe(true);
  });

  // AC4: 부분 업데이트 — isBookmarked:true 후 isRead:true 만 보내도 둘 다 유지(덮어쓰지 않음)
  it('AC4: 부분 업데이트는 다른 필드를 덮어쓰지 않는다', async () => {
    await postStatus({ itemId: idPartial, isBookmarked: true });
    const res = await postStatus({ itemId: idPartial, isRead: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { isRead: boolean; isBookmarked: boolean } };
    expect(body.state.isBookmarked).toBe(true);
    expect(body.state.isRead).toBe(true);
  });

  // AC5: 토글 오프 — isRead:true 후 isRead:false → state.isRead=false, DB is_read=0
  it('AC5: isRead:false 로 토글 오프 → state.isRead=false + DB is_read=0', async () => {
    await postStatus({ itemId: idRead, isRead: true });
    const res = await postStatus({ itemId: idRead, isRead: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { isRead: boolean } };
    expect(body.state.isRead).toBe(false);

    const row = db
      .prepare('SELECT is_read FROM item_status WHERE item_id = ?')
      .get(idRead) as { is_read: number } | undefined;
    expect(row?.is_read).toBe(0);
  });

  // AC6: GET /api/briefing 각 item 에 isRead/isBookmarked 불리언 포함 (미설정 item 은 기본 false)
  it('AC6: briefing item 에 isRead/isBookmarked 불리언 포함(기본 false)', async () => {
    const { briefing } = await getBriefing();
    const item = findInView(briefing, idView);
    expect(item).toBeDefined();
    expect(item.isRead).toBe(false);
    expect(item.isBookmarked).toBe(false);
  });

  // AC7: POST /api/read 시 read_events + item_status.is_read=1 → 이후 briefing isRead=true
  it('AC7: POST /api/read 가 자동 읽음 처리(item_status.is_read=1)', async () => {
    const res = await app.request('/api/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: idView }),
    });
    expect(res.status).toBe(200);

    const { briefing } = await getBriefing();
    const item = findInView(briefing, idView);
    expect(item).toBeDefined();
    expect(item.isRead).toBe(true);
  });

  // AC8: GET /api/bookmarks → 북마크된 item 배열(title/url/genre 포함), 해제분 제외.
  // 스펙: 특정 브리핑/48h 창에 한정되지 않고 여러 브리핑에 걸쳐 영구 반환.
  // 멤버십은 스펙 명시 필드인 url 로 단언(id 미반환 구현도 정답일 수 있어 over-spec 회피).
  it('AC8: GET /api/bookmarks 는 북마크된 item 만 반환(해제분 제외, 브리핑·48h 창 무관 영구)', async () => {
    // (a) 현재 브리핑 내 아이템 북마크
    await postStatus({ itemId: idBookmarkList, isBookmarked: true });
    // (b) 북마크 후 해제 → 결과에서 빠져야 함
    await postStatus({ itemId: idBook, isBookmarked: true });
    await postStatus({ itemId: idBook, isBookmarked: false });
    // (c) 변별 케이스: 오래된 별도 브리핑 + 48h 밖 아이템 북마크 → 그래도 포함돼야 함.
    //     "현재 브리핑만"/"48h 창만" 반환하는 naive 구현은 이 단언에서 RED 로 걸린다.
    await postStatus({ itemId: idCrossBriefing, isBookmarked: true });

    const res = await app.request('/api/bookmarks', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookmarks: any[] };
    expect(Array.isArray(body.bookmarks)).toBe(true);

    const urls = body.bookmarks.map((b) => b.url);
    expect(urls).toContain(urlOf('bookmark-list-target')); // 현재 브리핑 북마크 포함
    expect(urls).toContain(urlOf('cross-briefing-target')); // 영구성: 오래된 브리핑·48h 밖도 포함
    expect(urls).not.toContain(urlOf('book-target')); // 해제분 제외

    const picked = body.bookmarks.find((b) => b.url === urlOf('cross-briefing-target'));
    expect(picked).toBeDefined();
    expect(typeof picked.title).toBe('string');
    expect(typeof picked.url).toBe('string');
    expect('genre' in picked).toBe(true);
  });

  // AC9(회귀 방어): /api/bookmarks 는 '북마크한 시각'순으로 정렬되고, 글을 '읽기'만 해도
  // 순서가 바뀌면 안 된다. (updated_at 을 정렬키로 겸용하면 읽기로 목록이 재정렬되는 버그 — 방어)
  it('AC9: 북마크 정렬은 북마크 시각순이고 읽어도 재정렬되지 않는다', async () => {
    const idOlder = insertItem('order-older');
    const idNewer = insertItem('order-newer');
    await postStatus({ itemId: idOlder, isBookmarked: true });
    await postStatus({ itemId: idNewer, isBookmarked: true });
    // 결정적 선행조건: older 를 먼저(과거 시각), newer 를 나중(최근 시각) 북마크한 상태로 고정
    db.prepare('UPDATE item_status SET bookmarked_at = 1000, updated_at = 1000 WHERE item_id = ?').run(idOlder);
    db.prepare('UPDATE item_status SET bookmarked_at = 2000, updated_at = 2000 WHERE item_id = ?').run(idNewer);

    const order1 = ((await (await app.request('/api/bookmarks', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { bookmarks: any[] }).bookmarks.map((b) => b.url);
    const iOlder1 = order1.indexOf(urlOf('order-older'));
    const iNewer1 = order1.indexOf(urlOf('order-newer'));
    expect(iOlder1).toBeGreaterThanOrEqual(0);
    expect(iNewer1).toBeGreaterThanOrEqual(0);
    expect(iNewer1).toBeLessThan(iOlder1); // 최근 북마크가 위

    // older 를 '읽기'(updated_at 갱신) — 북마크 정렬에는 영향 없어야 함
    await app.request('/api/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: idOlder }),
    });
    const order2 = ((await (await app.request('/api/bookmarks', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { bookmarks: any[] }).bookmarks.map((b) => b.url);
    expect(order2.indexOf(urlOf('order-newer'))).toBeLessThan(order2.indexOf(urlOf('order-older')));
  });
});
