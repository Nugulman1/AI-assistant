import { serve } from '@hono/node-server';
import { getDb } from './db.js';
import { env, hasAI, hasOllama, hasPush } from './env.js';
import { buildApp } from './routes.js';
import { scheduleJobs } from './scheduler.js';
import { ensureOllama } from './ollama-boot.js';

getDb(); // 스키마 생성 + 기본 시드
const app = buildApp();
scheduleJobs();
void ensureOllama(); // 로컬 LLM 자동 기동 — 서버 시작을 막지 않게 비동기(실패해도 폴백 동작)

const aiLabel = hasOllama()
  ? `ollama(${env.ollamaModel})${hasAI() ? '+anthropic 폴백' : ''}`
  : hasAI()
    ? 'anthropic'
    : 'off';

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(
    `[server] http://localhost:${info.port}  (AI: ${aiLabel}, push: ${
      hasPush() ? 'on' : 'off'
    })`,
  );
});
