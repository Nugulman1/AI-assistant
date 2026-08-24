/**
 * 코더 추천 3선 — 오늘 브리핑에 노출된 글 중 실무 개발자 관점 3개를 이유와 함께 선정.
 * 필독(화제도 랭킹)과 별개 축: 화제성이 아니라 "코더가 읽으면 얻어갈 것"이 기준.
 * 실패·백엔드 없음 → 빈 배열(화면에서 섹션 숨김).
 */
import { hasAnyAI } from '../env.js';
import { aiJson, MODEL_SUMMARY_LIGHT } from './client.js';

export interface RecommendInput {
  id: number; // DB item id
  title: string;
  genre: string | null;
  summary: string; // 이미 생성된 요약(필독=헤드라인+본문, 더보기=한줄)
}

export interface CoderPick {
  id: number;
  reason: string; // 왜 코더가 읽어야 하는지 한 줄
}

const SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['index', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['picks'],
  additionalProperties: false,
} as const;

const SYSTEM =
  '실무 개발자(코더)를 위한 글 큐레이터다. 오늘 브리핑 글 목록에서 코더가 읽으면 ' +
  '가장 얻어갈 게 많은 글 3개를 고른다. 선정 기준: 실무 영향(도구·표준·언어·인프라의 변화), ' +
  '학습 가치(깊이 있는 기술 분석·실험), 소장 가치(두고두고 참고할 레퍼런스). ' +
  '유머·시사·비기술 글은 제외한다. 각 선택에 왜 코더가 읽어야 하는지 구체적 근거가 담긴 ' +
  '한국어 한 줄(60자 내외) 이유를 단다. 이유에 과장·낚시 금지.';

/** 노출된 글 목록에서 코더 추천 count 개 선정. */
export async function recommendForCoders(
  items: RecommendInput[],
  count = 3,
): Promise<CoderPick[]> {
  if (items.length === 0 || !hasAnyAI()) return [];
  const list = items
    .map((it, i) => `${i}. [${it.genre ?? '기타'}] ${it.title}\n   요약: ${it.summary}`)
    .join('\n');
  try {
    const parsed = await aiJson<{ picks: { index: number; reason: string }[] }>({
      model: MODEL_SUMMARY_LIGHT,
      system: SYSTEM,
      schema: SCHEMA,
      user: `다음 글 목록에서 코더 추천 ${count}개를 골라라. index 는 아래 번호 그대로.\n\n${list}`,
    });
    const out: CoderPick[] = [];
    for (const p of parsed.picks) {
      const it = items[p.index];
      if (!it || out.some((o) => o.id === it.id)) continue;
      out.push({ id: it.id, reason: p.reason.trim() });
    }
    return out.slice(0, count);
  } catch (err) {
    console.warn('[ai] 코더 추천 실패(섹션 생략):', (err as Error).message);
    return [];
  }
}
