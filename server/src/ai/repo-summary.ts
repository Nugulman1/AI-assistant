/**
 * GitHub 트렌딩 리포 한국어 요약 — 뉴스 카드처럼 "뭐 하는 프로젝트고 왜 주목할 만한지".
 * README(본문)가 있으니 기존 컨벤션대로 Haiku(MODEL_SUMMARY_LIGHT) 사용.
 * 실패는 빈 배열로 격리 — 요약 없는 리포는 다음 수집 사이클에 자연 재시도된다(캐시 미적재).
 */
import { hasAnyAI } from '../env.js';
import { aiJson, MODEL_SUMMARY_LIGHT } from './client.js';

export interface RepoSummaryInput {
  name: string; // 'owner/repo'
  description: string; // 트렌딩 페이지 설명(영어, 없으면 '')
  language: string | null;
  readme: string | null; // README 발췌(이미 상한 절단됨), 실패 시 null
}

export interface RepoSummary {
  name: string;
  summary: string; // 한국어 1~2문장
}

const BATCH_SIZE = 8;

const SCHEMA = {
  type: 'object',
  properties: {
    summaries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          summary: { type: 'string' },
        },
        required: ['index', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['summaries'],
  additionalProperties: false,
} as const;

const SYSTEM =
  '개발자에게 보내는 한국어 뉴스 브리핑 편집자다. 각 GitHub 리포지토리가 뭐 하는 프로젝트인지, ' +
  '왜 주목할 만한지를 자연스러운 한국어 1~2문장으로 쓴다. 제공된 설명·README에 근거해 사실만 쓰고, ' +
  '없는 내용은 지어내지 마라. 과장·낚시 금지. 전문용어는 필요한 만큼만. ' +
  "'README 없음/요약 불가' 같은 메타 발언은 절대 쓰지 말고, 주어진 정보만으로 요약을 채운다.";

// 요약 대신 메타 발언이 나오면 캐시에 적재하지 않는다(화면 노출 방지, summarize.ts 그물망과 동형).
const REFUSAL_RE =
  /(요약할 수 없|요약\s*불가|README\s*(가|이)?\s*없|정보가?\s*부족|내용에 접근|접근할 수 없)/;

function buildList(items: RepoSummaryInput[]): string {
  return items
    .map((it, i) => {
      const head = `${i}. ${it.name}${it.language ? ` (${it.language})` : ''}\n   설명: ${it.description || '(없음)'}`;
      return it.readme ? `${head}\n   README: ${it.readme}` : head;
    })
    .join('\n\n');
}

/** 한 배치 요약. 실패·클라이언트 없음 → []. */
async function runBatch(items: RepoSummaryInput[]): Promise<RepoSummary[]> {
  if (!hasAnyAI() || items.length === 0) return [];
  try {
    const parsed = await aiJson<{
      summaries: { index: number; summary: string }[];
    }>({
      model: MODEL_SUMMARY_LIGHT,
      system: SYSTEM,
      schema: SCHEMA,
      user: `다음 리포지토리들을 각각 요약하라.\n\n${buildList(items)}`,
    });
    const out: RepoSummary[] = [];
    for (const s of parsed.summaries) {
      const it = items[s.index];
      if (!it || !s.summary.trim() || REFUSAL_RE.test(s.summary)) continue;
      out.push({ name: it.name, summary: s.summary.trim() });
    }
    return out;
  } catch (err) {
    console.warn('[ai] 리포 요약 배치 실패(스킵):', (err as Error).message);
    return [];
  }
}

/** 입력을 BATCH_SIZE 단위로 갈라 순차 요약(레이트리밋 배려). 부분 실패 허용. */
export async function summarizeRepos(
  items: RepoSummaryInput[],
): Promise<RepoSummary[]> {
  const out: RepoSummary[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    out.push(...(await runBatch(items.slice(i, i + BATCH_SIZE))));
  }
  return out;
}
