# Dev News Briefing — 에이전트 컨텍스트

## 프로젝트 한 줄 요약
개발자 뉴스를 HN·RSS 등에서 수집해 AI(Haiku/Sonnet)로 장르 분류·요약 후 매일 새벽 PWA 브리핑으로 전달하는 단일 사용자 앱.

## 구조
```
/               — 루트 npm workspace (server + web)
server/         — Hono + SQLite 백엔드 (모든 수집·AI·DB 로직)
  src/
    sources/    — 소스별 수집기 (HN·RSS·Reddit·fulltext)
    pipeline/   — dedup → normalize → rank → interest
    ai/         — Haiku 장르 분류, Haiku/Sonnet 요약
    briefing.ts — 수집→랭킹→AI→DB 전체 오케스트레이터
    routes.ts   — Hono REST API
    scheduler.ts — node-cron (수집·푸시 두 잡)
    db.ts       — SQLite 스키마 + 마이그레이션 + 시드
web/            — SvelteKit PWA (프론트엔드)
```

## 핵심 명령
```bash
npm run dev          # server(3001) + web(5173) 동시 기동
npm run build        # web 빌드 (Railway 배포 전)
npm run start        # 프로덕션 (server가 web/build 서빙)
npm run run:once     # 수동으로 브리핑 1회 즉시 생성 (Railway 첫 데이터용)
npm -w server test   # 서버 단위테스트
```

## 핵심 불변조건 (깨면 버그)
- **48h 수집창** — `dedup(maxAgeDays=2)` 하나. 신선도는 시간컷이 아니라 `topicality` 랭킹으로.
- **seen 기록 = 실제 보여준 것만** — `generateBriefing`에서 선정된 item만 `seen` 등록. 미선정 후보는 다음 사이클에 재후보가 됨.
- **candidate_pool 격리** — `items`/`feedback`/대시보드를 '안 본 후보'로 오염하지 않기 위해 별 테이블 유지. `loadMore`만 pool → items 승격.
- **best_items 격리** — HN 기간별 베스트(week/month/year)는 48h 메인 파이프라인과 완전 분리. 수집 시 period별 통째 교체.

## 어디를 봐야 하나
| 작업 | 파일 |
|------|------|
| DB 스키마·마이그레이션 | `server/src/db.ts` |
| 수집·AI 전체 흐름 | `server/src/briefing.ts` |
| API 엔드포인트 | `server/src/routes.ts` |
| cron 스케줄 변경 | `server/src/scheduler.ts` |
| 소스 추가/수정 | `server/src/sources/` |
| 파이프라인 로직 | `server/src/pipeline/` |
| 프론트 라우트 | `web/src/routes/` |

## 배포
Railway 단일 서비스. `railway.toml` + `.nvmrc` 참조. SQLite 영속 볼륨 `DB_PATH=/data/...`. 포트는 반드시 `8080` (Railway 강제). server가 `web/build`를 same-origin 서빙.

## 필수 환경변수
`APP_PASSCODE`, `JWT_SECRET`, `ANTHROPIC_API_KEY` (없으면 AI 비활성, 요약 스킵), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (없으면 푸시 비활성), `DB_PATH`.
