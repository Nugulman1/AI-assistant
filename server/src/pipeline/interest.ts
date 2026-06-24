import type Database from 'better-sqlite3';

/**
 * 행동 신호 → 장르별 취향 가중치.
 * 단일 유저라 협업필터링 불가 → content(장르) 기반 집계.
 *
 * - 좋아요 +1.0 / 관심없음 -1.0 (주신호). 장르별 합산.
 * - 원문열기(read_events)는 보조신호(약): READ_WEIGHT 비중으로 더함(양수만, 음의 신호 없음).
 * - raw 합을 tanh 로 포화시켜 [-1,+1] 로 정규화 → topicality(z-점수, σ≈1) 와 같은 스케일대.
 *   이 정규화가 없으면 좋아요 1~2개에 랭킹이 한 장르로 붕괴한다.
 * - totalSignal N = feedback 행 수만 셈(read 제외). read 는 항상 쌓이므로 N 에 넣으면
 *   콜드스타트(alpha 게이팅)가 영영 안 끝난다.
 */

/** 좋아요 1.0 대비 원문열기(보조신호)의 비중. read_events 는 자동기록이라 노이즈가 커서 작게. */
export const READ_WEIGHT = 0.25;

/** tanh 포화 상수. raw≈K 에서 weight≈0.76. "몇 개 신호에서 최대효과를 낼지" 노브. */
const SATURATION_K = 3;

export interface GenreWeights {
  /** genre -> 정규화 가중치 [-1, +1]. 신호 없는 장르는 키 없음(합성 시 0 취급). */
  weights: Map<string, number>;
  /** N = 명시 신호(좋아요+관심없음) 행 수. alpha 게이팅용. */
  totalSignal: number;
}

export function computeGenreWeights(db: Database.Database): GenreWeights {
  const raw = new Map<string, number>();
  const add = (genre: string | null, delta: number) => {
    const g = genre ?? '기타';
    raw.set(g, (raw.get(g) ?? 0) + delta);
  };

  // 명시 신호: 좋아요/관심없음
  const fb = db
    .prepare(
      `SELECT COALESCE(genre,'기타') AS genre, kind, COUNT(*) AS n
         FROM feedback GROUP BY genre, kind`,
    )
    .all() as { genre: string; kind: 'like' | 'dislike'; n: number }[];
  let totalSignal = 0;
  for (const r of fb) {
    add(r.genre, (r.kind === 'like' ? 1.0 : -1.0) * r.n);
    totalSignal += r.n;
  }

  // 보조 신호: 원문열기(약, 양수만)
  const reads = db
    .prepare(
      `SELECT COALESCE(genre,'기타') AS genre, COUNT(*) AS n
         FROM read_events GROUP BY genre`,
    )
    .all() as { genre: string; n: number }[];
  for (const r of reads) add(r.genre, READ_WEIGHT * r.n);

  // tanh 포화 정규화
  const weights = new Map<string, number>();
  for (const [g, v] of raw) weights.set(g, Math.tanh(v / SATURATION_K));

  return { weights, totalSignal };
}
