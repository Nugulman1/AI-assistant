# loadMore 버그 수정 보고서

## 아젠다 원문
> "다음 글 불러오기 수정 — 처음 누를때부터 갱신이 안 됨"

## 합격 기준 (박제된 테스트)
1. `POST /api/briefing/:id/more`에서 내부 오류 발생 시 → `500 + JSON {error: string}` 반환 (기준1 → PASS)
2. `candidate_pool` 비면 `{items:[], exhausted:true}` 반환 (기준2 → 기존 GREEN, 회귀가드)

---

## 발견된 버그

### 핵심 버그 (첫 클릭 무반응 원인)
`+page.svelte`의 `loadMore()` catch 블록이 전역 `error` 상태를 설정 → 템플릿의 `{:else if error}` 분기 발동 → 브리핑 뷰 전체가 작은 빨간 오류 메시지로 교체됨. 사용자가 화면 위쪽을 보지 않으면 "반응 없음"처럼 느껴짐.

### 2차 버그 (코드 리뷰에서 발견)
- `routes.ts` try 블록이 `cfg.more_count` 접근보다 늦게 시작 → config 행 없으면 catch가 못 잡음
- `(e as Error).message` 타입 캐스트 불안전 → non-Error throw 시 `error` 키가 JSON에서 누락됨
- `load()` 재호출 시 `moreError` 미초기화 → 잔존 오류 메시지 노출

---

## 변경 파일

### `server/src/routes.ts`
- try 블록을 `cfg` 접근 포함하도록 확장
- `(e as Error).message` → `e instanceof Error ? e.message : String(e)` (타입 안전)
- 에러 응답에서 클라이언트가 읽지 않는 `items:[], exhausted:false` 제거

### `web/src/routes/+page.svelte`
- `moreError` 상태 변수 추가 (전역 `error`와 분리)
- `loadMore()` catch → `moreError = e instanceof Error ? e.message : String(e)`
- `load()` 재호출 시 `moreError = ''` 초기화 추가
- `exhausted` 시 버튼 → 명시적 안내 메시지로 교체
- `moreError` 발생 시 버튼 근처에만 표시 (브리핑 뷰 유지)

### `server/src/routes/__tests__/more-route.test.ts` (테스트)
- 에러 응답 shape을 `{error: string}`으로 업데이트 (items/exhausted 제거 반영)

---

## 테스트 결과

```
Test Files  5 passed (5)
     Tests  17 passed (17)
```

---

## LLM이 대신 내린 설계 결정

| 결정 | 이유 | 대안 |
|---|---|---|
| 에러 응답에서 `items:[], exhausted:false` 제거 | `api.js:18`이 `!res.ok`이면 즉시 throw → 클라이언트가 절대 읽지 않는 필드. 있으면 계약이 있는 것처럼 오해 유발 | 유지: 미래 클라이언트 확장을 위해 남길 수도 있음 |
| `exhausted` 시 버튼 숨기고 텍스트 안내로 교체 | 비활성 버튼보다 명시적 메시지가 소진 여부를 더 분명히 전달 | 버튼 유지 + disabled + 안내 텍스트를 버튼 아래에 추가 |
| B2(영구 장애 시 버튼 무한 활성) 미수정 | transient vs permanent 오류 구분은 서버 인프라 변경이 필요하고 이번 범위 초과 | 향후: 서버가 `permanent: true` 필드 추가 → 클라이언트가 버튼 비활성화 |
