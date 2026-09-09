# dev-news

권위 있는 개발 소스 15곳에서 하루 두 번 수집해 **제목 약 30건**을 정적 페이지로 보여주는 뉴스 훑기.
서버 없음. GitHub Actions 가 수집해 `docs/data/items.json` 을 커밋하고, GitHub Pages 가 `docs/` 를 서빙한다.

```
sources.json ─▶ npm run collect ─▶ docs/data/items.json ─▶ docs/index.html (폰에서 훑기·별표)
                                        └──▶ npm run news / news dig <id> (터미널에서 파기)
```

## 문지기 셋 (필터)

1. **소스 선정** — `sources.json` 의 15곳만. 저빈도 블로그는 거르지 않고 전부 통과.
2. **군중 점수** — HN 300점 이상, Lobsters 10점 이상, HF Papers upvotes 상위 5.
3. **교차소스 겹침** — 같은 글이 여러 소스에 뜨면 병합해 맨 위로.

마지막 선택은 사람이 30초 훑기로 한다. 취향 학습·AI 분류·요약은 두지 않는다.

## 쓰는 법

- **폰:** GitHub Pages URL 열기. 별표 찍고 "복사"로 id 목록을 가져온다.
- **터미널:**
  ```bash
  npm run news                 # 최근 2일치 목록 (번호·id)
  npm run news -- dig <id|번호>  # 원문 + HN 댓글을 dig/*.md 로 저장 → Claude Code 와 토의
  npm run news -- --remote     # git pull 없이 GitHub 의 최신 items.json 으로 목록
  ```
- **로컬 수집:** `npm run collect` (Actions 와 같은 스크립트).

## 소스 손보기

`sources.json` 한 파일. 양 조절은 `minPoints`(HN) 하나로 충분하다.
Anthropic 은 공식 RSS 가 없어 커뮤니티 피드에 의존한다. 끊기면 뉴스 페이지 파싱으로 대체.
