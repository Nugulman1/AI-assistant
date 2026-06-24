import cron from 'node-cron';
import { getConfig } from './db.js';
import { generateBriefing, getBriefingView } from './briefing.js';
import { sendPushToAll } from './push.js';

let collectTask: cron.ScheduledTask | null = null;
let pushTask: cron.ScheduledTask | null = null;

/** "HH:MM" 에서 lead 분만큼 뺀 시각을 반환. */
function minusMinutes(hhmm: string, lead: number): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m - lead;
  total = ((total % 1440) + 1440) % 1440; // 음수/자정넘김 보정
  return { h: Math.floor(total / 60), m: total % 60 };
}

/**
 * config(도착시간·리드분)로 두 cron 을 (재)설치:
 *  - 수집·AI: 도착 lead 분 전 → generateBriefing()
 *  - 푸시 발송: 도착 정각 → 최신 브리핑 알림
 * config 변경 시 다시 호출하면 갈아끼운다.
 */
export function scheduleJobs(): void {
  const cfg = getConfig();
  collectTask?.stop();
  pushTask?.stop();

  const collect = minusMinutes(cfg.arrival_time, cfg.lead_minutes);
  const [ah, am] = cfg.arrival_time.split(':').map(Number);
  const opts = { timezone: cfg.timezone };

  const collectExpr = `${collect.m} ${collect.h} * * *`;
  const pushExpr = `${am} ${ah} * * *`;

  collectTask = cron.schedule(
    collectExpr,
    async () => {
      console.log('[scheduler] 수집·AI 시작');
      try {
        await generateBriefing();
      } catch (err) {
        console.error('[scheduler] 브리핑 생성 실패:', err);
      }
    },
    opts,
  );

  pushTask = cron.schedule(
    pushExpr,
    async () => {
      const view = getBriefingView();
      if (!view) return;
      const top = view.mustRead[0];
      await sendPushToAll({
        title: `오늘의 개발 브리핑 (${view.arrivalDate})`,
        body: top ? `필독: ${top.headline}` : '새 브리핑이 도착했습니다.',
        url: '/',
      });
      console.log('[scheduler] 푸시 발송 완료');
    },
    opts,
  );

  console.log(
    `[scheduler] 수집 ${collectExpr} / 푸시 ${pushExpr} (${cfg.timezone}) 예약됨`,
  );
}
