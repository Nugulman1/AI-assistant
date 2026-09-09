/**
 * docs/data/items.json 의 스키마 — 수집기(collect)·정적 페이지(docs/index.html)·CLI(news) 세 곳이
 * 공유하는 유일한 계약. 필드를 바꾸면 세 곳을 같이 고친다.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Item {
  /** sha1(정규화 URL) 앞 12자. 페이지 별표·CLI dig 의 키. */
  id: string;
  title: string;
  /** 읽을 원문. HN 외부링크 글이면 외부 원문, 텍스트 글이면 HN 토론 링크. */
  url: string;
  /** 이 글을 실은 소스 이름들. length ≥ 2 = 교차소스 겹침(3층 문지기). */
  sources: string[];
  /** HN 에 올라온 글이면 토론 정보 (CLI dig 가 댓글을 가져오는 키). */
  hn?: { id: string; points: number; comments: number };
  /** 소스가 준 점수(Lobsters score, HF upvotes). 표시용, 정렬엔 안 씀. */
  score?: number;
  /** 원문 발행 시각 (ISO). */
  publishedAt: string;
  /** 처음 문지기를 통과해 목록에 들어온 시각 (ISO). 페이지의 날짜 묶음 기준. */
  firstSeenAt: string;
}

export interface ItemsFile {
  generatedAt: string;
  /** 최근 7일치. 정렬: sources.length 내림차순 → firstSeenAt 내림차순. */
  items: Item[];
}

export const ITEMS_PATH = path.resolve('docs/data/items.json');
export const ITEMS_RAW_URL =
  'https://raw.githubusercontent.com/Nugulman1/AI-assistant/main/docs/data/items.json';

export function readItems(file = ITEMS_PATH): ItemsFile {
  if (!fs.existsSync(file)) return { generatedAt: new Date(0).toISOString(), items: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ItemsFile;
}

export function writeItems(data: ItemsFile, file = ITEMS_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
}
