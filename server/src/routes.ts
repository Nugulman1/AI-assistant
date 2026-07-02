import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDb, type ItemRow } from './db.js';
import { env } from './env.js';
import { login, requireAuth } from './auth.js';
import { getBriefingView, loadMore } from './briefing.js';
import { getBestStored } from './best.js';
import type { BestPeriod } from './sources/hn-best.js';
import { getTrendingStored } from './github-best.js';
import type { TrendingPeriod } from './sources/github-trending.js';
import { saveSubscription, type PushSub } from './push.js';
import { scheduleJobs } from './scheduler.js';

export function buildApp() {
  const app = new Hono();

  app.use('*', cors({ origin: env.webOrigin, allowHeaders: ['Content-Type', 'Authorization'] }));

  // ── 공개 ──
  app.get('/api/health', (c) =>
    c.json({ ok: true, ai: env.anthropicApiKey ? 'on' : 'off' }),
  );

  app.get('/api/push/key', (c) => c.json({ publicKey: env.vapidPublicKey }));

  app.post('/api/login', async (c) => {
    const { passcode } = await c.req.json<{ passcode?: string }>();
    const token = await login(passcode ?? '');
    if (!token) return c.json({ error: '패스코드가 틀렸습니다' }, 401);
    return c.json({ token });
  });

  // ── 인증 필요 ──
  const api = new Hono();
  api.use('*', requireAuth);

  // 최신 브리핑
  api.get('/briefing', (c) => {
    const view = getBriefingView();
    if (!view) return c.json({ briefing: null });
    return c.json({ briefing: view });
  });

  // 특정 날짜 브리핑 (과거 조회). 같은 날짜 복수면 최신(id 큰 쪽). :id 라우트보다 먼저 등록해
  // '/briefing/by-date/2026-07-01' 이 ':id' 파라미터로 가로채이지 않게 함.
  api.get('/briefing/by-date/:date', (c) => {
    const date = c.req.param('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: '날짜 형식 오류 (YYYY-MM-DD)' }, 400);
    const row = getDb()
      .prepare('SELECT id FROM briefings WHERE arrival_date = ? ORDER BY id DESC LIMIT 1')
      .get(date) as { id: number } | undefined;
    if (!row) return c.json({ error: '없음' }, 404);
    const view = getBriefingView(row.id);
    if (!view) return c.json({ error: '없음' }, 404);
    return c.json({ briefing: view });
  });

  // 특정 브리핑
  api.get('/briefing/:id', (c) => {
    const view = getBriefingView(Number(c.req.param('id')));
    if (!view) return c.json({ error: '없음' }, 404);
    return c.json({ briefing: view });
  });

  // 갱신: 풀에서 다음 n건을 lazy 요약해 더보기에 추가.
  // 최신 브리핑 전용 — candidate_pool 은 최신 수집 run 소유의 전역 대기열이라,
  // 과거 브리핑 id 로 승격하면 오늘 후보가 과거 more_json 에 영구 부착되고 오늘 몫이 소진된다.
  api.post('/briefing/:id/more', async (c) => {
    const id = Number(c.req.param('id'));
    const latest = getDb()
      .prepare('SELECT id FROM briefings ORDER BY created_at DESC, id DESC LIMIT 1')
      .get() as { id: number } | undefined;
    if (!latest || id !== latest.id) {
      return c.json({ error: '지난 브리핑에서는 갱신할 수 없습니다' }, 409);
    }
    const body = await c.req.json<{ n?: number }>().catch(() => ({}) as { n?: number });
    try {
      const cfg = getDb().prepare('SELECT more_count FROM config WHERE id = 1').get() as {
        more_count: number;
      };
      const n = body.n && body.n > 0 ? body.n : cfg.more_count;
      const result = await loadMore(id, n);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  // 브리핑 목록. 정렬키를 getBriefingView의 최신 선택(created_at DESC, id DESC)과 통일 —
  // 시계역행으로 created_at·id가 역전돼도 목록 첫 항목 = /api/briefing의 최신이 보장됨.
  api.get('/briefings', (c) => {
    const rows = getDb()
      .prepare(
        'SELECT id, arrival_date, created_at FROM briefings ORDER BY created_at DESC, id DESC LIMIT 30',
      )
      .all();
    return c.json({ briefings: rows });
  });

  // HN 기간별 베스트 — period=week|month|year (기본 week). 48h 브리핑과 별도 탭.
  api.get('/best', (c) => {
    const raw = c.req.query('period') ?? 'week';
    const valid: BestPeriod[] = ['week', 'month', 'year'];
    const period = (valid as string[]).includes(raw) ? (raw as BestPeriod) : 'week';
    const items = getBestStored(period);
    const collectedAt = items[0]?.collected_at ?? null;
    return c.json({ period, collectedAt, items });
  });

  // GitHub 트렌딩 — period=daily|weekly|monthly (기본 daily). 48h 브리핑과 별도 탭.
  api.get('/github-trending', (c) => {
    const raw = c.req.query('period') ?? 'daily';
    const valid: TrendingPeriod[] = ['daily', 'weekly', 'monthly'];
    const period = (valid as string[]).includes(raw) ? (raw as TrendingPeriod) : 'daily';
    const items = getTrendingStored(period);
    const collectedAt = items[0]?.collected_at ?? null;
    return c.json({ period, collectedAt, items });
  });

  // 읽기 이벤트 기록 (대시보드 학습 원천)
  api.post('/read', async (c) => {
    const { itemId } = await c.req.json<{ itemId?: number }>();
    if (!itemId) return c.json({ error: 'itemId 필요' }, 400);
    const db = getDb();
    const item = db.prepare('SELECT genre FROM items WHERE id = ?').get(itemId) as
      | { genre: string | null }
      | undefined;
    if (!item) return c.json({ error: '아이템 없음' }, 404);
    // 아이템당 1건만 — 같은 글 재클릭은 무시(대시보드 신호 부풀림 방지)
    db.prepare(
      'INSERT OR IGNORE INTO read_events (item_id, genre, clicked_at) VALUES (?, ?, ?)',
    ).run(itemId, item.genre, Date.now());
    // 원문 클릭 = 자동 읽음. is_read=1 설정(북마크 상태는 보존).
    db.prepare(
      `INSERT INTO item_status (item_id, is_read, is_bookmarked, updated_at)
       VALUES (?, 1, 0, ?)
       ON CONFLICT(item_id) DO UPDATE SET is_read = 1, updated_at = excluded.updated_at`,
    ).run(itemId, Date.now());
    return c.json({ ok: true });
  });

  // 읽음/북마크 상태 토글 (부분 업데이트: 보낸 필드만 변경, 안 보낸 필드는 유지)
  api.post('/status', async (c) => {
    const { itemId, isRead, isBookmarked } = await c.req.json<{
      itemId?: number;
      isRead?: boolean;
      isBookmarked?: boolean;
    }>();
    if (!itemId) return c.json({ error: 'itemId 필요' }, 400);
    const db = getDb();
    const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId) as
      | { id: number }
      | undefined;
    if (!item) return c.json({ error: '아이템 없음' }, 404);

    const cur = db
      .prepare('SELECT is_read, is_bookmarked, bookmarked_at FROM item_status WHERE item_id = ?')
      .get(itemId) as
      | { is_read: number; is_bookmarked: number; bookmarked_at: number | null }
      | undefined;
    const curRead = cur?.is_read ?? 0;
    const curBook = cur?.is_bookmarked ?? 0;
    const curBookAt = cur?.bookmarked_at ?? null;

    // 불리언일 때만 변경, 아니면 기존값 유지. null·문자열·미전송 모두 "변경 안 함".
    const newRead = typeof isRead === 'boolean' ? (isRead ? 1 : 0) : curRead;
    const newBook = typeof isBookmarked === 'boolean' ? (isBookmarked ? 1 : 0) : curBook;

    // 바꿀 불리언 필드가 하나도 없으면 write 없이 현재 상태 반환(잡행 0,0 생성 방지).
    if (typeof isRead !== 'boolean' && typeof isBookmarked !== 'boolean') {
      return c.json({ state: { isRead: !!curRead, isBookmarked: !!curBook } });
    }

    // 북마크 정렬 기준: '켤 때'만 시각 기록. 이미 1이면 유지(재북마크로 맨 위 점프 안 함).
    // 0으로 끄면 null 로 비움. 읽기/읽음토글 경로는 이 컬럼을 건드리지 않는다.
    let newBookAt = curBookAt;
    if (newBook === 1 && curBook === 0) newBookAt = Date.now();
    else if (newBook === 0) newBookAt = null;

    db.prepare(
      `INSERT INTO item_status (item_id, is_read, is_bookmarked, bookmarked_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         is_read = excluded.is_read,
         is_bookmarked = excluded.is_bookmarked,
         bookmarked_at = excluded.bookmarked_at,
         updated_at = excluded.updated_at`,
    ).run(itemId, newRead, newBook, newBookAt, Date.now());
    return c.json({ state: { isRead: !!newRead, isBookmarked: !!newBook } });
  });

  // 북마크 모음 — 48h 창/브리핑 무관, 북마크된 모든 item 영구 반환(해제분 제외).
  api.get('/bookmarks', (c) => {
    const rows = getDb()
      .prepare(
        `SELECT items.*, sources.name AS source_name
           FROM item_status
           JOIN items ON items.id = item_status.item_id
           LEFT JOIN sources ON sources.id = items.source_id
          WHERE item_status.is_bookmarked = 1
          ORDER BY COALESCE(item_status.bookmarked_at, item_status.updated_at) DESC,
                   items.id DESC`,
      )
      .all() as (ItemRow & { source_name: string | null })[];
    const bookmarks = rows.map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url,
      genre: it.genre,
      source: it.source_name,
      score: it.score,
      comments: it.comments,
    }));
    return c.json({ bookmarks });
  });

  // 좋아요/관심없음 기록 (주신호). 같은 버튼 재클릭(이유 없이)=토글 오프, 그 외=UPSERT.
  api.post('/feedback', async (c) => {
    const { itemId, kind, reason } = await c.req.json<{
      itemId?: number;
      kind?: 'like' | 'dislike';
      reason?: string;
    }>();
    if (!itemId || (kind !== 'like' && kind !== 'dislike'))
      return c.json({ error: 'itemId/kind 필요' }, 400);
    const db = getDb();
    const item = db.prepare('SELECT genre FROM items WHERE id = ?').get(itemId) as
      | { genre: string | null }
      | undefined;
    if (!item) return c.json({ error: '아이템 없음' }, 404);

    const cur = db.prepare('SELECT kind FROM feedback WHERE item_id = ?').get(itemId) as
      | { kind: 'like' | 'dislike' }
      | undefined;
    // 같은 버튼을 이유 없이 다시 누르면 취소(토글 오프)
    if (cur?.kind === kind && (reason == null || reason === '')) {
      db.prepare('DELETE FROM feedback WHERE item_id = ?').run(itemId);
      return c.json({ ok: true, state: null });
    }
    db.prepare(
      `INSERT INTO feedback (item_id, genre, kind, reason, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         kind = excluded.kind, reason = excluded.reason, created_at = excluded.created_at`,
    ).run(itemId, item.genre, kind, reason ?? null, Date.now());
    return c.json({ ok: true, state: kind });
  });

  // 대시보드: 장르별 클릭 vs 코퍼스 분포
  api.get('/dashboard', (c) => {
    const db = getDb();
    const clicks = db
      .prepare(
        `SELECT COALESCE(genre,'기타') AS genre, COUNT(*) AS clicks
         FROM read_events GROUP BY genre`,
      )
      .all() as { genre: string; clicks: number }[];
    const corpus = db
      .prepare(
        `SELECT COALESCE(genre,'기타') AS genre, COUNT(*) AS items
         FROM items GROUP BY genre`,
      )
      .all() as { genre: string; items: number }[];
    const totals = db
      .prepare('SELECT COUNT(*) AS reads FROM read_events')
      .get() as { reads: number };
    return c.json({ clicks, corpus, totalReads: totals.reads });
  });

  // 설정 get/set
  api.get('/config', (c) =>
    c.json(getDb().prepare('SELECT * FROM config WHERE id = 1').get()),
  );
  api.put('/config', async (c) => {
    const body = await c.req.json<{
      arrival_time?: string;
      lead_minutes?: number;
      more_count?: number;
      timezone?: string;
    }>();
    const db = getDb();
    const cur = db.prepare('SELECT * FROM config WHERE id = 1').get() as Record<
      string,
      unknown
    >;
    db.prepare(
      `UPDATE config SET arrival_time = ?, lead_minutes = ?, more_count = ?, timezone = ?
       WHERE id = 1`,
    ).run(
      body.arrival_time ?? cur.arrival_time,
      body.lead_minutes ?? cur.lead_minutes,
      body.more_count ?? cur.more_count,
      body.timezone ?? cur.timezone,
    );
    scheduleJobs(); // 시간 바뀌면 cron 재설치
    return c.json(db.prepare('SELECT * FROM config WHERE id = 1').get());
  });

  // 소스 CRUD
  api.get('/sources', (c) =>
    c.json(getDb().prepare('SELECT * FROM sources ORDER BY id').all()),
  );
  api.post('/sources', async (c) => {
    const { type, name, url } = await c.req.json<{
      type?: string;
      name?: string;
      url?: string;
    }>();
    if (!type || !name || !url) return c.json({ error: 'type/name/url 필요' }, 400);
    const info = getDb()
      .prepare('INSERT INTO sources (type, name, url, enabled) VALUES (?, ?, ?, 1)')
      .run(type, name, url);
    return c.json({ id: Number(info.lastInsertRowid) });
  });
  api.put('/sources/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<{ enabled?: boolean; name?: string; url?: string }>();
    const db = getDb();
    const cur = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
      | { name: string; url: string; enabled: number }
      | undefined;
    if (!cur) return c.json({ error: '없음' }, 404);
    db.prepare('UPDATE sources SET enabled = ?, name = ?, url = ? WHERE id = ?').run(
      body.enabled === undefined ? cur.enabled : body.enabled ? 1 : 0,
      body.name ?? cur.name,
      body.url ?? cur.url,
      id,
    );
    return c.json({ ok: true });
  });
  api.delete('/sources/:id', (c) => {
    getDb().prepare('DELETE FROM sources WHERE id = ?').run(Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  // 푸시 구독
  api.post('/push/subscribe', async (c) => {
    const sub = await c.req.json<PushSub>();
    if (!sub?.endpoint) return c.json({ error: '구독 정보 무효' }, 400);
    saveSubscription(sub);
    return c.json({ ok: true });
  });

  app.route('/api', api);

  // ── web 정적 서빙 (합친 서비스) ──
  // serveStatic은 절대경로 미지원·CWD 기준 상대경로만 받으므로 cwd 기준으로 변환.
  // web/build 가 있을 때만(=빌드된 배포 환경) 등록 — dev에선 vite가 web을 따로 서빙.
  if (existsSync(env.webDist)) {
    const rel = path.relative(process.cwd(), env.webDist) || '.';
    app.use('/*', serveStatic({ root: rel }));
    // SPA fallback: API 외 라우트(새로고침 등)는 index.html 로
    app.get('*', serveStatic({ path: path.join(rel, 'index.html') }));
  }

  return app;
}

export type { ItemRow };
