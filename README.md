# 개발 뉴스 브리핑 수집기 (v1)

개발자 뉴스/최신정보를 **화제도 + 취향(좋아요·관심없음 학습)**으로 골라 매일 새벽 정해진 시각에
완성된 브리핑으로 보내주는 PWA. 풀스택 TypeScript · Hono · SQLite · SvelteKit(PWA).

> **콜드스타트 → 점진 학습** — 신호가 0일 땐 화제도 100%로 시작하고, 좋아요·관심없음이
> 쌓이면 장르 취향 가중치가 인기와 비등하게 경쟁한다(탐색 노출은 항상 유지).

---

## 구조 한눈에

```
수집(RSS·HN·Reddit) → [코드] 중복병합·오래된것 컷 → 화제도 z-정규화
   → Haiku 8장르 분류 → 랭킹(필독3 다양성가드 / 더보기 전장르+탐색주입)
   → Sonnet 요약 → SQLite 저장 → PWA 표시 + 도착시각 푸시
```

- **server/** — Hono REST API + SQLite + 수집·파이프라인·AI·스케줄러·web-push
- **web/** — SvelteKit PWA (로그인 → 브리핑 → 대시보드 → 설정, 설치형, 푸시)

도착 시각(기본 05:00) 기준으로 **그 N분 전(기본 15분)에 수집·AI를 끝내고, 정각에 푸시** →
5시에 *완성된 보고서가 도착*(수집 시점이 아님).

---

## 로컬 실행

### 0. 요구사항
- Node.js 20+ (개발은 22로 검증). npm.

### 1. 의존성 설치
```bash
npm install        # 루트에서 — server/web 워크스페이스 한 번에
```

### 2. 환경변수 (`.env`)
루트에 `.env`를 만든다(`.env.example` 복사). `.env`는 git에 안 올라간다.
```bash
cp .env.example .env
```
채울 값:
- `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com)에서 발급.
  **비우면 AI는 건너뛰고**(장르=기타, 요약=제목) 수집·랭킹 파이프라인만 돈다.
- `APP_PASSCODE` — PWA 로그인 패스코드(원하는 비밀 문자열).
- `JWT_SECRET` — 아무 긴 랜덤 문자열.
- VAPID 키 — 아래에서 생성.

### 3. 푸시용 VAPID 키 생성
```bash
npm run vapid
```
출력된 두 줄(`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`)을 `.env`에 붙여넣는다.
(푸시를 안 쓰면 생략 — 비워두면 발송만 건너뛴다.)

### 4. 개발 서버 실행 (백엔드 + 프론트 동시)
```bash
npm run dev
```
- API: http://localhost:8787
- PWA: http://localhost:5173

브라우저에서 5173 접속 → 패스코드로 로그인 → 브리핑 확인.
(스케줄러 없이 즉석으로 한 건 만들려면 아래 `npm run run:once`.)

### 따로 실행하고 싶으면
```bash
npm run dev:server     # API 만
npm run dev:web        # PWA 만
```

### 스케줄러 없이 브리핑 1건만 생성(검증용)
```bash
npm run run:once       # 수집→AI→저장 후 결과 JSON 출력
```

---

## 주요 동작

- **선별 파이프라인(콜드스타트):** 이미 본 글(`seen`) 제외, 교차소스 중복 병합(중복=화제도 강신호),
  오래된 글 컷, 소스별 z-점수로 화제도 정규화.
- **AI 계층:** Haiku 4.5로 전 기사를 8장르 분류, Sonnet 4.6으로 상위 ~10건 요약
  (필독 3 = 문단, 더보기 N = 한줄).
- **랭킹:** 필독 3 = 화제도 + 다양성 가드(같은 장르 페널티). 더보기 = 전 장르 고루 샘플 +
  저화제 논문·블로그 **탐색 주입**(학습용).
- **취향 학습:** 좋아요(+)/관심없음(−)을 장르별 집계(tanh 정규화) → 화제도에 합성. 신호량이
  늘수록 가중치 비중↑(0이면 화제도 100%). **탐색 주입엔 미적용** — 관심없음 장르도 노출을
  보존해 신호를 계속 받게 한다. 원문열기는 약한 보조신호, 이유 텍스트는 저장만(추후 활용).
- **대시보드:** 어떤 장르를 실제로 여는지(클릭) vs 수집 분포. 클릭이 진짜 관심사를 드러낸다.
- **스케줄러:** node-cron, 도착시각/리드분은 설정에서 변경 가능(변경 시 cron 자동 재설치).

### 8장르
AI/LLM·에이전트 / 시스템·인프라·저수준 / 보안 / 논문·연구 / 언어·런타임·도구 / 웹·프론트 /
제품·창업·회고 / 기타

---

## 소스 메모

기본 소스: Hacker News(API), r/programming, r/MachineLearning, Rust 블로그, Go 블로그,
arXiv cs.AI, arXiv cs.SE. 설정 화면에서 추가/삭제/켜고끄기 가능.

- **Reddit**은 데이터센터/클라우드 IP에서 `.json` 요청을 자주 **403** 차단한다. 가정용 IP(개인 PC)에서는
  대개 동작한다. 한 소스가 실패해도 전체 수집은 멈추지 않는다(소스별 격리).
- 새 RSS 추가는 설정 → 소스 추가에서 피드 URL을 넣으면 된다.

---

## API (요약)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/login` | 패스코드 → JWT |
| GET | `/api/briefing` | 최신 브리핑 |
| GET | `/api/briefings` | 브리핑 목록 |
| POST | `/api/read` | 원문열기 기록(보조신호) |
| POST | `/api/feedback` | 좋아요/관심없음(+이유) 기록·토글(주신호) |
| GET | `/api/dashboard` | 장르별 클릭/수집 집계 |
| GET·PUT | `/api/config` | 도착시각·리드·더보기수·타임존 |
| GET·POST·PUT·DELETE | `/api/sources` | 소스 CRUD |
| GET | `/api/push/key` | VAPID 공개키 |
| POST | `/api/push/subscribe` | 푸시 구독 등록 |

`/api/login` 외 모든 경로는 `Authorization: Bearer <token>` 필요.

---

## 배포 (별도 — 나중에)
Fly.io 상시 백엔드 + SQLite 볼륨 + secrets 등록, HTTPS 도메인, 실기기 푸시 권한.
(로컬 구동분과 분리된 후속 단계.)

## 다음 (데이터 쌓인 뒤)
좋아요/관심없음 → 장르 취향 가중치 → 랭킹 합성은 **v1에서 구현**. 남은 것:
이유 텍스트를 LLM으로 키워드·장르 추출, 산문 프로필 환원, `interests` 캐시 활용.
