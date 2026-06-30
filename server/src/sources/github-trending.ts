/**
 * GitHub 트렌딩 어댑터 — 48h 메인 브리핑(items/seen/feedback 파이프라인)과 별개로
 * github.com/trending 의 기간별(일/주/월) 급상승 리포지토리를 본다(HN 베스트와 동형 격리 경로).
 * 트렌딩 페이지는 JSON API가 없어 HTML 을 직접 파싱한다(jsdom, fulltext.ts 와 같은 파서 전용 사용).
 */
import { JSDOM } from 'jsdom';

export type TrendingPeriod = 'daily' | 'weekly' | 'monthly';

export interface TrendingRepo {
  name: string; // 'owner/repo'
  url: string; // 'https://github.com/owner/repo'
  description: string; // 없으면 ''
  language: string | null; // 없으면 null
  stars: number; // "16,526" → 16526
  periodStars: number; // "1,611 stars today" → 1611
}

/** "16,526" / "1,611 stars today" 같은 텍스트에서 첫 정수를 뽑는다(콤마 제거). 숫자 없으면 0. */
function parseNum(text: string | null | undefined): number {
  if (!text) return 0;
  const m = text.replace(/,/g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * 트렌딩 페이지 HTML 을 TrendingRepo[] 로 파싱. 깨진/빈 HTML(article 없음)이면 [].
 * 각 `article.Box-row` 단위로:
 *   - h2 a[href="/owner/repo"] → name(=href에서 선행 / 제거), url
 *   - p.col-9 → description(trim, 없으면 '')
 *   - span[itemprop="programmingLanguage"] → language(없으면 null)
 *   - a[href$="/stargazers"] 텍스트 → stars
 *   - span.float-sm-right 텍스트("N stars today/this week/this month") → periodStars
 */
export function parseGithubTrending(html: string): TrendingRepo[] {
  if (!html) return [];
  // JSDOM 은 스크립트·외부리소스를 실행/로드하지 않는다(파싱 전용).
  const doc = new JSDOM(html).window.document;
  const articles = Array.from(doc.querySelectorAll('article.Box-row'));

  const repos: TrendingRepo[] = [];
  for (const article of articles) {
    const link = article.querySelector('h2 a');
    const href = link?.getAttribute('href') ?? '';
    if (!href) continue; // 리포 링크 없는 article 은 트렌딩 항목이 아님 — 건너뜀
    const name = href.replace(/^\//, '');

    const descEl = article.querySelector('p.col-9');
    const description = descEl?.textContent?.trim() ?? '';

    const langEl = article.querySelector('span[itemprop="programmingLanguage"]');
    const language = langEl?.textContent?.trim() || null;

    const starsEl = article.querySelector('a[href$="/stargazers"]');
    const stars = parseNum(starsEl?.textContent);

    const periodEl = article.querySelector('span.float-sm-right');
    const periodStars = parseNum(periodEl?.textContent);

    repos.push({
      name,
      url: `https://github.com${href}`,
      description,
      language,
      stars,
      periodStars,
    });
  }
  return repos;
}

/**
 * 한 기간의 트렌딩을 실제로 수집(네트워크). 실패(타임아웃·비200·파싱불가)는 빈 배열로 격리 —
 * 호출부(collectAndStoreTrending)와 메인 브리핑에 영향 주지 않게(hn-best 의 fetch 격리와 동형).
 */
export async function fetchTrending(period: TrendingPeriod): Promise<TrendingRepo[]> {
  try {
    const res = await fetch(`https://github.com/trending?since=${period}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; briefing-bot)' },
    });
    if (!res.ok) throw new Error(`GitHub trending(${period}) HTTP ${res.status}`);
    const html = await res.text();
    return parseGithubTrending(html);
  } catch (err) {
    console.warn(`[github-trending] ${period} 수집 실패(빈 결과):`, (err as Error).message);
    return [];
  }
}
