/** 모든 소스가 공유하는 fetch 설정. index.ts 와 분리해 소스 파일과의 순환 import 를 막는다. */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
export const FETCH_TIMEOUT_MS = 15_000;
/** 수집 창: 최근 48시간. */
export const WINDOW_MS = 48 * 60 * 60 * 1000;

/** JSON GET. 네트워크 오류·5xx 는 1초 뒤 한 번 더 시도한다(일시 실패로 소스가 통째로 빠지는 일이 실제로 있었다). */
export async function fetchJson<T = unknown>(url: string, retries = 1): Promise<T> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });
    if (res.status >= 500) throw new Error(`HTTP ${res.status} ${url}`);
    if (!res.ok) return Promise.reject(new Error(`HTTP ${res.status} ${url}`));
    return (await res.json()) as T;
  } catch (e) {
    if (retries <= 0 || (e instanceof Error && /^HTTP 4/.test(e.message))) throw e;
    await new Promise((r) => setTimeout(r, 1000));
    return fetchJson<T>(url, retries - 1);
  }
}
