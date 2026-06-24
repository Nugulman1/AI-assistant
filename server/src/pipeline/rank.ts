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

const genreOf = (r: Rankable) => r.genre ?? '기타';

/** 탐색 주입에서 우선 노출할 '변두리' 장르 — 화제도는 낮아도 학습 신호가 큰 영역. */
const EXPLORE_GENRES = new Set(['논문·연구', '제품·창업·회고']);

/**
 * 필독 3 = 화제도 + 다양성 가드.
 * 화제도 내림차순으로 보되, 이미 뽑힌 장르가 또 나오면 페널티를 줘 장르 쏠림을 막는다.
 */
function pickMustRead(pool: Rankable[], n = 3): number[] {
  const remaining = [...pool].sort((a, b) => b.topicality - a.topicality);
  const picked: Rankable[] = [];
  const genreCount = new Map<string, number>();
  const PENALTY = 1.5;

  while (picked.length < n && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const used = genreCount.get(genreOf(r)) ?? 0;
      const eff = r.topicality - used * PENALTY; // 같은 장르 재선택 페널티
      if (eff > bestScore) {
        bestScore = eff;
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
 * 절반은 화제도 상위를 장르 라운드로빈으로(고른 분포), 절반은 저화제 변두리(논문·블로그)를
 * 주입해 학습용 탐색 신호를 만든다.
 */
function pickMore(pool: Rankable[], n: number): number[] {
  if (n <= 0 || pool.length === 0) return [];
  const exploitN = Math.ceil(n / 2);
  const exploreN = n - exploitN;
  const chosen: number[] = [];
  const used = new Set<number>();

  // ── exploitation: 장르별 그룹에서 화제도 상위를 라운드로빈으로 뽑아 장르 분산 ──
  const byGenre = new Map<string, Rankable[]>();
  for (const r of pool) {
    const g = genreOf(r);
    const arr = byGenre.get(g) ?? [];
    arr.push(r);
    byGenre.set(g, arr);
  }
  for (const arr of byGenre.values()) arr.sort((a, b) => b.topicality - a.topicality);
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

  // ── exploration: 남은 것 중 저화제 변두리(논문·창업) 우선, 그다음 화제도 낮은 순 ──
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
  void exploreN;
  return chosen.slice(0, n);
}

export function rank(pool: Rankable[], moreCount: number): Ranked {
  const mustRead = pickMustRead(pool, 3);
  const mustSet = new Set(mustRead);
  const more = pickMore(
    pool.filter((r) => !mustSet.has(r.id)),
    moreCount,
  );
  return { mustRead, more };
}
