# sources/ — 소스별 수집기

부모(`/AGENTS.md`) 규칙 상속.

## 소스 타입 매핑
| 파일 | DB `sources.type` | 비고 |
|------|-------------------|------|
| `hackernews.ts` | `hackernews` | HN API, `top`/`new`/`best` |
| `hn-best.ts` | — | best_items 전용 (week/month/year), 메인 파이프라인과 완전 분리 |
| `rss.ts` | `rss` | Atom·RSS2 공용 |
| `reddit.ts` | `reddit` | 현재 비활성(403). OAuth API 전환 전 사용 금지 |
| `fulltext.ts` | — | URL → 본문 크롤러, `loadMore` lazy 요약에서 호출 |
| `text.ts` | — | HTML 파싱 유틸 |
| `index.ts` | — | `collectAll()` 진입점, 소스별 격리 (하나 실패해도 전체 안 죽음) |

## 패턴
- **격리 원칙**: `collectAll`의 각 소스는 try/catch로 감싸 독립 실패. 새 소스 추가 시 동일하게.
- `fulltext.ts`는 `loadMore` 경로에서만 호출. 수집 시점에는 크롤링 안 함(비용·속도).
- `hn-best.ts`가 반환하는 `BestPeriod = 'week' | 'month' | 'year'`는 `best_items` 테이블 `period` 컬럼과 1:1 매핑. 통째 교체(기존 period 행 DELETE 후 INSERT).

## Anti-Patterns
- 새 소스를 `DEFAULT_SOURCES`(`db.ts`)에 추가하면 기존 DB에 자동 반영 안 됨 — 시드는 행이 0일 때만. 기존 배포에는 마이그레이션 INSERT 별도 필요.
