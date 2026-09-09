# dev-news — 코드 지도

서버 없음. `sources.json` → `npm run collect` → `docs/data/items.json` → `docs/index.html`(Pages) / `npm run news`(CLI).

| 작업 | 파일 |
|---|---|
| items.json 스키마(세 곳의 계약) | `src/items.ts` |
| 소스 추가·임계값 | `sources.json`, 타입별 어댑터 `src/sources/{hn,lobsters,hf-papers,rss}.ts` |
| fetch 공통(UA·타임아웃·48h 창·재시도) | `src/sources/http.ts` — index.ts 와 분리(순환 import 방지) |
| URL 정규화·교차소스 병합 | `src/merge.ts` |
| 기존 목록 반영·7일 컷·정렬 | `src/collect.ts` `applyToExisting` |
| 터미널 목록·dig | `src/cli/news.ts` (dig 산출물 `dig/`는 gitignore) |
| 수집 스케줄(KST 06·18시) | `.github/workflows/collect.yml` — items.json 만 스테이징해 커밋 |

## 불변조건
- 병합 키는 정규화 URL, 보조로 제목키. 기존 항목과 제목키로 맞으면 **기존 id 유지**(페이지 별표 키 안정성).
- 4층 문지기(키워드·취향·AI)는 두지 않는다. 양 조절은 `sources.json` 의 `minPoints` 하나.
