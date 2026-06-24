import { sign, verify } from 'hono/jwt';
import type { Context, Next } from 'hono';
import { env } from './env.js';

const WEEK = 7 * 24 * 60 * 60;

/** 패스코드가 맞으면 7일짜리 JWT 발급. */
export async function login(passcode: string): Promise<string | null> {
  if (!env.passcode || passcode !== env.passcode) return null;
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: 'owner', iat: now, exp: now + WEEK }, env.jwtSecret, 'HS256');
}

/** Authorization: Bearer <token> 검증 미들웨어. */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ error: '인증 필요' }, 401);
  try {
    await verify(token, env.jwtSecret, 'HS256');
  } catch {
    return c.json({ error: '토큰 무효' }, 401);
  }
  await next();
}
