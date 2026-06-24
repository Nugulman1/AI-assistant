import { describe, it, expect } from 'vitest';
import { rank, type Rankable } from '../rank.js';

/** 테스트용 풀 생성. topicality 는 명시, 나머지는 기본. */
function item(id: number, topicality: number, genre: string): Rankable {
  return { id, topicality, genre, publishedAt: null };
}

/**
 * 장르가 골고루 섞인 풀. '보안'은 일부러 저화제로 깔아 콜드스타트에선 필독에 못 드는 위치.
 */
function makePool(): Rankable[] {
  return [
    item(0, 3.0, 'AI/LLM·에이전트'),
    item(1, 2.5, 'AI/LLM·에이전트'),
    item(2, 2.0, '웹·프론트'),
    item(3, 1.8, '시스템·인프라·저수준'),
    item(4, 1.0, '언어·런타임·도구'),
    item(5, 1.7, '보안'), // 시스템(1.8) 바로 아래 — 콜드스타트선 탈락, 학습으로 역전 검증
    item(6, 0.0, '보안'),
    item(7, -0.5, '논문·연구'),
    item(8, -1.0, '논문·연구'),
    item(9, -1.2, '제품·창업·회고'),
  ];
}

describe('rank — 콜드스타트 회귀가드', () => {
  it('opts 없음 == 빈 가중치+N=0: 결과 배열이 완전히 동일하다', () => {
    const pool = makePool();
    const baseline = rank(pool, 7);
    const explicitCold = rank(pool, 7, { genreWeights: new Map(), totalSignal: 0 });
    expect(explicitCold.mustRead).toEqual(baseline.mustRead);
    expect(explicitCold.more).toEqual(baseline.more);
  });

  it('가중치가 있어도 N=0 이면 화제도 정렬과 동일(alpha 게이팅)', () => {
    const pool = makePool();
    const baseline = rank(pool, 7);
    const weighted = rank(pool, 7, {
      genreWeights: new Map([['보안', 1]]),
      totalSignal: 0,
    });
    expect(weighted.mustRead).toEqual(baseline.mustRead);
  });
});

describe('rank — 좋아요 학습', () => {
  it('좋아요 누적 장르가 인기 경쟁에서 역전해 필독으로 올라온다', () => {
    const pool = makePool();
    const cold = rank(pool, 7);
    expect(cold.mustRead).not.toContain(5); // 보안(1.7)은 시스템(1.8)에 밀려 필독 밖

    const learned = rank(pool, 7, {
      genreWeights: new Map([['보안', 1]]), // tanh 포화 최대
      totalSignal: 50, // alpha ≈ 1.25 → 보안 1.7 + 1.25 = 2.95 로 역전
    });
    expect(learned.mustRead).toContain(5);
  });
});

describe('rank — 관심없음 + 탐색 생존 (WL-3 회귀가드)', () => {
  it('dislike 장르는 필독에서 빠지되, 더보기 explore 슬롯엔 여전히 등장한다', () => {
    const pool = makePool();
    const learned = rank(pool, 7, {
      genreWeights: new Map([['논문·연구', -1]]),
      totalSignal: 50,
    });
    // 논문·연구(7,8)는 음의 가중치로 필독엔 없음
    expect(learned.mustRead).not.toContain(7);
    expect(learned.mustRead).not.toContain(8);
    // 그러나 explore 경로는 topicality 원본 기준 → 변두리 장르라 더보기에 살아있음
    const more = new Set(learned.more);
    expect(more.has(7) || more.has(8)).toBe(true);
  });
});

describe('rank — 다양성 가드 유지', () => {
  it('한 장르에 강한 가중치를 줘도 필독 3건이 단일 장르로 붕괴하지 않는다', () => {
    const pool = makePool();
    const learned = rank(pool, 7, {
      genreWeights: new Map([['AI/LLM·에이전트', 1]]),
      totalSignal: 100,
    });
    const genres = learned.mustRead.map((id) => pool.find((p) => p.id === id)!.genre);
    const aiCount = genres.filter((g) => g === 'AI/LLM·에이전트').length;
    expect(aiCount).toBeLessThanOrEqual(2); // 3슬롯 독식 불가
  });
});
