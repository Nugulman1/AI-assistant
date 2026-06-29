import { describe, it, expect } from 'vitest';
// 추론한 인터페이스 — 아직 미구현 모듈. import 실패로 RED 나는 게 정상.
import {
  buildBestSearchUrl,
  parseBestStories,
  type AlgoliaHit,
  type BestStory,
} from '../hn-best.js';

describe('buildBestSearchUrl — HN Algolia search URL 생성', () => {
  // 기대값 출처: 사용자 표 (nowSec=1700000000), cutoff = nowSec - days*86400
  // '>' 는 raw, hitsPerPage 항상 50, tags 항상 story
  const NOW = 1700000000;

  it.each([
    // [period, 기대 URL]  — 사용자 표 각 행 그대로
    [
      'week' as const,
      'https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>1699395200&hitsPerPage=50',
    ],
    [
      'month' as const,
      'https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>1697408000&hitsPerPage=50',
    ],
    [
      'year' as const,
      'https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>1668464000&hitsPerPage=50',
    ],
  ])('period=%s → 표의 cutoff가 박힌 URL을 반환한다', (period, expected) => {
    expect(buildBestSearchUrl(period, NOW)).toBe(expected);
  });
});

describe('parseBestStories — title null 제외 + points 내림차순 + limit', () => {
  // 입력 hits: 사용자 표 그대로
  const hits: AlgoliaHit[] = [
    { objectID: '10', title: ' A title ', url: 'https://a.com', author: 'alice', points: 120, num_comments: 30, created_at_i: 1699000000 },
    { objectID: '20', title: 'B', url: null, author: 'bob', points: 450, num_comments: 5, created_at_i: 1698000000 },
    { objectID: '30', title: 'C', url: 'https://c.com', author: null, points: null, num_comments: 0, created_at_i: 1697000000 },
    { objectID: '40', title: null, url: 'https://d.com', author: 'dan', points: 999, num_comments: 1, created_at_i: 1696000000 },
  ];

  it('limit=2 → title null(40) 제외, points 내림차순 상위 2개를 정확히 매핑한다', () => {
    // 기대값 출처: 사용자 표 limit=2 결과 (B 450 1위, A 120 2위; 30은 0이라 탈락)
    const expected: BestStory[] = [
      { externalId: '20', title: 'B', url: 'https://news.ycombinator.com/item?id=20', externalUrl: undefined, author: 'bob', points: 450, comments: 5, createdAt: 1698000000000 },
      { externalId: '10', title: 'A title', url: 'https://news.ycombinator.com/item?id=10', externalUrl: 'https://a.com', author: 'alice', points: 120, comments: 30, createdAt: 1699000000000 },
    ];
    expect(parseBestStories({ hits }, 2)).toEqual(expected);
  });

  it('limit=10 → 40만 제외해 길이 3, 마지막은 points 0인 externalId=30', () => {
    // 기대값 출처: 사용자 추가 단언 (40 title null 제외, 30 points null→0 최하위)
    const result = parseBestStories({ hits }, 10);
    expect(result).toHaveLength(3);
    expect(result[result.length - 1].externalId).toBe('30');
    expect(result[result.length - 1].points).toBe(0);
  });
});
