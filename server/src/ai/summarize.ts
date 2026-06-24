import { getClient, MODEL_SUMMARY, parseJsonResponse } from './client.js';

export interface SummarizeInput {
  id: number;
  title: string;
  url: string;
  sourceName: string;
  genre: string | null;
}

export interface MustReadSummary {
  id: number;
  headline: string; // 한국어 제목
  body: string; // 문단 요약 (2~3문장)
}
export interface MoreLine {
  id: number;
  line: string; // 한줄 요약
}

function buildList(items: SummarizeInput[]): string {
  return items
    .map((it, i) => `${i}. [${it.sourceName}/${it.genre ?? '기타'}] ${it.title}\n   ${it.url}`)
    .join('\n');
}

const MUST_SCHEMA = {
  type: 'object',
  properties: {
    summaries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          headline: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['index', 'headline', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['summaries'],
  additionalProperties: false,
} as const;

const MORE_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          line: { type: 'string' },
        },
        required: ['index', 'line'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
} as const;

/** 필독 3건 — 한국어 헤드라인 + 2~3문장 문단 요약. AI 없으면 제목 그대로. */
export async function summarizeMustRead(
  items: SummarizeInput[],
): Promise<MustReadSummary[]> {
  if (items.length === 0) return [];
  const client = getClient();
  if (!client) {
    return items.map((it) => ({ id: it.id, headline: it.title, body: it.title }));
  }
  try {
    const res = await client.messages.create({
      model: MODEL_SUMMARY,
      max_tokens: 2048,
      system:
        '개발자에게 보내는 한국어 뉴스 브리핑 편집자다. 각 기사에 자연스러운 한국어 헤드라인 한 줄과, ' +
        '왜 주목할 만한지 2~3문장 문단 요약을 쓴다. 과장·낚시 금지, 사실 위주. 제목만 보고 모르면 일반적 맥락으로.',
      output_config: { format: { type: 'json_schema', schema: MUST_SCHEMA } },
      messages: [
        { role: 'user', content: `다음 기사들을 요약하라.\n\n${buildList(items)}` },
      ],
    });
    const parsed = parseJsonResponse<{
      summaries: { index: number; headline: string; body: string }[];
    }>(res.content);
    const out: MustReadSummary[] = [];
    for (const s of parsed.summaries) {
      const it = items[s.index];
      if (it) out.push({ id: it.id, headline: s.headline, body: s.body });
    }
    // 누락 폴백
    for (const it of items)
      if (!out.find((o) => o.id === it.id))
        out.push({ id: it.id, headline: it.title, body: it.title });
    return out;
  } catch (err) {
    console.warn('[ai] 필독 요약 실패, 제목 폴백:', (err as Error).message);
    return items.map((it) => ({ id: it.id, headline: it.title, body: it.title }));
  }
}

/** 더보기 N건 — 한줄 요약. AI 없으면 제목 그대로. */
export async function summarizeMore(items: SummarizeInput[]): Promise<MoreLine[]> {
  if (items.length === 0) return [];
  const client = getClient();
  if (!client) return items.map((it) => ({ id: it.id, line: it.title }));
  try {
    const res = await client.messages.create({
      model: MODEL_SUMMARY,
      max_tokens: 2048,
      system:
        '개발자 한국어 뉴스 브리핑 편집자다. 각 기사를 한 줄(40자 내외)로 압축한다. 사실 위주, 군더더기 없이.',
      output_config: { format: { type: 'json_schema', schema: MORE_SCHEMA } },
      messages: [
        { role: 'user', content: `다음 기사들을 각각 한 줄로.\n\n${buildList(items)}` },
      ],
    });
    const parsed = parseJsonResponse<{ lines: { index: number; line: string }[] }>(
      res.content,
    );
    const out: MoreLine[] = [];
    for (const l of parsed.lines) {
      const it = items[l.index];
      if (it) out.push({ id: it.id, line: l.line });
    }
    for (const it of items)
      if (!out.find((o) => o.id === it.id)) out.push({ id: it.id, line: it.title });
    return out;
  } catch (err) {
    console.warn('[ai] 더보기 요약 실패, 제목 폴백:', (err as Error).message);
    return items.map((it) => ({ id: it.id, line: it.title }));
  }
}
