import {
  getDb,
  getConfig,
  getEnabledSources,
  type ItemRow,
} from './db.js';
import { collectAll } from './sources/index.js';
import { dedupAndMerge } from './pipeline/dedup.js';
import { normalizeTopicality } from './pipeline/normalize.js';
import { rank, type Rankable } from './pipeline/rank.js';
import { classifyGenres } from './ai/genre.js';
import { summarizeMustRead, summarizeMore } from './ai/summarize.js';

function localDate(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export interface GenerateResult {
  created: boolean; // 선정 0건이면 false — 빈 브리핑 안 만듦(기존 유지)
  briefingId: number | null;
  arrivalDate: string;
  mustReadCount: number;
  moreCount: number;
  candidateCount: number;
  dedupedCount: number;
}

/**
 * 한 번의 브리핑 생성:
 * 수집 → 중복/오래된것 컷(seen 제외) → 화제도 정규화 → 장르분류(Haiku, 후보 풀 전체)
 * → 랭킹(필독3+더보기) → 요약(Sonnet) → **선정된 것만** 저장·seen 기록 → 브리핑 저장.
 *
 * 핵심: 수집한 전체가 아니라 '실제로 보여줄 것'만 seen 에 기록한다. 그래야
 *  (1) 안 보여준 후보가 다음 브리핑에서 다시 후보가 되고(탐색 보존),
 *  (2) '새로 생성'을 눌러도 남은 후보로 꽉 찬 브리핑이 나온다(빈 브리핑 안 쌓임).
 * 선정 결과가 0건이면 빈 브리핑을 만들지 않는다.
 */
export async function generateBriefing(): Promise<GenerateResult> {
  const db = getDb();
  const cfg = getConfig();
  const sources = getEnabledSources();
  const arrivalDate = localDate(cfg.timezone);

  console.log(`[briefing] 수집 시작 (소스 ${sources.length}개)`);
  const cands = await collectAll(sources);
  console.log(`[briefing] 후보 ${cands.length}건 수집`);

  const pool = dedupAndMerge(cands, db); // seen 제외 + 중복병합 + 오래된것 컷
  normalizeTopicality(pool);
  console.log(`[briefing] 중복/과거 컷 후 ${pool.length}건`);

  const empty = (): GenerateResult => ({
    created: false,
    briefingId: null,
    arrivalDate,
    mustReadCount: 0,
    moreCount: 0,
    candidateCount: cands.length,
    dedupedCount: pool.length,
  });
  if (pool.length === 0) {
    console.log('[briefing] 새 후보 0건 — 브리핑 생성 건너뜀');
    return empty();
  }

  // 장르 분류 — 후보 풀 전체(더보기 전장르 샘플에 필요). id = 풀 인덱스.
  const genres = await classifyGenres(
    pool.map((p, i) => ({ id: i, title: p.title, sourceName: p.sourceName })),
  );

  // 랭킹 (인덱스 기준)
  const rankable: Rankable[] = pool.map((p, i) => ({
    id: i,
    topicality: p.topicality,
    genre: genres.get(i) ?? '기타',
    publishedAt: p.publishedAt ?? null,
  }));
  const ranked = rank(rankable, cfg.more_count);
  const shown = [...ranked.mustRead, ...ranked.more];
  console.log(
    `[briefing] 랭킹 — 필독 ${ranked.mustRead.length} / 더보기 ${ranked.more.length}`,
  );
  if (shown.length === 0) {
    console.log('[briefing] 선정 0건 — 브리핑 생성 건너뜀');
    return empty();
  }

  // 요약 (선정된 것만, 인덱스 id)
  const mkInput = (i: number) => ({
    id: i,
    title: pool[i].title,
    url: pool[i].url,
    sourceName: pool[i].sourceName,
    genre: genres.get(i) ?? '기타',
  });
  const [mustSummaries, moreLines] = await Promise.all([
    summarizeMustRead(ranked.mustRead.map(mkInput)),
    summarizeMore(ranked.more.map(mkInput)),
  ]);
  const mustById = new Map(mustSummaries.map((s) => [s.id, s])); // id=인덱스
  const moreById = new Map(moreLines.map((l) => [l.id, l]));

  // 선정된 것만 items 에 저장 + seen 기록. 인덱스 → DB item id 매핑.
  const now = Date.now();
  const insItem = db.prepare(
    `INSERT INTO items
       (source_id, external_id, title, url, author, score, comments,
        published_at, fetched_at, topicality, genre, summary, summary_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insSeen = db.prepare(
    `INSERT OR IGNORE INTO seen (url_hash, first_seen_at) VALUES (?, ?)`,
  );
  const idMap = new Map<number, number>();
  const tx = db.transaction(() => {
    for (const i of shown) {
      const p = pool[i];
      const genre = genres.get(i) ?? '기타';
      let summary: string;
      let type: string;
      if (mustById.has(i)) {
        const s = mustById.get(i)!;
        summary = JSON.stringify({ headline: s.headline, body: s.body });
        type = 'must_read';
      } else {
        summary = moreById.get(i)?.line ?? p.title;
        type = 'more';
      }
      const info = insItem.run(
        p.sourceId,
        p.externalId ?? null,
        p.title,
        p.url,
        p.author ?? null,
        p.score,
        p.comments,
        p.publishedAt ?? null,
        now,
        p.topicality,
        genre,
        summary,
        type,
      );
      insSeen.run(p.urlHash, now);
      idMap.set(i, Number(info.lastInsertRowid));
    }
  });
  tx();

  // 브리핑 저장 + 아이템 링크 (인덱스 → DB id 변환)
  const mustIds = ranked.mustRead.map((i) => idMap.get(i)).filter((x): x is number => !!x);
  const moreIds = ranked.more.map((i) => idMap.get(i)).filter((x): x is number => !!x);
  const info = db
    .prepare(
      `INSERT INTO briefings (created_at, arrival_date, must_read_json, more_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(now, arrivalDate, JSON.stringify(mustIds), JSON.stringify(moreIds));
  const briefingId = Number(info.lastInsertRowid);

  const linkItem = db.prepare('UPDATE items SET briefing_id = ? WHERE id = ?');
  const linkTx = db.transaction(() => {
    for (const id of [...mustIds, ...moreIds]) linkItem.run(briefingId, id);
  });
  linkTx();

  console.log(`[briefing] 완료 — briefing #${briefingId} (${arrivalDate})`);
  return {
    created: true,
    briefingId,
    arrivalDate,
    mustReadCount: mustIds.length,
    moreCount: moreIds.length,
    candidateCount: cands.length,
    dedupedCount: pool.length,
  };
}

/** 브리핑 1건을 화면용 형태(필독/더보기 아이템 포함)로 조립. */
export function getBriefingView(briefingId?: number) {
  const db = getDb();
  const briefing = briefingId
    ? (db.prepare('SELECT * FROM briefings WHERE id = ?').get(briefingId) as
        | { id: number; created_at: number; arrival_date: string; must_read_json: string; more_json: string }
        | undefined)
    : (db.prepare('SELECT * FROM briefings ORDER BY id DESC LIMIT 1').get() as
        | { id: number; created_at: number; arrival_date: string; must_read_json: string; more_json: string }
        | undefined);
  if (!briefing) return null;

  const mustIds: number[] = JSON.parse(briefing.must_read_json);
  const moreIds: number[] = JSON.parse(briefing.more_json);
  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
  const load = (id: number) => getItem.get(id) as ItemRow | undefined;

  const mustRead = mustIds
    .map(load)
    .filter((x): x is ItemRow => !!x)
    .map((it) => {
      let headline = it.title;
      let body = '';
      try {
        const parsed = JSON.parse(it.summary ?? '{}');
        headline = parsed.headline ?? it.title;
        body = parsed.body ?? '';
      } catch {
        body = it.summary ?? '';
      }
      return {
        id: it.id,
        title: it.title,
        url: it.url,
        genre: it.genre,
        score: it.score,
        comments: it.comments,
        headline,
        body,
      };
    });

  const more = moreIds
    .map(load)
    .filter((x): x is ItemRow => !!x)
    .map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url,
      genre: it.genre,
      score: it.score,
      comments: it.comments,
      line: it.summary ?? it.title,
    }));

  return {
    id: briefing.id,
    arrivalDate: briefing.arrival_date,
    createdAt: briefing.created_at,
    mustRead,
    more,
  };
}
