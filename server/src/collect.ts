/** 수집 작업의 동시 실행 방지 — 버튼 연타·cron 과 버튼의 충돌을 막는다. */

export type CollectKey = 'briefing' | 'best' | 'github';

const inFlight = new Set<CollectKey>();

export const isCollecting = (key: CollectKey): boolean => inFlight.has(key);

/** 같은 key 가 이미 실행 중이면 null 반환(호출측에서 409), 아니면 실행 후 결과. */
export async function runExclusive<T>(
  key: CollectKey,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}
