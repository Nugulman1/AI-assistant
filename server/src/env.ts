import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 레포 루트 기준으로 .env 로드 — CWD(루트/서버 어디서 띄우든) 상관없이 단일 루트 .env 사용.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
loadEnv({ path: path.join(repoRoot, '.env') });

/** 환경변수 한 곳에서 읽어 타입 있는 설정 객체로. 기본값은 로컬 구동에 맞춤. */
export const env = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(repoRoot, 'data/briefing.sqlite'),
  // web 정적 빌드 산출물(합친 서비스에서 server가 서빙). 소스 위치 기준 절대경로 — CWD 무관.
  webDist: path.join(repoRoot, 'web/build'),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  tz: process.env.TZ ?? 'Asia/Seoul',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  passcode: process.env.APP_PASSCODE ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-secret',

  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:you@example.com',
};

export const hasAI = () => env.anthropicApiKey.length > 0;
export const hasPush = () =>
  env.vapidPublicKey.length > 0 && env.vapidPrivateKey.length > 0;
