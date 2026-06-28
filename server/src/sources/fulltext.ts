import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { extractText } from './text.js';

/**
 * 외부 기사 원문 url 에서 본문 텍스트를 추출. 실패(타임아웃·403·페이월·비HTML·파싱불가)면 undefined.
 * 피드에 본문이 없는 경우(HN 외부링크 등)에만, 선정된 소수 건에 한해 쓴다.
 */
export async function fetchArticleText(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; briefing-bot)' },
    });
    if (!res.ok) return undefined;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return undefined; // PDF·이미지 스킵
    const html = await res.text();
    // JSDOM 은 기본적으로 스크립트·외부리소스를 실행/로드하지 않는다(파싱 전용).
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    return extractText(article?.textContent);
  } catch {
    return undefined;
  }
}
