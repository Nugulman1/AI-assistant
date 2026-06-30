import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

/** 8장르 — AI 장르 분류의 폐쇄 집합(적합도 점수 아님, 태깅용). */
export const GENRES = [
  'AI/LLM·에이전트',
  '시스템·인프라·저수준',
  '보안',
  '논문·연구',
  '언어·런타임·도구',
  '웹·프론트',
  '제품·창업·회고',
  '기타',
] as const;
export type Genre = (typeof GENRES)[number];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  arrival_time TEXT NOT NULL DEFAULT '05:00',   -- 완성품 도착 시각 HH:MM
  lead_minutes INTEGER NOT NULL DEFAULT 30,     -- 도착 N분 전에 수집·AI 시작 (05:00 도착 → 04:30 수집)
  more_count   INTEGER NOT NULL DEFAULT 7,      -- '더보기' 한줄 개수
  timezone     TEXT NOT NULL DEFAULT 'Asia/Seoul'
);

CREATE TABLE IF NOT EXISTS sources (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  type    TEXT NOT NULL,            -- 'rss' | 'hackernews' | 'reddit'
  name    TEXT NOT NULL,
  url     TEXT NOT NULL,            -- 피드 URL, 또는 reddit subreddit, hn 는 placeholder
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  external_id  TEXT,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  author       TEXT,
  score        INTEGER NOT NULL DEFAULT 0,   -- 화제도 원신호 (HN/Reddit 점수)
  comments     INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,                       -- epoch ms
  fetched_at   INTEGER NOT NULL,
  topicality   REAL NOT NULL DEFAULT 0,       -- 소스별 z-점수 정규화 화제도
  genre        TEXT,
  summary      TEXT,
  summary_type TEXT,                          -- 'must_read' | 'more' | null
  briefing_id  INTEGER REFERENCES briefings(id)
);
CREATE INDEX IF NOT EXISTS idx_items_briefing ON items(briefing_id);

CREATE TABLE IF NOT EXISTS seen (
  url_hash      TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS briefings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER NOT NULL,
  arrival_date TEXT NOT NULL,        -- YYYY-MM-DD
  must_read_json TEXT NOT NULL,      -- item id 배열
  more_json      TEXT NOT NULL       -- item id 배열
);

CREATE TABLE IF NOT EXISTS push_subs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS read_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  genre      TEXT,
  clicked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_read_genre ON read_events(genre);

-- interests 테이블은 v2 가중치용 예약 (지금은 비움)
CREATE TABLE IF NOT EXISTS interests (
  genre   TEXT PRIMARY KEY,
  weight  REAL NOT NULL DEFAULT 0
);

-- 좋아요/관심없음 주신호. 아이템당 1행(토글·갱신은 UPSERT/DELETE). reason 은 v1 저장만(학습 미사용).
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  genre      TEXT,                                       -- 기록 시점 item.genre 스냅샷
  kind       TEXT NOT NULL CHECK (kind IN ('like','dislike')),
  reason     TEXT,                                       -- nullable raw text
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_item_unique ON feedback(item_id);
CREATE INDEX IF NOT EXISTS idx_feedback_genre ON feedback(genre);

-- 더보기 후보 대기열(휘발성 풀): 수집 시 첫 묶음(필독3+더보기7) 외 나머지 후보 전체를 보관.
-- '갱신'(loadMore) 때만 다음 N건을 그때 요약해 items 로 승격(shown=1). 다음 수집이 통째 교체.
-- items/feedback/대시보드 통계가 '안 본 후보'로 오염되지 않게 별 테이블로 격리.
CREATE TABLE IF NOT EXISTS candidate_pool (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  collected_at INTEGER NOT NULL,
  rank         INTEGER NOT NULL,              -- 더보기 순위(작을수록 먼저)
  source_id    INTEGER NOT NULL,
  external_id  TEXT,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  author       TEXT,
  score        INTEGER,
  comments     INTEGER,
  published_at INTEGER,
  topicality   REAL,
  genre        TEXT,
  body         TEXT,
  external_url TEXT,
  url_hash     TEXT NOT NULL,
  shown        INTEGER NOT NULL DEFAULT 0,
  item_id      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pool_rank ON candidate_pool(shown, rank);

-- HN 기간별 베스트(주/월/년). 48h 메인 파이프라인(items/seen/feedback/대시보드)과 격리한 별도 경로.
-- '지금 화제'가 아니라 '기간 누적 화제' — 수집 시 period 별로 통째 교체(candidate_pool 과 같은 패턴).
CREATE TABLE IF NOT EXISTS best_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period       TEXT NOT NULL,                 -- 'week' | 'month' | 'year'
  rank         INTEGER NOT NULL,              -- points 내림차순 순위(1부터)
  external_id  TEXT,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,                 -- HN 토론 링크
  external_url TEXT,                          -- 외부 원문(있으면)
  author       TEXT,
  points       INTEGER NOT NULL DEFAULT 0,
  comments     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER,                       -- 글 작성 epoch ms
  collected_at INTEGER NOT NULL               -- 수집 시각 epoch ms
);
CREATE INDEX IF NOT EXISTS idx_best_period_rank ON best_items(period, rank);

-- GitHub 트렌딩(일/주/월). HN 베스트(best_items)와 동형 격리 경로 — 48h 메인 파이프라인과 분리.
-- github.com/trending 의 기간별 급상승 리포. 수집 시 period 별로 통째 교체.
CREATE TABLE IF NOT EXISTS github_trending (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period       TEXT NOT NULL,                 -- 'daily' | 'weekly' | 'monthly'
  rank         INTEGER NOT NULL,              -- 노출 순서(1부터)
  name         TEXT NOT NULL,                 -- 'owner/repo'
  url          TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  language     TEXT,
  stars        INTEGER NOT NULL DEFAULT 0,
  period_stars INTEGER NOT NULL DEFAULT 0,    -- 해당 기간 증가분("N stars today")
  collected_at INTEGER NOT NULL               -- 수집 시각 epoch ms
);
CREATE INDEX IF NOT EXISTS idx_gh_trending_period_rank ON github_trending(period, rank);
`;

/** v1 기본 소스 — BUILD.md 게이트의 기본값. PWA 설정에서 수정 가능. */
const DEFAULT_SOURCES: { type: string; name: string; url: string }[] = [
  { type: 'hackernews', name: 'Hacker News', url: 'top' },
  // Reddit 은 무인증 .json/HTML 접근을 엣지에서 403 차단(2023 API 정책) — 비활성. OAuth API 전환 전까지 제외.
  { type: 'rss', name: 'Rust 블로그', url: 'https://blog.rust-lang.org/feed.xml' },
  { type: 'rss', name: 'Go 블로그', url: 'https://go.dev/blog/feed.atom' },
  { type: 'rss', name: 'arXiv cs.AI', url: 'https://rss.arxiv.org/rss/cs.AI' },
  { type: 'rss', name: 'arXiv cs.SE', url: 'https://rss.arxiv.org/rss/cs.SE' },
];

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
  const db = new Database(env.dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  // 마이그레이션: read_events 를 아이템당 1건으로. 같은 글을 다시 클릭해도
  // 대시보드 장르 신호가 부풀지 않게(=진짜 관심사 왜곡 방지). 기존 중복은 첫 클릭만 남기고 정리.
  db.exec(`
    DELETE FROM read_events
     WHERE id NOT IN (SELECT MIN(id) FROM read_events GROUP BY item_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_read_item_unique ON read_events(item_id);
  `);

  // 기본 config 시드 (1행)
  const cfgCount = db.prepare('SELECT COUNT(*) AS n FROM config').get() as { n: number };
  if (cfgCount.n === 0) {
    db.prepare(
      `INSERT INTO config (id, arrival_time, lead_minutes, more_count, timezone)
       VALUES (1, '05:00', 30, 7, ?)`,
    ).run(env.tz);
  } else {
    // 마이그레이션: 옛 기본값(lead 15분)인 기존 행을 4:30 수집(lead 30)으로 1회 갱신.
    // 이미 30이거나 사용자가 따로 바꾼 값(≠15)은 건드리지 않는다.
    db.prepare('UPDATE config SET lead_minutes = 30 WHERE id = 1 AND lead_minutes = 15').run();
  }

  // 기본 소스 시드 (비어 있을 때만)
  const srcCount = db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number };
  if (srcCount.n === 0) {
    const ins = db.prepare(
      'INSERT INTO sources (type, name, url, enabled) VALUES (?, ?, ?, 1)',
    );
    const tx = db.transaction(() => {
      for (const s of DEFAULT_SOURCES) ins.run(s.type, s.name, s.url);
    });
    tx();
  }

  _db = db;
  return db;
}

export interface SourceRow {
  id: number;
  type: 'rss' | 'hackernews' | 'reddit';
  name: string;
  url: string;
  enabled: number;
}

export interface ConfigRow {
  id: number;
  arrival_time: string;
  lead_minutes: number;
  more_count: number;
  timezone: string;
}

export interface ItemRow {
  id: number;
  source_id: number;
  external_id: string | null;
  title: string;
  url: string;
  author: string | null;
  score: number;
  comments: number;
  published_at: number | null;
  fetched_at: number;
  topicality: number;
  genre: string | null;
  summary: string | null;
  summary_type: string | null;
  briefing_id: number | null;
}

export interface BestItemRow {
  id: number;
  period: 'week' | 'month' | 'year';
  rank: number;
  external_id: string | null;
  title: string;
  url: string;
  external_url: string | null;
  author: string | null;
  points: number;
  comments: number;
  created_at: number | null;
  collected_at: number;
}

export interface FeedbackRow {
  id: number;
  item_id: number;
  genre: string | null;
  kind: 'like' | 'dislike';
  reason: string | null;
  created_at: number;
}

export const getConfig = (): ConfigRow =>
  getDb().prepare('SELECT * FROM config WHERE id = 1').get() as ConfigRow;

export const getEnabledSources = (): SourceRow[] =>
  getDb().prepare('SELECT * FROM sources WHERE enabled = 1').all() as SourceRow[];
