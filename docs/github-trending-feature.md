# GitHub 트렌딩 별도 탭 — 구현 보고서

> auto-loop 자율주행 산출. run-id: `2026-06-30-github-trending`

## 아젠다
- **원문:** "프로그램에 깃허브 트렌드도 같이 넣을까"
- **재진술:** github.com/trending을 수집해 기간(일/주/월)별 리포 랭킹을 보여주는 **별도 탭**을 추가한다. HN Best와 동일하게 48h 메인 브리핑 파이프라인과 **완전 격리**(스크래핑이 깨져도 브리핑은 무사).

## 합격 기준 (박제 테스트로 고정)
| # | 기준 | 검증 방식 | 결과 |
|---|------|----------|------|
| 1 | 파서가 실제 github.com/trending HTML에서 name/url/description/language/stars/periodStars 추출, 깨진/빈 HTML은 빈 배열 | `github-trending.test.ts` (5케이스, 실 라이브 HTML 픽스처) | GREEN |
| 2 | period(daily/weekly/monthly)별 통째 교체 저장 + 격리 조회 | `github-best.test.ts` (3) + `github-best-isolation.test.ts` (2) | GREEN |
| 3 | `GET /api/github-trending?period=` period별 JSON, invalid→daily 폴백 | `github-trending-route.test.ts` (4) | GREEN |
| 4 | 프론트 GitHub 탭 (테스트 불가 → 빌드 성공 + 사람 확인) | `npm -w web run build` exit 0 | PASS |

**최종 테스트:** `npm -w server test` → **31 passed (9 files), exit 0** · `typecheck` exit 0 · `web build` exit 0. (메인이 직접 재실행해 자기보고 아닌 현물로 대조함.)

## 한 일 / 변경 파일
**신규**
- `server/src/sources/github-trending.ts` — `parseGithubTrending(html)` (jsdom DOM 파싱, 셀렉터 기반 일반해), `fetchTrending(period)` (라이브 글루, try/catch→[])
- `server/src/github-best.ts` — `storeTrending`/`getTrendingStored`(`db?` 주입)/`collectAndStoreTrending`
- `web/src/routes/github/+page.svelte` — 일/주/월 탭
- 테스트 3 + 격리 테스트 1

**수정**
- `server/src/db.ts` — `github_trending` 테이블+인덱스
- `server/src/routes.ts` — `GET /api/github-trending` (api 그룹 = SPA fallback보다 먼저 매칭)
- `server/src/scheduler.ts` — `collectAndStoreTrending` 독립 try/catch 잡 (브리핑과 분리)
- `server/src/scripts/run-once.ts` — 트렌딩 수집 합류
- `web/src/lib/api.js` — `githubTrending(period)`
- `web/src/routes/+layout.svelte` — "GitHub" 네비 탭

## LLM이 사용자 대신 내린 설계·결정 (무엇을·왜·대안)
1. **기간 단위 = daily/weekly/monthly** (HN Best의 week/month/year 대신). 왜: github.com/trending URL이 `?since=daily|weekly|monthly`라 자연. 대안(week/month/year)은 GitHub URL과 불일치.
2. **`storeTrending`에 선택적 `db?` 마지막 인자** (best.ts는 `getDb()` 싱글턴). 왜: in-memory 테스트 주입. 생략 시 기존과 동일 동작. best.ts와의 유일한 의도적 차이.
3. **저장 모듈 파일명 `github-best.ts`** (best.ts 미러). `TrendingPeriod` 타입은 `github-trending.ts`에 정의하고 re-export.
4. **0건 가드를 데이터 레이어(`storeTrending`)로 내림** — 레드팀 발견 [1] 대응. 원래 가드는 호출부(`collectAndStoreTrending`)에만 있어 공개 `storeTrending([])`이 데이터를 날리는 footgun이었음. 빈 배열이면 DELETE 건너뛰고 기존 보존. 호출부의 가드는 로깅 위해 이중으로 남김. 왜: "스크래핑 깨져도 기존 유지"가 격리의 핵심이라 보장을 데이터 레이어에 둠. (이 수정은 가벼워 위임 없이 메인이 직접 함.)
5. **프론트 periodStars 라벨을 기간별 동적 문구** ("+N stars 오늘/이번 주/이번 달"). 명시 안 된 UI 세부, best 페이지 톤에 맞춤.
6. **레드팀 [2](격리 무테스트) → 새 파일 `github-best-isolation.test.ts`로 박음**. 박제 파일(github-best.test.ts)은 합격기준 불변식이라 건드리지 않고 별도 파일로 추가.

## 레드팀 공격 결과
- **제기 2건 / 거짓양성 0건.** [1] storeTrending 무가드 데이터 소실(latent, 현 경로 안전이나 footgun) → 가드로 수정. [2] 격리 경로 무테스트 → 격리 테스트로 박음.
- **공격했으나 견고(5):** 파서 라이브 견고성(실 curl 15 article 전부 파싱, 'owner/repo' 정규화, NaN 0), unhandled rejection 격리, 라우트 순서·SQL 인젝션(파라미터 바인딩), 메인 파이프라인 오염(별도 테이블, briefing.ts 미참조), 웹 빈값 처리.

---

## ⚠️ 사람 확인 권장 — 위험지점
- [ ] **라이브 수집 실동작 미검증** — `fetchTrending`/`collectAndStoreTrending`은 실네트워크 의존이라 단위테스트 범위 밖. 파서·저장·라우트만 테스트로 커버됨. 배포 후 `run:once` 또는 첫 스케줄 사이클에서 실제 수집·저장을 눈으로 확인 필요 — 사후 판정: ☐ 진짜 문제  ☐ 허위경보
- [ ] **비공식 스크래핑 취약성** — github.com/trending DOM 변경 시 파서가 0건 반환. 격리돼 브리핑은 무사하나 GitHub 탭이 빈 화면이 됨(기존 데이터는 보존). 주기적 동작 확인 권장 — 사후 판정: ☐ 진짜 문제  ☐ 허위경보
- [ ] **레드팀 [1] "현 경로 안전" 판정** — 공개 `storeTrending` footgun을 가드로 막았고 호출부 이중 가드도 유지. 향후 리팩터가 우회할 가능성은 가드로 차단했다고 봄 — 사후 판정: ☐ 진짜 문제  ☐ 허위경보

```yaml
auto_loop_run:
  run_id: 2026-06-30-github-trending
  agenda: "github.com/trending 기간별 리포를 HN Best식 별도 탭으로(48h 브리핑과 격리)"
  # --- 과정 메트릭 (계기판, 핸들 아님) ---
  rejections: 1                  # 레드팀 유효공격으로 5단계 회귀 1회(trust-gate FAIL 0)
  fix_loops: 1                   # 공격→수정 반복 1
  redteam_attacks: 2
  redteam_false_positives: 0     # 거짓양성률 0/2
  human_interventions: 1         # 라이브 수집 실동작을 '사람확인'으로 분리(중단 0)
  iterations_used: 1
  max_iterations: 5
  # --- 북극성 훅 ---
  commit_trailer: "auto-loop-run: 2026-06-30-github-trending"
  followup_defects: TBD
```
