import { GENRES } from '../db.js';
import { getClient, MODEL_GENRE, parseJsonResponse } from './client.js';

export interface ClassifyInput {
  id: number;
  title: string;
  sourceName: string;
}

const SYSTEM = `당신은 개발자 뉴스 기사를 8개 장르 중 정확히 하나로 분류하는 태거다.
적합도 점수가 아니라 '주제 분류'만 한다. 제목과 출처로 판단하라.
8장르: ${GENRES.join(' / ')}.
애매하면 가장 가까운 장르를, 정말 안 맞으면 '기타'를 쓴다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          genre: { type: 'string', enum: [...GENRES] },
        },
        required: ['index', 'genre'],
        additionalProperties: false,
      },
    },
  },
  required: ['classifications'],
  additionalProperties: false,
} as const;

/**
 * Haiku 4.5 로 각 기사를 8장르 분류. AI 키 없으면 전부 '기타'.
 * 반환: id → genre 맵.
 */
export async function classifyGenres(
  items: ClassifyInput[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (items.length === 0) return result;

  const client = getClient();
  if (!client) {
    for (const it of items) result.set(it.id, '기타');
    return result;
  }

  const list = items
    .map((it, i) => `${i}. [${it.sourceName}] ${it.title}`)
    .join('\n');

  try {
    const res = await client.messages.create({
      model: MODEL_GENRE,
      max_tokens: 4096,
      system: SYSTEM,
      // @ts-expect-error output_config 는 최신 API 파라미터 (런타임 tsx 는 타입체크 안 함)
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `다음 기사들을 장르 분류하라. index 는 아래 번호 그대로.\n\n${list}`,
        },
      ],
    });
    const parsed = parseJsonResponse<{
      classifications: { index: number; genre: string }[];
    }>(res.content);
    for (const c of parsed.classifications) {
      const it = items[c.index];
      if (it) result.set(it.id, c.genre);
    }
  } catch (err) {
    console.warn('[ai] 장르 분류 실패, 기타로 폴백:', (err as Error).message);
  }

  // 누락분 기타로 채움
  for (const it of items) if (!result.has(it.id)) result.set(it.id, '기타');
  return result;
}
