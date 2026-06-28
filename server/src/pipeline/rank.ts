export interface Rankable {
  id: number;
  topicality: number;
  genre: string | null;
  publishedAt: number | null;
}

export interface Ranked {
  mustRead: number[]; // item id, 최대 3
  more: number[]; // item id, 최대 moreCount
}

export interface RankOptions {
  /** genre -> 정규화 가중치 [-1,+1] (computeGenreWeights 출력). 없으면 콜드스타트. */
  genreWeights?: Map<string, number>;
  /** N = 명시 신호 행 수. alpha 게이팅용. */
  totalSignal?: number;
}

const genreOf = (r: Rankable) => r.genre ?? '기타';

/** 탐색 주입에서 우선 노출할 '변두리' 장르 — 화제도는 낮아도 학습 신호가 큰 영역. */
const EXPLORE_GENRES = new Set(['논문·연구', '제품·창업·회고']);

/** 취향 가중치가 화제도를 점진적으로 밀어주는 세기. ALPHA_MAX=PENALTY 로 맞춰 다양성가드와 균형. */
const ALPHA_MAX = 1.5;
/** N=N_HALF 에서 alpha 가 절반. 좋아요/관심없음이 쌓일수록 인기→취향으로 무게이동. */
const N_HALF = 10;

/**
 * 취향 합성 점수 함수를 만든다.
 * effective = topicality + alpha(N) * weight(genre).
 * N=0 → alpha=0 → effective = topicality (콜드스타트는 기존 동작과 완전 동일).
 * weight∈[-1,1], alpha≤1.5 → 가중항∈[-1.5,1.5]: topicality(σ≈1)와 비등하게 경쟁(덮지 않음).
 */
export function makeEffective(opts: RankOptions): (r: Rankable) => number {
  const weights = opts.genreWeights;
  const n = opts.totalSignal ?? 0;
  const alpha = weights && n > 0 ? (ALPHA_MAX * n) / (n + N_HALF) : 0;
  if (alpha === 0 || !weights) return (r) => r.topicality;
  return (r) => r.topicality + alpha * (weights.get(genreOf(r)) ?? 0);
}

/**
 * 필독 3 = 취향 합성 점수 + 다양성 가드.
 * effective 내림차순으로 보되, 이미 뽑힌 장르가 또 나오면 페널티를 줘 장르 쏠림을 막는다.
 */
function pickMustRead(pool: Rankable[], n: number, eff: (r: Rankable) => number): number[] {
  const remaining = [...pool].sort((a, b) => eff(b) - eff(a));
  const picked: Rankable[] = [];
  const genreCount = new Map<string, number>();
  const PENALTY = 1.5;

  while (picked.length < n && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const used = genreCount.get(genreOf(r)) ?? 0;
      const e = eff(r) - used * PENALTY; // 같은 장르 재선택 페널티
      if (e > bestScore) {
        bestScore = e;
        bestIdx = i;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    picked.push(chosen);
    genreCount.set(genreOf(chosen), (genreCount.get(genreOf(chosen)) ?? 0) + 1);
  }
  return picked.map((r) => r.id);
}

/**
 * 더보기 = 전 장르 고루 샘플 + 탐색 주입.
 * - exploit 절반: 취향 합성 점수 상위를 장르 라운드로빈으로(고른 분포).
 * - explore 절반: 저화제 변두리(논문·블로그)를 **topicality 원본 기준**으로 주입.
 *   여기엔 취향 가중치를 섞지 않는다 — 안 그러면 '관심없음' 장르가 탐색에서도 영영 배제돼
 *   신호를 못 받고 영구 폐기되는 피드백 루프 붕괴가 난다. dislike 는 노출을 줄일 뿐 0으로 안 죽임.
 */
function pickMore(pool: Rankable[], n: number, eff: (r: Rankable) => number): number[] {
  if (n <= 0 || pool.length === 0) return [];
  const exploitN = Math.ceil(n / 2);
  const chosen: number[] = [];
  const used = new Set<number>();

  // ── exploitation: 장르별 그룹에서 취향 합성 점수 상위를 라운드로빈으로 뽑아 장르 분산 ──
  const byGenre = new Map<string, Rankable[]>();
  for (const r of pool) {
    const g = genreOf(r);
    const arr = byGenre.get(g) ?? [];
    arr.push(r);
    byGenre.set(g, arr);
  }
  for (const arr of byGenre.values()) arr.sort((a, b) => eff(b) - eff(a));
  const genreQueues = [...byGenre.values()];
  let gi = 0;
  while (chosen.length < exploitN && genreQueues.some((q) => q.length > 0)) {
    const q = genreQueues[gi % genreQueues.length];
    gi++;
    const next = q.shift();
    if (next && !used.has(next.id)) {
      used.add(next.id);
      chosen.push(next.id);
    }
  }

  // ── exploration: 취향 무관(topicality 원본). 저화제 변두리(논문·창업) 우선, 그다음 화제도 낮은 순 ──
  const rest = pool
    .filter((r) => !used.has(r.id))
    .sort((a, b) => {
      const ea = EXPLORE_GENRES.has(genreOf(a)) ? 1 : 0;
      const eb = EXPLORE_GENRES.has(genreOf(b)) ? 1 : 0;
      if (ea !== eb) return eb - ea; // 변두리 장르 먼저
      return a.topicality - b.topicality; // 저화제 먼저(탐색)
    });
  for (const r of rest) {
    if (chosen.length >= n) break;
    used.add(r.id);
    chosen.push(r.id);
  }

  // exploration 분이 모자라면(rest 가 적으면) 남은 화제도 순으로 채움
  if (chosen.length < n) {
    for (const r of pool) {
      if (chosen.length >= n) break;
      if (!used.has(r.id)) {
        used.add(r.id);
        chosen.push(r.id);
      }
    }
  }
  return chosen.slice(0, n);
}

export function rank(pool: Rankable[], moreCount: number, opts: RankOptions = {}): Ranked {
  const eff = makeEffective(opts);
  const mustRead = pickMustRead(pool, 3, eff);
  const mustSet = new Set(mustRead);
  const more = pickMore(
    pool.filter((r) => !mustSet.has(r.id)),
    moreCount,
    eff,
  );
  return { mustRead, more };
}
