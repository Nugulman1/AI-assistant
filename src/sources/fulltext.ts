import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { extractText } from './text.js';

/**
 * 외부 기사 원문 url 에서 본문 텍스트를 추출. 실패(타임아웃·403·페이월·비HTML·파싱불가)면 undefined.
 * CLI dig 가 고른 글 한 건의 원문을 가져올 때 쓴다. maxLen 은 extractText 절단 상한.
 */
export async function fetchArticleText(url: string, maxLen?: number): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' },
    });
    if (!res.ok) return undefined;
    if (!(res.headers.get('content-type') ?? '').includes('html')) return undefined; // PDF·이미지 스킵
    const html = await res.text();
    // JSDOM 은 기본적으로 스크립트·외부리소스를 실행/로드하지 않는다(파싱 전용).
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    return extractText(article?.textContent, maxLen);
  } catch {
    return undefined;
  }
}
