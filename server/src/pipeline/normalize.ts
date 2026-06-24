import type { WorkItem } from './dedup.js';

/**
 * 소스별 화제도 정규화(z-점수). HN 점수(수백)와 Reddit 점수(수천)를 직접 비교 못 하므로
 * 각 소스 분포 안에서의 상대 위치로 환산한다. 점수 신호 없는 RSS 는 z=0.
 * 교차소스 중복은 강신호 → dupCount 보너스를 더한다.
 */
export function normalizeTopicality(items: WorkItem[]): WorkItem[] {
  // 소스별 그룹
  const groups = new Map<number, WorkItem[]>();
  for (const it of items) {
    const arr = groups.get(it.sourceId) ?? [];
    arr.push(it);
    groups.set(it.sourceId, arr);
  }

  for (const group of groups.values()) {
    const scores = group.map((g) => g.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
    const std = Math.sqrt(variance);
    for (const g of group) {
      g.topicality = std > 0 ? (g.score - mean) / std : 0;
    }
  }

  // 교차소스 중복 보너스: 추가 소스 1개당 +1.0 (여러 곳에서 동시 화제 = 진짜 화제)
  for (const it of items) {
    it.topicality += (it.dupCount - 1) * 1.0;
  }

  return items;
}
