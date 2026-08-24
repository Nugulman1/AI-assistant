import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDb, type ItemRow } from './db.js';
import { env } from './env.js';
import { generateBriefing, getBriefingView, loadMore, recommendBriefing } from './briefing.js';
import { getItemDetail, generateDeep, askItem } from './item-detail.js';
import { collectAndStoreBest, getBestStored } from './best.js';
import type { BestPeriod } from './sources/hn-best.js';
import { collectAndStoreTrending, getTrendingView, summarizeTrendingRepos } from './github-best.js';
import { runExclusive } from './collect.js';
import type { TrendingPeriod } from './sources/github-trending.js';
import { saveSubscription, type PushSub } from './push.js';
import { scheduleJobs } from './scheduler.js';

export function buildApp() {
  const app = new Hono();

  app.use('*', cors({ origin: env.webOrigin, allowHeaders: ['Content-Type', 'Authorization'] }));

  // ── 공개 ──
  app.get('/api/health', (c) =>
    c.json({ ok: true, ai: env.ollamaModel || env.anthropicApiKey ? 'on' : 'off' }),
  );

  app.get('/api/push/key', (c) => c.json({ publicKey: env.vapidPublicKey }));

  // 로컬 전용 앱 — 인증 계층 제거(외부 노출 시 재도입 필요).
  const api = new Hono();

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

  // 코더 추천 (재)생성 — 추천 없이 만들어진 브리핑(구버전·AI 실패)의 소급 채움용.
  // 아이템을 새로 만들지 않고 저장된 요약만 읽으므로 과거 브리핑도 허용(더보기 갱신과 다름).
  api.post('/briefing/:id/recommend', async (c) => {
    try {
      const picks = await recommendBriefing(Number(c.req.param('id')));
      if (picks.length === 0) return c.json({ error: '추천 생성 실패(AI 백엔드 확인)' }, 500);
      const view = getBriefingView(Number(c.req.param('id')));
      return c.json({ coderPicks: view?.coderPicks ?? [] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  // ── 글 상세 — 심층 요약·기사 기반 질문 ──
  api.get('/item/:id', (c) => {
    const view = getItemDetail(Number(c.req.param('id')));
    if (!view) return c.json({ error: '없음' }, 404);
    return c.json({ item: view });
  });

  // 심층 요약 생성(+캐시). 로컬 LLM이라 수십 초 걸릴 수 있음 — 동기 대기 응답.
  api.post('/item/:id/deep', async (c) => {
    try {
      const deep = await generateDeep(Number(c.req.param('id')));
      return c.json({ deep });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  // 기사 기반 질문. history 는 클라이언트 보관(서버 무저장) — [{role,content}] 최근 10턴만 수용.
  api.post('/item/:id/ask', async (c) => {
    type AskBody = { question?: string; history?: { role: string; content: string }[] };
    const body = await c.req.json<AskBody>().catch(() => ({}) as AskBody);
    const question = (body.question ?? '').trim();
    if (!question) return c.json({ error: '질문이 비어 있습니다' }, 400);
    const history = (body.history ?? [])
      .filter(
        (m): m is { role: 'user' | 'assistant'; content: string } =>
          (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
      )
      .slice(-10);
    try {
      const answer = await askItem(Number(c.req.param('id')), question, history);
      return c.json({ answer });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  // ── 온디맨드 수집 (버튼 트리거) ──
  // 동기 대기 응답(/briefing/:id/more 와 동형). runExclusive 가 null 이면 이미 실행 중 → 409.
  api.post('/collect/briefing', async (c) => {
    try {
      const result = await runExclusive('briefing', () => generateBriefing());
      if (result === null) return c.json({ error: '이미 수집 중입니다' }, 409);
      return c.json({ result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  api.post('/collect/best', async (c) => {
    try {
      const results = await runExclusive('best', () => collectAndStoreBest());
      if (results === null) return c.json({ error: '이미 수집 중입니다' }, 409);
      return c.json({ results });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 500);
    }
  });

  api.post('/collect/github', async (c) => {
    try {
      const out = await runExclusive('github', async () => {
        const results = await collectAndStoreTrending();
        const summarized = await summarizeTrendingRepos();
        return { results, summarized };
      });
      if (out === null) return c.json({ error: '이미 수집 중입니다' }, 409);
      return c.json(out);
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
    const items = getTrendingView(period);
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
      auto_collect?: boolean;
    }>();
    const db = getDb();
    const cur = db.prepare('SELECT * FROM config WHERE id = 1').get() as Record<
      string,
      unknown
    >;
    db.prepare(
      `UPDATE config SET arrival_time = ?, lead_minutes = ?, more_count = ?, timezone = ?,
        auto_collect = ?
       WHERE id = 1`,
    ).run(
      body.arrival_time ?? cur.arrival_time,
      body.lead_minutes ?? cur.lead_minutes,
      body.more_count ?? cur.more_count,
      body.timezone ?? cur.timezone,
      body.auto_collect === undefined ? cur.auto_collect : body.auto_collect ? 1 : 0,
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
