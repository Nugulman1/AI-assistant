/**
 * 글 상세 — 원문 확보(크롤링+캐시) → 심층 요약 생성 → 기사 기반 Q&A.
 * HN 글은 url 이 토론 페이지라서 HN API 로 외부 원문 링크를 풀어 크롤링한다.
 */
import { getDb, type ItemRow } from './db.js';
import { fetchArticleText } from './sources/fulltext.js';
import { deepSummarize, askAboutArticle, type DeepSummary } from './ai/deep.js';
import type { ChatMessage } from './ai/client.js';

interface DeepRow {
  item_id: number;
  body: string | null;
  deep_json: string | null;
  created_at: number;
}

const getItem = (id: number): ItemRow | undefined =>
  getDb().prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;

const getDeepRow = (id: number): DeepRow | undefined =>
  getDb().prepare('SELECT * FROM item_deep WHERE item_id = ?').get(id) as
    | DeepRow
    | undefined;

/** HN 토론 링크면 HN API 로 외부 원문 url(없으면 텍스트 본문)을 푼다. */
async function resolveHn(
  item: ItemRow,
): Promise<{ url?: string; text?: string } | null> {
  if (!/news\.ycombinator\.com/.test(item.url) || !item.external_id) return null;
  try {
    const res = await fetch(
      `https://hacker-news.firebaseio.com/v0/item/${item.external_id}.json`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string; text?: string } | null;
    if (!data) return null;
    // text 는 Ask HN 류 자체 글(HTML) — 태그만 벗겨 본문으로 쓴다.
    const text = data.text?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return { url: data.url, text };
  } catch {
    return null;
  }
}

/** 원문 본문 확보 — 캐시 우선, 없으면 크롤링 후 캐시. 실패 시 undefined. */
async function ensureBody(item: ItemRow): Promise<string | undefined> {
  const cached = getDeepRow(item.id);
  if (cached?.body) return cached.body;

  let body: string | undefined;
  const hn = await resolveHn(item);
  if (hn?.url) body = await fetchArticleText(hn.url);
  else if (hn?.text) body = hn.text;
  else body = await fetchArticleText(item.url);
  if (!body) return undefined;

  getDb()
    .prepare(
      `INSERT INTO item_deep (item_id, body, created_at) VALUES (?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET body = excluded.body`,
    )
    .run(item.id, body, Date.now());
  return body;
}

export interface ItemDetailView {
  id: number;
  title: string;
  url: string;
  genre: string | null;
  source: string | null;
  score: number;
  comments: number;
  summaryType: string | null;
  cardSummary: string; // 브리핑 카드에 쓰인 기존 요약(한줄 또는 헤드라인+본문)
  deep: DeepSummary | null; // 심층 요약(캐시), 없으면 null
}

/** 상세 화면 조립 — 심층 요약은 캐시만 읽는다(생성은 별도 POST). */
export function getItemDetail(itemId: number): ItemDetailView | null {
  const item = getItem(itemId);
  if (!item) return null;
  const source = getDb()
    .prepare('SELECT name FROM sources WHERE id = ?')
    .get(item.source_id) as { name: string } | undefined;

  let cardSummary = item.summary ?? item.title;
  if (item.summary_type === 'must_read') {
    try {
      const p = JSON.parse(item.summary ?? '{}');
      cardSummary = [p.headline, p.body].filter(Boolean).join(' — ') || item.title;
    } catch {
      cardSummary = item.title;
    }
  }

  let deep: DeepSummary | null = null;
  const row = getDeepRow(itemId);
  if (row?.deep_json) {
    try {
      deep = JSON.parse(row.deep_json);
    } catch {
      deep = null;
    }
  }

  return {
    id: item.id,
    title: item.title,
    url: item.url,
    genre: item.genre,
    source: source?.name ?? null,
    score: item.score,
    comments: item.comments,
    summaryType: item.summary_type,
    cardSummary,
    deep,
  };
}

/** 심층 요약 생성(+캐시). 원문 확보 실패·AI 실패는 throw — 라우트가 메시지 전달. */
export async function generateDeep(itemId: number): Promise<DeepSummary> {
  const item = getItem(itemId);
  if (!item) throw new Error('글이 없습니다');
  const body = await ensureBody(item);
  if (!body) throw new Error('원문을 가져올 수 없습니다 (페이월·비HTML 등) — 원문 링크로 직접 확인하세요');

  const deep = await deepSummarize(item.title, body);
  getDb()
    .prepare(
      `INSERT INTO item_deep (item_id, body, deep_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET deep_json = excluded.deep_json`,
    )
    .run(item.id, body, JSON.stringify(deep), Date.now());
  return deep;
}

/** 기사 기반 질문 답변. history 는 클라이언트가 들고 온다(서버 무저장). */
export async function askItem(
  itemId: number,
  question: string,
  history: ChatMessage[],
): Promise<string> {
  const item = getItem(itemId);
  if (!item) throw new Error('글이 없습니다');
  const body = await ensureBody(item);
  if (!body) throw new Error('원문을 가져올 수 없어 질문에 답할 수 없습니다');
  return askAboutArticle(item.title, body, history, question);
}
