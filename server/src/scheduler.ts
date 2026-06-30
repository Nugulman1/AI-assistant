import cron from 'node-cron';
import { getConfig } from './db.js';
import { generateBriefing, getBriefingView } from './briefing.js';
import { collectAndStoreBest } from './best.js';
import { collectAndStoreTrending } from './github-best.js';
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
      // 기간별 베스트는 브리핑과 독립 — 실패해도 메인 브리핑에 영향 없게 분리.
      try {
        await collectAndStoreBest();
      } catch (err) {
        console.error('[scheduler] 베스트 수집 실패:', err);
      }
      // GitHub 트렌딩도 브리핑·HN베스트와 독립 — 실패 격리.
      try {
        await collectAndStoreTrending();
      } catch (err) {
        console.error('[scheduler] GitHub 트렌딩 수집 실패:', err);
      }
    },
    opts,
  );

  pushTask = cron.schedule(
    pushExpr,
    async () => {
      const view = getBriefingView();
      if (!view) return;
      // 이번 수집 사이클에 막 만든 브리핑일 때만 푸시(벽시계 날짜 대신 생성시각으로).
      // 수집은 푸시보다 lead_minutes 전에 도니, 그 직전 생성분이 신선한 것.
      // 날짜 비교는 자정을 가로지르는 도착시간에서 오발동하므로 쓰지 않는다.
      const freshMs = (cfg.lead_minutes + 60) * 60_000; // lead + 60분 여유
      if (Date.now() - view.createdAt > freshMs) {
        console.log(
          `[scheduler] 신선한 브리핑 없음 — 푸시 건너뜀 (최신: ${view.arrivalDate})`,
        );
        return;
      }
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
