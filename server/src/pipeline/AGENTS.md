# pipeline/ — 수집 후처리 단계

부모(`/AGENTS.md`) 규칙 상속. 여기서는 이 디렉터리에만 해당하는 것만 적는다.

## 단계 순서 (briefing.ts 기준)
1. `dedup.ts` — seen 제외 + 48h 컷 + URL 중복 병합
2. `normalize.ts` — 소스별 topicality z-정규화 (HN·RSS·Reddit 점수 스케일 균등화)
3. `rank.ts` — topicality + genre 가중치 → 필독3 / 더보기N 선정
4. `interest.ts` — read_events·feedback 집계 → 장르별 가중치 계산 (rank 인풋)

## 불변조건
- `dedup`의 `maxAgeDays=2` 값은 수집창 정책의 핵심. 바꾸면 필독후보 급감 또는 오래된 글 재등장.
- `rank`는 `candidate_pool` 전체(아직 summary 없는 것 포함)에 적용. 요약은 선정 후에만.
- 필독 최대 3건, 더보기 최대 `config.more_count`(기본 7). 이 경계를 pipeline에서 직접 조정하지 말 것 — routes의 `loadMore`와 정합성 깨짐.

## 테스트
`__tests__/interest.test.ts`, `__tests__/rank.test.ts` — 실제 계산값 검증. 기대값은 손수 계산한 것으로 둬야 함(코드 출력 복붙 금지).
