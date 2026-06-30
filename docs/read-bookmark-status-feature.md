# 읽음 / 북마크 / 나중에 읽기 — 상태관리 기능

> auto-loop 자율주행 산출 보고서. run-id: `2026-06-30-read-bookmark-status`

## 아젠다

- **원문**: "읽음/북마크/나중에 읽기 — 완성 브리핑인데 상태 관리가 없으면 매번 다시 훑어야 함. 읽음 처리 + 별도 저장." (1순위 핵심가치 강화 중 상태관리 항목)
- **재진술**: 브리핑 글에 **읽음 처리**(읽은 글 구분)와 **북마크/나중에 읽기**(48h 창과 무관하게 영구 보관·회수)를 추가한다.

## 합격 기준 (= 박제한 테스트)

백엔드는 RED 테스트로 박제(`server/src/routes/__tests__/item-status.test.ts`, AC1~AC9). 프런트 UI는 컴포넌트 테스트 인프라가 없어 **빌드 성공 + 기존 패턴 일관성 + 메인 직접 재현**으로 검증.

| AC | 합격 기준 |
|----|----------|
| AC1 | `item_status` 테이블 존재 |
| AC2 | POST `/api/status` `{isRead:true}` → `state.isRead=true`, DB `is_read=1` |
| AC3 | `{isBookmarked:true}` → `state.isBookmarked=true` |
| AC4 | 부분 업데이트: 보낸 필드만 변경, 나머지 유지 |
| AC5 | 토글 오프: `{isRead:false}` → `is_read=0` |
| AC6 | GET `/api/briefing` 각 item에 `isRead`/`isBookmarked` 불리언(기본 false) |
| AC7 | POST `/api/read` → `read_events` + `item_status.is_read=1` (원문 클릭 자동 읽음) |
| AC8 | GET `/api/bookmarks` → 북마크 item 배열, **브리핑·48h 창 무관 영구 반환**, 해제분 제외 |
| AC9 | (회귀 방어) 북마크 정렬 = 북마크 시각순, **글을 읽어도 재정렬되지 않음** |

**최종 결과**: 박제 9/9 GREEN, 전체 40/40 GREEN, 프런트 빌드 성공. (메인이 직접 재실행해 현물 대조)

## 한 일 · 변경 파일

**백엔드 (`/server`)**
- `src/db.ts` — `item_status` 테이블 신설(`item_id` PK, `is_read`, `is_bookmarked`, `updated_at`, `bookmarked_at`) + **방어 마이그레이션**(구버전 테이블에 `bookmarked_at` 컬럼이 없으면 `ALTER TABLE ADD COLUMN`, idempotent).
- `src/routes.ts` — POST `/api/read`에 자동 읽음(`is_read=1`) 추가; POST `/api/status`(부분 업데이트 UPSERT, 불리언 타입 가드, 빈 전송 시 no-write); GET `/api/bookmarks`(`is_bookmarked=1` 전부, 창 필터 없음, 북마크 시각순 정렬 + `id` 타이브레이커). SPA fallback보다 먼저 등록.
- `src/briefing.ts` — `getBriefingView` SELECT에 `item_status` LEFT JOIN + `isRead`/`isBookmarked` 노출; `loadMore` 승격 item 기본 false; 최신 브리핑 선택 정렬 `id DESC` → `created_at DESC, id DESC`.

**프런트 (`/web`)**
- `src/lib/api.js` — `updateStatus(itemId, {isRead?, isBookmarked?})`, `bookmarks()`.
- `src/routes/+page.svelte` — 원문 클릭 자동 읽음 로컬 반영, 읽음/북마크 수동 토글 버튼, 읽은 글 dim + "읽은 글 숨기기" 토글.
- `src/routes/+layout.svelte` — '북마크' 탭 링크.
- `src/routes/bookmarks/+page.svelte` — 신규 북마크 모음 화면(해제 버튼, 영구 보관 안내).

**테스트**
- `src/routes/__tests__/item-status.test.ts` — AC1~AC9 박제(신규).

## LLM이 사용자 대신 내린 설계·결정

| # | 결정 | 이유 / 대안 |
|---|------|------------|
| D1 | read 모델 = **binary(읽음/안읽음)** | 'reading' 중간상태는 과설계. 사용자 요구는 "읽음 처리"뿐 |
| D2 | **별도 `item_status` 테이블** (feedback 확장 아님) | 읽음/북마크는 like/dislike와 직교. 글은 피드백 없이도 읽힘 |
| D3 | 읽음 트리거 = **원문 클릭 자동 + 수동 토글** | 사용자 선택. 기존 `/api/read` 클릭 신호와 자연 연결 |
| D4 | 읽은 글 = **dim + 숨김 토글**, 북마크 = **별도 탭** | 사용자 선택 |
| D5 | 응답 envelope = `{state:{...}}`, `{bookmarks:[...]}` | 스펙엔 필드명만 있어 wrapper는 LLM이 확정 |
| D6 | 최신 브리핑 선택을 **`created_at DESC`**로 변경 | "최신=가장 최근 도착"의 정직한 정의. 박제 AC6/AC7의 cross-briefing 시드(옛 created_at·큰 id)가 `id DESC`로는 오선택됨. ⚠️ 아래 위험지점 참고 |
| D7 | 북마크 정렬키 = **별도 `bookmarked_at`** (`updated_at` 겸용 폐기) | 레드팀 [1] 수정. 읽기로 목록이 재정렬되는 버그 차단 |
| D8 | 재북마크 시 `bookmarked_at` = **0→1 전환 때만** 기록(이미 1이면 유지) | "다시 누름"은 보통 멱등 클릭 → 의외성 적은 쪽 |
| D9 | 비불리언 입력(`null`/문자열)은 **"변경 안 함"**으로 처리(`typeof boolean` 가드) | 레드팀 [2] 수정. 부분 업데이트 계약 보호 |
| D10 | **3차 레드팀 생략** | 2차 수정 표면이 사소·결정적이고 메인이 직접 재현/이빨확인 완료, 핵심 경로는 1·2차로 충분히 검증 |

## 적대 검증 (레드팀 2라운드)

- **1차**: 4건 제기 → [1] 북마크 재정렬(읽기로 순서 뒤집힘, UI 도달), [2] null/문자열 부분업데이트 깨짐, [4] 빈 잡행 = **메인 직접 재현 확정 → 수정**. [3] 시계역행 = **기각(거짓양성)**.
- **2차** (수정분 한정): 3건 제기 → [1] 마이그레이션 갭(구버전 테이블 500), [2] 정렬 회귀 방어 부재, [3] 동률 ms 정렬키 부재 = **수정**. 모두 메인 직접 재현/이빨확인.

각 수정은 메인이 실제 라우트(`buildApp` + `app.request`)로 독립 재현해 판정했고, AC9는 정렬을 일부러 `updated_at`으로 되돌려 RED가 되는지(이빨)까지 확인 후 복원.

---

### (a) ⚠️ 사람 확인 권장 — 위험지점

- [ ] **시계 역행 시 stale 브리핑 노출** — `getBriefingView`가 `created_at DESC`로 최신을 고른다(D6). NTP 보정 등으로 서버 시각이 뒤로 점프한 직후 생성된 브리핑은 `created_at`이 더 작아 '최신'에서 밀려 옛 브리핑이 노출될 수 있다. 기존 `id DESC`(삽입순)는 이 회귀가 없었다. 빈도 극히 낮아 거짓양성으로 기각했으나 비가역 노출이라 잔여 위험. — 사후 판정: ☐ 진짜 문제  ☐ 허위경보
- [ ] **`created_at` 기반 '최신' 정의가 박제 테스트의 인위 시드에 유도됨** — AC8 cross-briefing이 '옛 created_at + 큰 id'를 동시에 부여한 탓에 정렬 설계가 바뀌었다. 운영에서 id와 created_at은 단조동행이라 무해하나, 테스트가 프로덕션 설계를 끈 사례. — 사후 판정: ☐ 진짜 문제  ☐ 허위경보
- [ ] **프런트 UI 동작 미검증** — 토글 반영·dim·탭 전환·북마크 해제 후 목록 갱신은 컴포넌트 테스트 없이 빌드 성공 + 패턴 일관성으로만 확인. 실제 브라우저 동작은 `/verify` 또는 수동 확인 필요. — 사후 판정: ☐ 진짜 문제  ☐ 허위경보

### (b) 실행 메트릭 블록

```yaml
auto_loop_run:
  run_id: 2026-06-30-read-bookmark-status
  agenda: 브리핑 글에 읽음 처리 + 북마크(영구 보관) 상태관리 추가
  # --- 과정 메트릭 (계기판, 핸들 아님) ---
  rejections: 3              # trust-gate FAIL 1 + 레드팀 유효공격으로 5단계 회귀 2
  fix_loops: 2               # 6단계 공격→수정 반복 (1차·2차)
  redteam_attacks: 7         # 1차 4 + 2차 3
  redteam_false_positives: 1 # 1차 [3] 시계역행 기각 (fp율 = 1/7 ≈ 0.14)
  human_interventions: 0     # 사람확인필요로 뺀 항목/자율중단 없음(위험지점은 사후체크로 분리)
  iterations_used: 2         # fix loop 2 / 최대 5
  max_iterations: 5
  # --- 북극성 훅 ---
  commit_trailer: "auto-loop-run: 2026-06-30-read-bookmark-status"
  followup_defects: TBD
```
