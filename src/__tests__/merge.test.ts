import { describe, expect, it } from 'vitest';
import { applyToExisting } from '../collect.js';
import { itemId, mergeCandidates, normalizeUrl, titleKey } from '../merge.js';
import type { Item } from '../items.js';
import type { Candidate } from '../sources/index.js';

const T0 = Date.parse('2026-09-09T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const cand = (over: Partial<Candidate>): Candidate => ({
  sourceName: 'X',
  title: 'Title',
  url: 'https://example.com/a',
  publishedAt: T0,
  ...over,
});

describe('normalizeUrl', () => {
  it('트래킹 쿼리·해시·끝 슬래시·호스트 대소문자를 정리한다', () => {
    expect(normalizeUrl('https://Example.com/post/?utm_source=x&utm_medium=y&ref=hn&fbclid=1&mc_cid=2#top'))
      .toBe('https://example.com/post');
    expect(normalizeUrl('https://example.com/post?id=3&gclid=z')).toBe('https://example.com/post?id=3');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });
  it('파싱 실패면 trim 만 한다', () => {
    expect(normalizeUrl('  not a url  ')).toBe('not a url');
  });
  it('id 는 정규화 URL 의 sha1 앞 12자', () => {
    expect(itemId('https://example.com/a?utm_source=x')).toBe(itemId('https://example.com/a/'));
    expect(itemId('https://example.com/a')).toHaveLength(12);
  });
});

describe('mergeCandidates', () => {
  it('HN 외부링크 + Lobsters 같은 글 → sources 2개, url 외부 원문, hn 유지', () => {
    const hn = { id: '1', points: 400, comments: 50 };
    const items = mergeCandidates([
      cand({ sourceName: 'Hacker News', url: 'https://blog.example.com/p?utm_source=hn', hn }),
      cand({ sourceName: 'Lobsters', url: 'https://blog.example.com/p/', score: 20 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].sources).toEqual(['Hacker News', 'Lobsters']);
    expect(items[0].url).toBe('https://blog.example.com/p?utm_source=hn');
    expect(items[0].hn).toEqual(hn);
    expect(items[0].score).toBe(20);
  });

  it('HN 토론 링크는 외부 원문에 밀리고, id 는 최종 url 기준', () => {
    const items = mergeCandidates([
      cand({ sourceName: 'Hacker News', title: 'Same Post!', url: 'https://news.ycombinator.com/item?id=9', hn: { id: '9', points: 300, comments: 1 } }),
      cand({ sourceName: 'Lobsters', title: 'same post', url: 'https://ext.example.com/x' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://ext.example.com/x');
    expect(items[0].id).toBe(itemId('https://ext.example.com/x'));
    expect(items[0].hn?.id).toBe('9');
  });

  it('URL 이 달라도 titleKey 가 같으면 한 건, publishedAt 은 가장 이른 것', () => {
    const items = mergeCandidates([
      cand({ sourceName: 'A', title: 'Hello, World: 한글 테스트', url: 'https://a.example.com/1', publishedAt: T0 + 1000 }),
      cand({ sourceName: 'B', title: 'hello world 한글-테스트', url: 'https://b.example.com/2', publishedAt: T0 }),
      cand({ sourceName: 'A', title: 'Other', url: 'https://a.example.com/3' }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].sources).toEqual(['A', 'B']);
    expect(items[0].publishedAt).toBe(new Date(T0).toISOString());
    expect(titleKey('Hello, World: 한글 테스트')).toBe('helloworld한글테스트');
  });

  it('같은 소스가 두 번 와도 sources 는 중복 없이', () => {
    const items = mergeCandidates([cand({ sourceName: 'A' }), cand({ sourceName: 'A' })]);
    expect(items[0].sources).toEqual(['A']);
  });
});

describe('applyToExisting', () => {
  const existing: Item[] = [
    {
      id: itemId('https://old.example.com/keep'), title: 'Keep', url: 'https://old.example.com/keep',
      sources: ['Hacker News'], hn: { id: '1', points: 300, comments: 5 },
      publishedAt: new Date(T0 - 3 * DAY).toISOString(), firstSeenAt: new Date(T0 - 3 * DAY).toISOString(),
    },
    {
      id: itemId('https://old.example.com/expired'), title: 'Expired', url: 'https://old.example.com/expired',
      sources: ['LWN'], publishedAt: new Date(T0 - 8 * DAY).toISOString(), firstSeenAt: new Date(T0 - 7 * DAY - 1000).toISOString(),
    },
  ];

  it('7일 지난 항목은 빠지고, 기존 항목은 firstSeenAt 보존·sources 합집합·hn 갱신', () => {
    const fresh = mergeCandidates([
      cand({ sourceName: 'Lobsters', title: 'Keep', url: 'https://old.example.com/keep', score: 12 }),
      cand({ sourceName: 'Hacker News', title: 'Keep', url: 'https://old.example.com/keep', hn: { id: '1', points: 350, comments: 9 } }),
      cand({ sourceName: 'Anthropic', title: 'New', url: 'https://new.example.com/n' }),
    ]);
    const items = applyToExisting(existing, fresh, T0);
    expect(items.map((it) => it.title)).toEqual(['Keep', 'New']);
    const keep = items[0];
    expect(keep.firstSeenAt).toBe(new Date(T0 - 3 * DAY).toISOString());
    expect(keep.sources).toEqual(['Hacker News', 'Lobsters']);
    expect(keep.hn?.points).toBe(350);
    expect(keep.score).toBe(12);
    expect(items[1].firstSeenAt).toBe(new Date(T0).toISOString());
  });

  it('id 가 달라도 titleKey 가 같으면 기존 항목에 합친다', () => {
    const fresh = mergeCandidates([cand({ sourceName: 'Lobsters', title: 'keep!', url: 'https://mirror.example.com/keep' })]);
    const items = applyToExisting(existing, fresh, T0);
    expect(items.filter((it) => titleKey(it.title) === 'keep')).toHaveLength(1);
    expect(items[0].id).toBe(existing[0].id);
    expect(items[0].sources).toEqual(['Hacker News', 'Lobsters']);
  });

  it('정렬: sources 수 내림차순 → firstSeenAt 내림차순', () => {
    const fresh = mergeCandidates([
      cand({ sourceName: 'A', title: 'Solo new', url: 'https://x.example.com/1' }),
      cand({ sourceName: 'A', title: 'Dup new', url: 'https://x.example.com/2' }),
      cand({ sourceName: 'B', title: 'Dup new', url: 'https://x.example.com/2' }),
    ]);
    const items = applyToExisting(existing, fresh, T0);
    expect(items.map((it) => it.title)).toEqual(['Dup new', 'Solo new', 'Keep']);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const before = JSON.stringify(existing);
    applyToExisting(existing, mergeCandidates([cand({ sourceName: 'Z', title: 'Keep', url: 'https://old.example.com/keep' })]), T0);
    expect(JSON.stringify(existing)).toBe(before);
  });
});
