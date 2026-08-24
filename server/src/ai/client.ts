import Anthropic from '@anthropic-ai/sdk';
import { env, hasAI, hasOllama } from '../env.js';

export const MODEL_GENRE = 'claude-haiku-4-5'; // 장르 분류 (싸고 빠름)
export const MODEL_SUMMARY = 'claude-sonnet-4-6'; // 제목 기반 요약 (품질)
export const MODEL_SUMMARY_LIGHT = 'claude-haiku-4-5'; // 본문 있는 글 요약 (싸고 빠름)

// 로컬 9B 는 배치 요약에 분 단위가 걸릴 수 있다 — 새벽 배치 작업이라 길게 허용.
const OLLAMA_TIMEOUT_MS = 300_000;

let _client: Anthropic | null = null;

export function getClient(): Anthropic | null {
  if (!hasAI()) return null;
  if (!_client) _client = new Anthropic({ apiKey: env.anthropicApiKey });
  return _client;
}

/** output_config.format 응답에서 첫 text 블록(=유효 JSON)을 꺼내 파싱. */
export function parseJsonResponse<T>(content: Anthropic.ContentBlock[]): T {
  const text = content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AI 응답에 text 블록 없음');
  return JSON.parse(text.text) as T;
}

export interface AiJsonOpts {
  /** Anthropic 폴백 경로에서 쓸 모델. Ollama 경로는 env.ollamaModel 단일 모델. */
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

interface OllamaChatOpts {
  system: string;
  messages: ChatMessage[];
  schema?: Record<string, unknown>; // 있으면 구조화 출력(format=json schema)
  temperature?: number;
}

/** Ollama /api/chat 공통 호출 — content 문자열 반환. 실패는 throw(호출부가 폴백). */
async function ollamaChat(opts: OllamaChatOpts, suppressThink = true): Promise<string> {
  const payload: Record<string, unknown> = {
    model: env.ollamaModel,
    stream: false,
    // KV 캐시 양자화는 켜지 않는다(긴 컨텍스트에서 구조화 출력이 깨지는 주범).
    options: { temperature: opts.temperature ?? 0.3, num_ctx: 16384 },
    messages: [{ role: 'system', content: opts.system }, ...opts.messages],
  };
  if (opts.schema) payload.format = opts.schema;
  // think:false — 사고 모드 억제. 요약·분류엔 수천 토큰 사고가 시간만 먹는다
  // (실측: 사고 ~7천 토큰에 5분, 답변 자체는 12초).
  if (suppressThink) payload.think = false;
  const res = await fetch(`${env.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
  });
  if (!res.ok) {
    // think 파라미터 미지원 모델이면 400 — think 없이 1회 재시도.
    if (res.status === 400 && suppressThink) {
      const body = await res.text().catch(() => '');
      if (/think/i.test(body)) return ollamaChat(opts, false);
    }
    throw new Error(`Ollama HTTP ${res.status}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  // thinking 계열 모델이 <think> 블록을 섞어도 답만 남긴다.
  const content = (data.message?.content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  if (!content) throw new Error('Ollama 빈 응답');
  return content;
}

/**
 * 모든 AI JSON 호출의 단일 진입점 — Ollama(로컬) 우선, 실패 시 Anthropic.
 * 둘 다 없으면 throw — 호출부의 기존 폴백(제목/기타)이 받는다.
 */
export async function aiJson<T>(opts: AiJsonOpts): Promise<T> {
  if (hasOllama()) {
    try {
      const content = await ollamaChat({
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        schema: opts.schema,
      });
      return JSON.parse(content) as T;
    } catch (err) {
      console.warn('[ai] Ollama 실패, Anthropic 폴백:', (err as Error).message);
    }
  }
  const client = getClient();
  if (!client) throw new Error('AI 백엔드 없음 (OLLAMA_MODEL/ANTHROPIC_API_KEY 미설정)');
  const res = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    output_config: { format: { type: 'json_schema', schema: opts.schema } },
    messages: [{ role: 'user', content: opts.user }],
  });
  return parseJsonResponse<T>(res.content);
}

export interface AiTextOpts {
  /** Anthropic 폴백 경로에서 쓸 모델. */
  model: string;
  system: string;
  messages: ChatMessage[]; // 멀티턴 대화 이력 포함 가능
  maxTokens?: number;
}

/**
 * 자유 텍스트 대화 진입점(질문·답변용) — Ollama 우선, 실패 시 Anthropic.
 * aiJson 과 달리 JSON 을 강제하지 않는다.
 */
export async function aiText(opts: AiTextOpts): Promise<string> {
  if (hasOllama()) {
    try {
      return await ollamaChat({
        system: opts.system,
        messages: opts.messages,
        temperature: 0.5,
      });
    } catch (err) {
      console.warn('[ai] Ollama 실패, Anthropic 폴백:', (err as Error).message);
    }
  }
  const client = getClient();
  if (!client) throw new Error('AI 백엔드 없음 (OLLAMA_MODEL/ANTHROPIC_API_KEY 미설정)');
  const res = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: opts.messages,
  });
  const text = res.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('AI 응답에 text 블록 없음');
  return text.text;
}
