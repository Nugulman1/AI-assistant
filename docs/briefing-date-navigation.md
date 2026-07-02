# 과거 브리핑 날짜 이동 기능 — auto-loop 보고서

## 아젠다

**원문**: 하루 놓친 브리핑을 API로 직접 꺼내 보면 읽음/피드백 기록이 안 남아 추천 알고리즘 학습 데이터가 유실됨 — 앱 안에서 날짜를 지정해 과거 브리핑을 열람할 수 있게 한다.

**재진술**: 메인 화면에 ← 이전/다음 → 날짜 이동 UI를 붙여 과거 브리핑을 앱 안에서 열람 가능하게 하고, 과거 브리핑에서도 읽음/북마크/피드백이 정상 기록되게 한다.

## 합격 기준 (박제 테스트)

| 기준 | 박제 | 상태 |
|---|---|---|
| `GET /api/briefing/by-date/:date` 계약 5건 (200 뷰/같은날짜 최신/404/400/401) | `server/src/routes/__tests__/briefing-by-date.test.ts` | ✅ 6/6 |
| `/api/briefings` 목록 첫 항목 = `/api/briefing` 최신 (정렬키 통일) | `server/src/routes/__tests__/briefings-order.test.ts` | ✅ 1/1 |
| 갱신(더보기)은 최신 브리핑 전용 — 과거 id는 409, pool 미소비 | `server/src/routes/__tests__/more-latest-guard.test.ts` | ✅ 2/2 |
| UI 날짜 이동 | 테스트 부적합 → 빌드 성공 + 정적 리뷰로 대체, 실기동 확인은 사람 몫(아래 위험지점) | ⚠️ 부분 |

최종: **서버 테스트 49/49 통과, 웹 빌드 성공** (2026-07-02).

## 한 일 / 변경 파일

- `server/src/routes.ts` — ① 신규 `GET /api/briefing/by-date/:date`(YYYY-MM-DD 검증→400, 없으면 404, 같은 날짜 복수면 id 최대, `getBriefingView` 재사용, `:id` 라우트보다 선등록). ② `/api/briefings` 정렬을 `created_at DESC, id DESC`로 통일. ③ `POST /briefing/:id/more`에 최신 브리핑 전용 가드(아니면 409).
- `web/src/lib/api.js` — `briefingByDate(date)` 추가.
- `web/src/routes/+page.svelte` — ← 이전/다음 → 버튼(존재하는 브리핑 날짜만 순회, 경계 비활성), "지난 브리핑" 뱃지, 날짜 전환 시 상태 리셋, `loadMore`의 await 후 stale 반영 가드, 과거 브리핑에서 갱신 버튼 숨김.
- 테스트 3파일 신규 + `more-route.test.ts` 전제 적응(아래 결정 #11).

## LLM이 사용자 대신 내린 결정 (전체)

1. **by-date 신규 라우트 추가** — 프론트 목록 매핑 대안은 RED 박제 불가·왕복 2회라 기각. **[후기 — 메타리뷰 2026-07-02]** 결정 #7(← / → 순회)로 UI가 목록을 어차피 받게 되면서 실제 이동은 목록+id 조회(`briefingById`)로 구현됨 — **by-date 라우트·`api.briefingByDate`는 프론트 미사용(죽은 코드)**. 같은 날짜 중복 시 by-date는 최신 1건만 반환해 순회 키로 부적합(+page.svelte:48 주석 참고). 연결할지 삭제할지는 미결(아래 범위밖 참고).
2. **최대 반복 기본 3회** — 사용자 미지정.
3. **같은 날짜 복수 브리핑 → id 최대(최신) 반환** — arrival_date 유니크 제약 없음(재수집 가능).
4. ~~과거 브리핑 더보기 = 현재 pool 서빙 유지~~ → **#10으로 번복됨**.
5. **stale 버그(시계역행)는 수정 범위 밖** — by-date는 arrival_date 조회라 영향권 밖 확인.
6. **박제 테스트 주석 부정확 미수정** — trust-gate 통과 후 테스트 파일 무변경 원칙 우선(코스메틱).
7. **UI는 date picker 대신 ← / → 순회** — 브리핑 없는 날짜 dead-end 원천 차단.
8. **같은 날짜 중복 시 "지난 브리핑" 뱃지 중복 노출은 의도된 동작으로 기각** — 대체된 브리핑이 맞음.
9. **레드팀 수정 2건(정렬 통일·stale 가드)은 메인 직접 수정** — 몇 줄 규모라 위임 오버헤드가 더 큼.
10. **결정 #4 번복: 과거 브리핑 갱신 서버 차단(409) + 프론트 버튼 숨김** — 레드팀 재현으로 실피해 입증: 오늘 후보가 과거 more_json에 영구 부착(역사 오염) + 오늘 브리핑 몫 소진(pool 도둑질). candidate_pool이 최신 수집 run 소유의 전역 대기열인데 briefing_id 컬럼이 없는 게 근본 원인 — 이번엔 차단으로 해결, 풀 스키마 변경은 범위 밖.
11. **`more-route.test.ts` 전제 적응** — 가드 선행으로 "아무 id나 loadMore 도달" 전제가 깨짐. 검증 의도(loadMore throw → 500 + {error})는 불변, 최신 브리핑을 시드해 그 id로 호출하도록만 수정. 기준 완화 아님.
12. **레드팀 3라운드 생략** — 잔여 표면은 계약 테스트로 잠기고 프론트 실수는 서버 409로 격하되는 2중 방어. 유효 공격 소진 판단.

## 레드팀 공격 판정 요약

| 라운드 | 공격 | 판정 | 처치 |
|---|---|---|---|
| 1 | loadMore in-flight 중 날짜 이동 → 화면 오염 | 진짜(정적 확정) | target 캡처 + stale 폐기 가드 |
| 1 | 시계역행 시 목록·최신 정렬키 불일치 → 뱃지/버튼 오표기 | 진짜(재현) | 정렬키 통일 + 회귀 테스트 |
| 1 | 같은 날짜 중복 시 뱃지 혼란 | 기각 | 의도된 동작 (#8) |
| 2 | 과거 브리핑 갱신 → 오늘 pool 도둑질·역사 오염 | 진짜(RED 재현) | 서버 409 가드 + 버튼 숨김 + 테스트 2건 |
| 2 | stale 폐기 후 재조회 전까지 화면 임시 누락 | 기각(수용) | 영구 손실 없음·자가 복원, 수정 시 중복 append 리스크가 더 큼 |

## 범위밖 / 미해결 (완료와 구분)

- **created_at DESC 시계역행 stale 버그 자체** — 기존 미해결(docs/read-bookmark-status-feature.md). 이번엔 nav와의 상호작용만 방어(정렬 통일), 근본 수정 안 함.
- **candidate_pool에 briefing_id 없음** — 근본 원인은 남음. 갱신을 최신 전용으로 차단해 증상 경로를 봉쇄했을 뿐. 풀 스키마 변경 시 [[db-migration-pattern]] 규율 필요.
- **`/api/briefing/:id`의 비숫자 id → 최신 브리핑 200 반환 quirk** — 기존 동작, 이번 변경과 무관(레드팀 1라운드 참고 지적).
- **by-date 라우트 미사용(죽은 코드)** — 결정 #1 후기 참고. 서버 계약·테스트 6건은 GREEN이나 배포 UI가 안 쓰는 경로. 실제 이동 로직(목록 순회+`briefingById`)은 서버 테스트 커버리지 없음(실기동 확인으로 대체, 아래 위험지점 #1). 연결/삭제는 사람 결정 대기.

## ⚠️ 사람 확인 권장 — 위험지점

- [x] **UI 실기동 미검증** — 날짜 이동·뱃지·가드는 빌드 성공+정적 리뷰뿐, 브라우저 조작 확인 없음. 배포 후 앱에서 ← 이전 눌러 어제 브리핑 열람·읽음 기록·과거에서 갱신 버튼 숨김을 직접 확인 필요. — 사후 판정: ☐ 진짜 문제 ☑ 허위경보 (2026-07-02 로컬 3일치 시드로 사람이 실기동 확인 완료)
- [ ] **loadMore stale 폐기의 transient gap(2라운드 [2])** — 더보기 응답 중 이동 후 복귀하면 승격분이 재조회 전까지 화면에서 누락(reload로 복원). 수용했으나 실사용에서 거슬리면 재설계. — 사후 판정: ☐ 진짜 문제 ☐ 허위경보
- [ ] **수집 파이프라인 전 구간 실증 없음** — 테스트 입력의 도달가능성은 정적 판정(localDate의 en-CA 포맷 = YYYY-MM-DD)으로만 확인. 실 수집 run 후 by-date 조회가 정상인지 프로덕션에서 1회 확인. — 사후 판정: ☐ 진짜 문제 ☐ 허위경보

## 실행 메트릭

```yaml
auto_loop_run:
  run_id: 2026-07-02-briefing-date-navigation
  agenda: 메인 화면 날짜 이동으로 과거 브리핑 열람 — 읽음/피드백 기록 유실 방지
  rejections: 3
  fix_loops: 2
  redteam_attacks: 5
  redteam_false_positives: 2
  human_interventions: 0
  pending_human_reviews: 3
  token_cost: 357526  # 서브에이전트 6기 하네스 집계 합. 메인 루프分 미포함(하네스 미노출)
  iterations_used: 2
  max_iterations: 3
  commit_trailer: "auto-loop-run: 2026-07-02-briefing-date-navigation"
  followup_defects: TBD
```
