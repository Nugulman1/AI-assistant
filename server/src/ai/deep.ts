/**
 * 글 심층 요약 + 기사 기반 Q&A — 상세 화면용.
 * 심층 요약은 브리핑 카드 요약(1~3문장)과 달리 원문 전체를 근거로
 * 핵심 요지 / 주요 내용 불릿 / 코더 시사점 구조로 쓴다.
 */
import { aiJson, aiText, MODEL_SUMMARY_LIGHT, type ChatMessage } from './client.js';

export interface DeepSummary {
  overview: string; // 핵심 요지 2~3문장
  points: string[]; // 주요 내용 4~7개
  takeaway: string; // 코더 관점 실무 시사점 1~2문장
}

// 로컬 9B의 num_ctx(16384) 안에 대화 이력까지 들어가게 본문 상한.
const BODY_CAP = 9000;

const DEEP_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
    takeaway: { type: 'string' },
  },
  required: ['overview', 'points', 'takeaway'],
  additionalProperties: false,
} as const;

const SYS_DEEP =
  '개발자 뉴스의 심층 요약 편집자다. 제공된 기사 원문을 근거로 한국어로 쓴다: ' +
  'overview(핵심 요지 2~3문장), points(주요 내용 4~7개, 각 1~2문장 — 원문의 메커니즘·수치·근거를 담아라), ' +
  'takeaway(실무 개발자 관점 시사점 1~2문장). ' +
  '원문에 없는 내용은 지어내지 마라. 전문용어는 처음 나올 때 한 줄로 풀어 쓴다. 과장·낚시 금지.';

/** 원문 기반 심층 요약. 실패는 throw — 라우트가 에러 응답으로 변환. */
export async function deepSummarize(title: string, body: string): Promise<DeepSummary> {
  return aiJson<DeepSummary>({
    model: MODEL_SUMMARY_LIGHT,
    system: SYS_DEEP,
    schema: DEEP_SCHEMA,
    user: `제목: ${title}\n\n원문:\n${body.slice(0, BODY_CAP)}`,
  });
}

const SYS_ASK = (title: string, body: string) =>
  '아래 기사에 대해 답하는 한국어 어시스턴트다. 기사 내용에 근거해 정확하고 간결하게 답하고, ' +
  '기사에 없는 내용을 물으면 기사에 없다고 밝힌 뒤 아는 일반 지식으로 보충하되 그 구분을 명시한다. ' +
  '전문용어는 쉽게 풀어 설명한다.\n\n' +
  `[기사 제목] ${title}\n[기사 원문]\n${body.slice(0, BODY_CAP)}`;

/** 기사 원문을 컨텍스트로 한 멀티턴 질문 답변. */
export async function askAboutArticle(
  title: string,
  body: string,
  history: ChatMessage[],
  question: string,
): Promise<string> {
  return aiText({
    model: MODEL_SUMMARY_LIGHT,
    system: SYS_ASK(title, body),
    messages: [...history, { role: 'user', content: question }],
  });
}
