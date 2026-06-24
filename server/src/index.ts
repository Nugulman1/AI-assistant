import { serve } from '@hono/node-server';
import { getDb } from './db.js';
import { env, hasAI, hasPush } from './env.js';
import { buildApp } from './routes.js';
import { scheduleJobs } from './scheduler.js';

getDb(); // 스키마 생성 + 기본 시드
const app = buildApp();
scheduleJobs();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(
    `[server] http://localhost:${info.port}  (AI: ${hasAI() ? 'on' : 'off'}, push: ${
      hasPush() ? 'on' : 'off'
    })`,
  );
  if (!env.passcode) {
    console.warn('[server] ⚠️  APP_PASSCODE 미설정 — 로그인 불가. .env 를 채우세요.');
  }
});
