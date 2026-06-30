import { describe, it, expect } from 'vitest';
// 추론한 인터페이스 — 아직 미구현 모듈. import 실패로 RED 나는 게 정상.
// parseGithubTrending(html: string): TrendingRepo[]
import { parseGithubTrending, type TrendingRepo } from '../github-trending.js';

/**
 * 픽스처 출처: `curl -sL 'https://github.com/trending?since=daily'` (2026-06-30, HTTP 200) 실제 응답에서
 * <article class="Box-row"> 블록 2개(simplex-chat, agency-agents)를 잘라온 것. svg 내용만 비우고
 * 의미 없는 "Built by" 아바타 목록은 트림했으나 태그/클래스/중첩은 라이브 DOM 그대로 보존.
 * 세 번째 article(C)는 같은 라이브 골격에서 language span 과 description <p>를 제거한 변형 —
 * GitHub 트렌딩이 언어/설명 없는 리포를 렌더할 때의 실제 DOM 형태(해당 요소가 통째로 부재).
 *
 * 기대값은 아래 HTML을 사람이 직접 읽어 독립 산출(코드 출력 베끼기 아님 — 구현이 아직 없음):
 *   A simplex-chat/simplex-chat  Haskell  stars 16,526  "1,611 stars today"
 *   B msitarzewski/agency-agents Shell    stars 118,815 "1,221 stars today"
 *   C someorg/no-meta-repo       (언어 없음) (설명 없음) stars 42 "7 stars today"
 */
const FIXTURE = `
<article class="Box-row">
  <div class="float-right d-flex"></div>
  <h2 class="h3 lh-condensed">
    <a href="/simplex-chat/simplex-chat" data-view-component="true" class="Link"><svg></svg>
      <span data-view-component="true" class="text-normal">
        simplex-chat /
</span>
      simplex-chat</a>  </h2>
    <p class="col-9 color-fg-muted my-1 tmp-pr-4">
      SimpleX - the first messaging network operating without user identifiers of any kind - 100% private by design! iOS, Android and desktop apps 📱!
    </p>
  <div class="f6 color-fg-muted mt-2">
      <span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0">
  <span class="repo-language-color" style="background-color: #5e5086"></span>
  <span itemprop="programmingLanguage">Haskell</span>
</span>
      <a href="/simplex-chat/simplex-chat/stargazers" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg></svg>
        16,526</a>
      <a href="/simplex-chat/simplex-chat/forks" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg></svg>
        955</a>
      <span data-view-component="true" class="d-inline-block float-sm-right">
        <svg></svg>
        1,611 stars today
</span>  </div>
</article>
<article class="Box-row">
  <div class="float-right d-flex"></div>
  <h2 class="h3 lh-condensed">
    <a href="/msitarzewski/agency-agents" data-view-component="true" class="Link"><svg></svg>
      <span data-view-component="true" class="text-normal">
        msitarzewski /
</span>
      agency-agents</a>  </h2>
    <p class="col-9 color-fg-muted my-1 tmp-pr-4">
      A complete AI agency at your fingertips - From frontend wizards to Reddit community ninjas, from whimsy injectors to reality checkers. Each agent is a specialized expert with personality, processes, and proven deliverables.
    </p>
  <div class="f6 color-fg-muted mt-2">
      <span class="tmp-mr-3 d-inline-block ml-0 tmp-ml-0">
  <span class="repo-language-color" style="background-color: #89e051"></span>
  <span itemprop="programmingLanguage">Shell</span>
</span>
      <a href="/msitarzewski/agency-agents/stargazers" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg></svg>
        118,815</a>
      <a href="/msitarzewski/agency-agents/forks" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg></svg>
        19,462</a>
      <span data-view-component="true" class="d-inline-block float-sm-right">
        <svg></svg>
        1,221 stars today
</span>  </div>
</article>
<article class="Box-row">
  <div class="float-right d-flex"></div>
  <h2 class="h3 lh-condensed">
    <a href="/someorg/no-meta-repo" data-view-component="true" class="Link"><svg></svg>
      <span data-view-component="true" class="text-normal">
        someorg /
</span>
      no-meta-repo</a>  </h2>
  <div class="f6 color-fg-muted mt-2">
      <a href="/someorg/no-meta-repo/stargazers" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg></svg>
        42</a>
      <a href="/someorg/no-meta-repo/forks" data-view-component="true" class="tmp-mr-3 Link Link--muted d-inline-block"><svg></svg>
        3</a>
      <span data-view-component="true" class="d-inline-block float-sm-right">
        <svg></svg>
        7 stars today
</span>  </div>
</article>
`;

describe('parseGithubTrending — 실제 trending DOM 파싱', () => {
  it('article 3개를 순서대로 TrendingRepo 로 매핑한다', () => {
    // 기대값 출처: 위 FIXTURE HTML을 직접 읽어 산출. 콤마 제거 후 number.
    const expected: TrendingRepo[] = [
      {
        name: 'simplex-chat/simplex-chat',
        url: 'https://github.com/simplex-chat/simplex-chat',
        description:
          'SimpleX - the first messaging network operating without user identifiers of any kind - 100% private by design! iOS, Android and desktop apps 📱!',
        language: 'Haskell',
        stars: 16526, // "16,526"
        periodStars: 1611, // "1,611 stars today"
      },
      {
        name: 'msitarzewski/agency-agents',
        url: 'https://github.com/msitarzewski/agency-agents',
        description:
          'A complete AI agency at your fingertips - From frontend wizards to Reddit community ninjas, from whimsy injectors to reality checkers. Each agent is a specialized expert with personality, processes, and proven deliverables.',
        language: 'Shell',
        stars: 118815, // "118,815"
        periodStars: 1221, // "1,221 stars today"
      },
      {
        name: 'someorg/no-meta-repo',
        url: 'https://github.com/someorg/no-meta-repo',
        description: '', // <p> 부재 → ''
        language: null, // programmingLanguage span 부재 → null
        stars: 42,
        periodStars: 7, // "7 stars today"
      },
    ];
    expect(parseGithubTrending(FIXTURE)).toEqual(expected);
  });

  it('콤마가 박힌 stars/periodStars 를 number 로 변환한다("16,526"→16526)', () => {
    const repos = parseGithubTrending(FIXTURE);
    expect(repos[0].stars).toBe(16526);
    expect(repos[1].stars).toBe(118815);
    expect(repos[0].periodStars).toBe(1611);
  });

  it('언어 없는 리포는 language=null, 설명 없는 리포는 description=""', () => {
    const repos = parseGithubTrending(FIXTURE);
    expect(repos[2].language).toBeNull();
    expect(repos[2].description).toBe('');
  });

  it('빈 문자열 → 빈 배열', () => {
    expect(parseGithubTrending('')).toEqual([]);
  });

  it('article 없는 깨진 HTML → 빈 배열', () => {
    expect(parseGithubTrending('<html><body><div>nothing here</div></body></html>')).toEqual([]);
  });
});
