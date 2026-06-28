import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Candidate } from '../sources/index.js';

export interface WorkItem extends Candidate {
  urlHash: string;
  dupCount: number; // 교차소스 중복 수 (1=유일). 중복=화제도 강신호.
  topicality: number;
}

/** URL 정규화: 스킴 소문자, 트래킹 쿼리·해시·끝슬래시 제거 → 같은 글을 같은 키로. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    const drop = [...u.searchParams.keys()].filter((k) =>
      /^(utm_|ref|ref_src|fbclid|gclid|mc_|igshid)/i.test(k),
    );
    for (const k of drop) u.searchParams.delete(k);
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`.replace(/\/$/, '');
    const qs = u.searchParams.toString();
    if (qs) s += `?${qs}`;
    return s;
  } catch {
    return raw.trim();
  }
}

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

/** 제목 정규화 키(중복 병합 보조): 소문자·영숫자만. */
const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '').slice(0, 80);

const DAY = 24 * 60 * 60 * 1000;

/**
 * [코드] 이미 본 것 제거 + 교차소스 중복 병합 + 오래된 것 컷.
 * - seen 테이블에 있는 url 은 제외(과거 브리핑에서 이미 다룸)
 * - 같은 정규화 URL 또는 같은 제목키 = 동일 글로 병합, dupCount 증가(점수 높은 쪽 대표로)
 * - publishedAt 이 maxAgeDays 보다 오래면 컷 (없으면 통과)
 */
export function dedupAndMerge(
  cands: Candidate[],
  db: Database.Database,
  maxAgeDays = 2, // 48h 단일 수집창 (평가 지연 흡수). 24h 명시 컷은 두지 않음 — 신선도=랭킹이 보장.
): WorkItem[] {
  const seenStmt = db.prepare('SELECT 1 FROM seen WHERE url_hash = ?');
  const now = Date.now();
  const cutoff = now - maxAgeDays * DAY;

  const byKey = new Map<string, WorkItem>();
  for (const c of cands) {
    if (!c.url) continue;
    // 발행시각 없거나(undefined) NaN 이면 제외 — '어제 하루치' 개념에 맞춰 시각 불명 글은 컷.
    const ts = c.publishedAt;
    if (ts == null || Number.isNaN(ts) || ts < cutoff) continue;

    const urlNorm = normalizeUrl(c.url);
    const urlHash = hash(urlNorm);
    if (seenStmt.get(urlHash)) continue; // 과거에 본 글

    // 병합 키: URL 우선, 제목키로 보조 매칭
    const key = `u:${urlHash}`;
    const tkey = `t:${titleKey(c.title)}`;
    const existing = byKey.get(key) ?? byKey.get(tkey);

    if (existing) {
      existing.dupCount += 1;
      // 본문은 점수와 무관하게 있는 쪽을 보존(대표가 본문 없는 후보여도 요약이 본문 기반을 타게).
      if (!existing.body && c.body) existing.body = c.body;
      // 더 화제된 쪽(점수+댓글)을 대표로 승격
      if (c.score + c.comments > existing.score + existing.comments) {
        existing.title = c.title;
        existing.url = c.url;
        existing.score = c.score;
        existing.comments = c.comments;
        existing.sourceId = c.sourceId;
        existing.sourceName = c.sourceName;
      }
      continue;
    }

    const wi: WorkItem = { ...c, urlHash, dupCount: 1, topicality: 0 };
    byKey.set(key, wi);
    byKey.set(tkey, wi); // 같은 객체를 두 키로 가리킴 (제목 매칭용)
  }

  // 같은 객체가 두 키로 들어가 있으므로 중복 제거
  return [...new Set(byKey.values())];
}
