# HN 기간별 베스트 (주/월/년) — 구현 보고서

## 아젠다

- **원문**: "HN Best, 주간/월간/년간 베스트 등 같이 현재 수집보다 날짜가 좀 전에 있어도 유명했던 글들도 수집하고싶어"
- **재진술**: 48h 메인 브리핑("지금 화제")이 구조적으로 못 보는 **기간 지난 양질의 옛글**을, HN을 주/월/년 창에서 점수 상위로 별도 수집해 **별도 탭**으로 보여준다.

## 핵심 문제 (한 줄)

현재 파이프라인은 `dedup.ts`가 2일(48h)보다 오래된 글을 무조건 컷한다 → "유명한 옛글"은 들어올 경로 자체가 없다. 베스트는 이 컷을 우회하는 **별도 수집·저장·조회 경로**가 필요하다.

## 의도 파악에서 사용자가 확정한 것

| 항목 | 결정 |
|---|---|
| 노출 방식 | **별도 탭/뷰로 분리** (메인 48h 브리핑과 안 섞음) |
| 수집 소스 | **HN만** (Reddit은 현재 403 비활성이라 제외) |
| 기간 | **주간/월간/년간 셋 다** |
| 최대 반복 | 5회 |

## 합격 기준 (= 박제한 RED 테스트)

`server/src/sources/__tests__/hn-best.test.ts` (5 케이스, 전부 GREEN):
1. `buildBestSearchUrl(period, nowSec)` — period별 cutoff(week=−604800s, month=−2592000s, year=−31536000s)가 박힌 Algolia URL, raw `>`, `tags=story`, `hitsPerPage=50`.
2. `parseBestStories(json, limit)` — title-null 제외, points 내림차순(null→0), limit 컷, HN 토론 url·externalUrl 원문·createdAt=초×1000 매핑.

`test-trust-gate`로 세 축(RED-before-impl / 합격기준 일치 / 기대값 독립성) 모두 PASS 확인 후 구현.

## 한 일 / 변경 파일

**신규**
- `server/src/sources/hn-best.ts` — URL 빌드 + Algolia 파싱(순수함수) + fetch 래퍼
- `server/src/best.ts` — 주/월/년 수집·저장(period별 통째 교체)·조회 오케스트레이션
- `server/src/sources/__tests__/hn-best.test.ts` — 박제 테스트
- `web/src/routes/best/+page.svelte` — 베스트 탭(주/월/년 토글)

**수정**
- `server/src/db.ts` — `best_items` 테이블 + 인덱스 + `BestItemRow` 타입
- `server/src/routes.ts` — `GET /api/best?period=week|month|year`
- `server/src/scheduler.ts` / `server/src/scripts/run-once.ts` — 수집 시점에 `collectAndStoreBest` 배선
- `web/src/lib/api.js` / `web/src/routes/+layout.svelte` — API 메서드 + 내비 링크

## 최종 검증 결과

- 서버 타입체크 통과, vitest **15/15 통과**, 웹 빌드 통과(베스트 라우트 포함).
- **현물 검증(실네트워크)**: 임시 DB로 `collectAndStoreBest` 실행 → 주/월/년 각 30건 수집, points 내림차순 불변식 OK. year 1~3위 ▲4229/3521/3406, week<month<year 점수 스케일이 누적 화제도에 부합. 데이터센터 IP에서 Algolia 정상 동작.

## LLM이 사용자 대신 내린 설계·결정 (무엇을·왜·대안)

1. **별도 `best_items` 테이블 (vs `items` 재사용)** — `items`는 48h 파이프라인·`seen`·`feedback`·대시보드 전용이라 베스트를 섞으면 통계가 오염된다. `candidate_pool`과 같은 "period별 통째 교체" 패턴으로 격리.
2. **별도 모듈 `hn-best.ts` (vs `hackernews.ts` 확장)** — 기존 어댑터는 `front_page` 태그·시간필터 없음. 안정된 코드를 건드리지 않고 분리.
3. **베스트는 요약 없이 메타데이터 리스트 (vs Sonnet 요약)** — 비용·범위가 커진다. v1은 제목+점수+링크만. (요약은 후속 여지.)
4. **수집 시점에 `generateBriefing`과 나란히 호출 (vs 별도 cron)** — 단순. 베스트 수집은 `try/catch`로 격리해 실패해도 메인 브리핑·다른 기간에 영향 없음. 하루 1회라 과빈도 아님.
5. **Algolia 정렬을 코드로 확정** — `/search` 빈쿼리 기본 랭킹이 points 우선(HN 인덱스 customRanking)이지만 보장에 의존하지 않고 `parseBestStories`에서 points 재정렬. 실측으로 기본 랭킹=points 우선 확인됨(year top이 내림차순 고점).
6. **기간별 보관 30건, `hitsPerPage=50`** — 50건 중 상위 30 추출로 안전마진. (year 윈도우가 커도 customRanking이 고점을 앞에 모음.)

### code-review에서 잡아 수정한 것
- **버그**: 수집 성공이지만 빈 결과(200+빈 hits)면 `DELETE` 후 0건 INSERT로 기존 베스트를 날리던 문제 → 빈 결과면 교체 건너뛰고 `ok:false`.
- **버그**: 웹 탭 빠른 전환 시 stale 응답이 최신을 덮어쓰는 레이스 → 세대 토큰(`reqId`) 가드.
- **cleanup**: `best_items`에 저장도 안 되는 죽은 `body`/`story_text`/`extractText` 제거.

### 의식적으로 보류한 것 (트레이드오프)
- **AlgoliaHit 타입·매핑 중복 통합 안 함** — 안정된 `hackernews.ts`를 건드리는 회귀 위험 > 중복 제거 이득. 두 매핑은 필드 시맨틱(`score`↔`points`, source 메타 유무)이 달라 억지 통합은 altitude 악화.

### 사람 확인 권장
- 빈 결과 가드·웹 레이스 가드는 통합/UI 동작이라 단위 테스트로 박지 않음(분기 자명). 운영 중 베스트가 빈 화면으로 회귀하지 않는지만 한 번 눈으로 확인 권장.
