import {
  getClient,
  MODEL_SUMMARY,
  MODEL_SUMMARY_LIGHT,
  parseJsonResponse,
} from './client.js';

export interface SummarizeInput {
  id: number;
  title: string;
  url: string;
  sourceName: string;
  genre: string | null;
  body?: string; // 있으면 본문 기반(Haiku), 없으면 제목 기반(Sonnet)
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
  // body 는 수집 단계 extractText 에서 이미 상한까지 잘려 있다(절단 지점 단일화).
  return items
    .map((it, i) => {
      const head = `${i}. [${it.sourceName}/${it.genre ?? '기타'}] ${it.title}\n   ${it.url}`;
      return it.body ? `${head}\n   본문: ${it.body}` : head;
    })
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

// 본문 기반(Haiku): 본문에 근거해 사실만. 제목 기반(Sonnet): 모르면 단정 금지.
const SYS_MUST_BODY =
  '개발자에게 보내는 한국어 뉴스 브리핑 편집자다. 각 기사에 자연스러운 한국어 헤드라인 한 줄과, ' +
  '왜 주목할 만한지 2~3문장 문단 요약을 쓴다. 반드시 제공된 본문에 근거해 사실만 쓰고, 본문에 없는 내용은 지어내지 마라. 과장·낚시 금지.';
const SYS_MUST_TITLE =
  '개발자에게 보내는 한국어 뉴스 브리핑 편집자다. 각 기사에 자연스러운 한국어 헤드라인 한 줄과, ' +
  '왜 주목할 만한지 2~3문장 문단 요약을 쓴다. 과장·낚시 금지, 사실 위주. 본문 없이 제목만 주어진다 — ' +
  '제목을 자연스러운 한국어로 옮기고 아는 일반 맥락을 덧붙이되, 확실치 않으면 추측하지 말고 제목의 사실만 간결히 전한다. ' +
  "'본문 없음/요약 불가/접근 불가' 같은 메타 발언은 절대 쓰지 말고, 헤드라인과 본문은 항상 기사 내용으로 채운다.";
const SYS_MORE_BODY =
  '개발자 한국어 뉴스 브리핑 편집자다. 제공된 본문에 근거해 각 기사를 한 줄(40자 내외)로 압축한다. 본문에 없는 내용은 지어내지 마라.';
const SYS_MORE_TITLE =
  '개발자 한국어 뉴스 브리핑 편집자다. 각 기사를 한 줄(40자 내외)로 압축한다. 사실 위주, 군더더기 없이. ' +
  "본문 없이 제목만 주어져도 제목을 자연스럽게 옮긴다. '요약 불가/본문 없음' 같은 메타 발언 금지.";

const mustFallback = (items: SummarizeInput[]): MustReadSummary[] =>
  items.map((it) => ({ id: it.id, headline: it.title, body: it.title }));
const moreFallback = (items: SummarizeInput[]): MoreLine[] =>
  items.map((it) => ({ id: it.id, line: it.title }));

// 본문 없는 제목기반 요약에서 모델이 요약을 거부하고 메타 발언을 내뱉는 경우를 잡는 그물망.
// 이런 응답은 제목으로 폴백한다(거부 문구가 화면에 노출되는 것보다 낫다).
const REFUSAL_RE =
  /(요약할 수 없|요약을 작성|요약\s*불가|본문\s*내용이?\s*없|본문에 접근|접근할 수 없|접근\s*불가|확인\s*불가|내용에 접근)/;
const isRefusal = (s: string): boolean => REFUSAL_RE.test(s);

/** 필독 한 배치를 주어진 모델·시스템프롬프트로 요약. 실패 시 제목 폴백. */
async function runMust(
  items: SummarizeInput[],
  model: string,
  system: string,
): Promise<MustReadSummary[]> {
  if (items.length === 0) return [];
  const client = getClient();
  if (!client) return mustFallback(items);
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      system,
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
      if (!it) continue;
      if (isRefusal(s.headline) || isRefusal(s.body))
        out.push({ id: it.id, headline: it.title, body: it.title });
      else out.push({ id: it.id, headline: s.headline, body: s.body });
    }
    for (const it of items)
      if (!out.find((o) => o.id === it.id))
        out.push({ id: it.id, headline: it.title, body: it.title });
    return out;
  } catch (err) {
    console.warn('[ai] 필독 요약 실패, 제목 폴백:', (err as Error).message);
    return mustFallback(items);
  }
}

/** 더보기 한 배치를 주어진 모델·시스템프롬프트로 한줄 요약. 실패 시 제목 폴백. */
async function runMore(
  items: SummarizeInput[],
  model: string,
  system: string,
): Promise<MoreLine[]> {
  if (items.length === 0) return [];
  const client = getClient();
  if (!client) return moreFallback(items);
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 2048,
      system,
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
      if (!it) continue;
      out.push({ id: it.id, line: isRefusal(l.line) ? it.title : l.line });
    }
    for (const it of items)
      if (!out.find((o) => o.id === it.id)) out.push({ id: it.id, line: it.title });
    return out;
  } catch (err) {
    console.warn('[ai] 더보기 요약 실패, 제목 폴백:', (err as Error).message);
    return moreFallback(items);
  }
}

/**
 * items 를 본문 유무로 갈라 병렬 요약 후 합친다.
 * 본문 있는 글 → Haiku로 본문 기반, 없는 글 → Sonnet으로 제목 기반.
 */
async function summarizeByBody<T>(
  items: SummarizeInput[],
  run: (items: SummarizeInput[], model: string, system: string) => Promise<T[]>,
  sysBody: string,
  sysTitle: string,
): Promise<T[]> {
  if (items.length === 0) return [];
  const withBody = items.filter((it) => it.body);
  const noBody = items.filter((it) => !it.body);
  const [a, b] = await Promise.all([
    run(withBody, MODEL_SUMMARY_LIGHT, sysBody),
    run(noBody, MODEL_SUMMARY, sysTitle),
  ]);
  return [...a, ...b];
}

/** 필독 — 한국어 헤드라인 + 2~3문장. */
export const summarizeMustRead = (items: SummarizeInput[]) =>
  summarizeByBody(items, runMust, SYS_MUST_BODY, SYS_MUST_TITLE);

/** 더보기 — 한줄. */
export const summarizeMore = (items: SummarizeInput[]) =>
  summarizeByBody(items, runMore, SYS_MORE_BODY, SYS_MORE_TITLE);
