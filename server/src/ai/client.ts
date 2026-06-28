import Anthropic from '@anthropic-ai/sdk';
import { env, hasAI } from '../env.js';

export const MODEL_GENRE = 'claude-haiku-4-5'; // 장르 분류 (싸고 빠름)
export const MODEL_SUMMARY = 'claude-sonnet-4-6'; // 제목 기반 요약 (품질)
export const MODEL_SUMMARY_LIGHT = 'claude-haiku-4-5'; // 본문 있는 글 요약 (싸고 빠름)

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
