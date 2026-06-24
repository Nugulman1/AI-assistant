import webpush from 'web-push';
import { getDb } from './db.js';
import { env, hasPush } from './env.js';

let configured = false;

function ensureConfigured(): boolean {
  if (!hasPush()) return false;
  if (!configured) {
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
    configured = true;
  }
  return true;
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** 구독 저장 (endpoint 유니크 → 중복이면 무시). */
export function saveSubscription(sub: PushSub): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO push_subs (endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}

/** 모든 구독자에게 푸시. 만료(410/404) 구독은 정리. */
export async function sendPushToAll(payload: {
  title: string;
  body: string;
  url?: string;
}): Promise<{ sent: number; removed: number }> {
  if (!ensureConfigured()) {
    console.warn('[push] VAPID 키 없음 — 푸시 건너뜀');
    return { sent: 0, removed: 0 };
  }
  const db = getDb();
  const subs = db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subs')
    .all() as { endpoint: string; p256dh: string; auth: string }[];

  let sent = 0;
  let removed = 0;
  const del = db.prepare('DELETE FROM push_subs WHERE endpoint = ?');

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          del.run(s.endpoint);
          removed++;
        } else {
          console.warn('[push] 발송 실패:', (err as Error).message);
        }
      }
    }),
  );
  return { sent, removed };
}
