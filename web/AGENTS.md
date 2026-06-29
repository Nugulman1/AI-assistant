# web/ — SvelteKit PWA 프론트엔드

부모(`/AGENTS.md`) 규칙 상속.

## 라우트 구조
```
src/routes/
  +page.svelte        — 브리핑 메인(필독 + 더보기)
  +layout.svelte      — JWT 체크, 글로벌 네비
  login/+page.svelte  — 패스코드 입력
  dashboard/          — 읽음·피드백 통계
  best/               — HN 기간별 베스트 탭(week/month/year)
  settings/           — 소스·알림·도착시각 설정
```

## 핵심 lib 파일
- `src/lib/store.js` — Svelte writable 스토어 (briefing, token 등)
- `src/lib/api.js` — fetch 래퍼, Authorization 헤더 자동 주입
- `src/lib/push.js` — Web Push 구독 로직
- `static/push-sw.js` — Service Worker (백그라운드 푸시 수신)

## 패턴
- 모든 API 호출은 `src/lib/api.js`의 래퍼 경유 (토큰 관리 일원화).
- `+layout.js`에서 토큰 없으면 `/login`으로 리다이렉트. 로직 중복 금지.
- `best/` 탭은 메인 브리핑 스토어와 분리된 별도 fetch. `best_items`와 `items` API 경로가 다름.

## 빌드
`npm -w web run build` → `web/build/`. server가 프로덕션에서 이 정적 파일을 서빙.
개발 시에는 vite dev server(5173)와 server(3001)가 별도 기동.
