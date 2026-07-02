<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  let briefing = null;
  let loading = true;
  let error = '';
  let moreLoading = false;
  let exhausted = false;
  let moreError = '';
  let hideRead = false; // 켜면 읽은 글을 목록에서 접음

  // 과거 브리핑 이동용 — 목록은 id DESC(최신이 index 0)로 온다(server: /api/briefings).
  let briefingList = [];
  let navIndex = -1; // briefingList 안에서 현재 briefing의 위치. 못 찾으면 -1(이동 비활성).
  let navLoading = false;
  $: isLatest = navIndex === -1 || navIndex <= 0;
  $: isOldest = navIndex === -1 || navIndex >= briefingList.length - 1;

  async function load() {
    loading = true;
    error = '';
    moreError = '';
    exhausted = false;
    try {
      const { briefing: b } = await api.briefing();
      briefing = b;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
    await loadBriefingList();
  }

  // 이전/다음 이동 대상 날짜 목록. 실패해도 오늘 브리핑 표시엔 지장 없게 이동 버튼만 비활성.
  async function loadBriefingList() {
    try {
      const { briefings: list } = await api.briefings();
      briefingList = list;
      navIndex = briefing ? briefingList.findIndex((x) => x.id === briefing.id) : -1;
    } catch (_e) {
      briefingList = [];
      navIndex = -1;
    }
  }

  // 목록의 idx 번째 브리핑을 로드. id로 조회(briefingByDate 대신) — 목록이 이미 id를 갖고 있어
  // 날짜 문자열 왕복·재매칭 없이 바로 조회 가능하고, 같은 날짜 중복 브리핑이 있어도 정확히 그 항목을 짚는다.
  async function goToBriefing(idx) {
    if (navLoading || idx < 0 || idx >= briefingList.length) return;
    navLoading = true;
    error = '';
    moreError = '';
    exhausted = false;
    try {
      const { briefing: b } = await api.briefingById(briefingList[idx].id);
      briefing = b;
      navIndex = idx;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      navLoading = false;
    }
  }

  const goPrev = () => goToBriefing(navIndex + 1); // 목록은 최신이 먼저이므로 +1 = 더 과거
  const goNext = () => goToBriefing(navIndex - 1); // -1 = 더 최신

  // 갱신 — 풀의 다음 글들을 그때 요약해 더보기 아래에 한줄로 추가. 소진 시 비활성.
  async function loadMore() {
    if (!briefing || moreLoading || exhausted) return;
    const target = briefing; // await 중 날짜 이동으로 briefing이 교체될 수 있음
    moreLoading = true;
    moreError = '';
    try {
      const { items, exhausted: done } = await api.moreNext(target.id);
      // 응답 도착 시점에 다른 브리핑을 보고 있으면 화면 반영을 폐기 —
      // 서버는 이미 target.id로 기록했으므로 데이터 유실은 없다.
      if (briefing !== target) return;
      briefing.more = [...briefing.more, ...items];
      briefing = briefing; // 반응성 트리거
      if (done) exhausted = true;
    } catch (e) {
      if (briefing === target) {
        moreError = e instanceof Error ? e.message : String(e);
      }
    } finally {
      moreLoading = false;
    }
  }

  async function open(item) {
    // 읽기 기록(보조 학습 신호) 후 새 탭으로. 백엔드가 자동 읽음 처리 → 로컬도 반영.
    try {
      await api.read(item.id);
      item.isRead = true;
      briefing = briefing; // 반응성 트리거
    } catch (_e) {
      /* 기록 실패해도 링크는 열어줌 */
    }
    window.open(item.url, '_blank', 'noopener');
  }

  // 읽음 수동 토글
  async function toggleRead(item) {
    try {
      const { state } = await api.updateStatus(item.id, { isRead: !item.isRead });
      item.isRead = state.isRead;
      briefing = briefing; // 반응성 트리거
    } catch (_e) {
      /* 무시 */
    }
  }

  // 북마크 토글
  async function toggleBookmark(item) {
    try {
      const { state } = await api.updateStatus(item.id, { isBookmarked: !item.isBookmarked });
      item.isBookmarked = state.isBookmarked;
      briefing = briefing; // 반응성 트리거
    } catch (_e) {
      /* 무시 */
    }
  }

  const trimmed = (item) => (item._reason && item._reason.trim() ? item._reason.trim() : undefined);

  // 버튼 클릭: 이미 같은 방향이면 끄기(이유 무시), 아니면 켜기(현재 이유 첨부).
  async function vote(item, kind) {
    const turningOff = item.feedback === kind;
    const reason = turningOff ? undefined : trimmed(item); // 끄기는 이유 없이 보내 토글 오프
    try {
      const { state } = await api.feedback(item.id, kind, reason);
      item.feedback = state;
      if (state === null) item._reason = '';
      briefing = briefing; // 반응성 트리거
    } catch (_e) {
      /* 무시 */
    }
  }

  function toggleReason(item) {
    item._reasonOpen = !item._reasonOpen;
    briefing = briefing;
  }

  // 이유칸에서 Enter — 투표한 상태 + 이유가 있으면 그 방향으로 갱신 저장(토글 아님).
  async function saveReason(item) {
    const reason = trimmed(item);
    if (item.feedback && reason) {
      try {
        const { state } = await api.feedback(item.id, item.feedback, reason);
        item.feedback = state;
      } catch (_e) {
        /* 무시 */
      }
    }
    item._reasonOpen = false;
    briefing = briefing;
  }

  onMount(load);
</script>

{#if loading}
  <p class="muted" style="margin-top:32px">불러오는 중…</p>
{:else if error}
  <p style="color:#f87171;margin-top:32px">{error}</p>
{:else if !briefing}
  <h1>아직 브리핑이 없습니다</h1>
  <p class="muted">브리핑은 매일 설정한 도착 시각(기본 새벽 5시)에 자동으로 도착합니다.</p>
{:else}
  <div class="head-row">
    <div>
      <h1>오늘의 개발 브리핑</h1>
      <div class="date-nav">
        <button class="fb-btn ghost" on:click={goPrev} disabled={isOldest || navLoading}>← 이전</button>
        <p class="muted">{briefing.arrivalDate}</p>
        {#if navIndex > 0}<span class="past-badge">지난 브리핑</span>{/if}
        <button class="fb-btn ghost" on:click={goNext} disabled={isLatest || navLoading}>다음 →</button>
      </div>
    </div>
    <label class="hide-read">
      <input type="checkbox" bind:checked={hideRead} /> 읽은 글 숨기기
    </label>
  </div>

  <h2>필독</h2>
  {#if briefing.mustRead.length === 0}
    <p class="muted">필독 항목이 없습니다.</p>
  {/if}
  {#each briefing.mustRead as item}
    {#if !(hideRead && item.isRead)}
    <div class="card" class:read={item.isRead} on:click={() => open(item)} role="link" tabindex="0"
      on:keydown={(e) => e.key === 'Enter' && open(item)} style="cursor:pointer">
      <div class="tags">
        {#if item.source}<span class="src-tag">{item.source}</span>{/if}
        {#if item.genre}<span class="genre">{item.genre}</span>{/if}
      </div>
      <div class="headline">{item.headline}</div>
      {#if item.body}<div class="body">{item.body}</div>{/if}
      <div class="meta">
        ▲ {item.score} · 💬 {item.comments}
      </div>
      <div class="fb-actions">
        <button class="fb-btn" class:active={item.feedback === 'like'}
          on:click|stopPropagation={() => vote(item, 'like')}>👍 좋아요</button>
        <button class="fb-btn dislike" class:active={item.feedback === 'dislike'}
          on:click|stopPropagation={() => vote(item, 'dislike')}>👎 관심없음</button>
        <button class="fb-btn ghost" on:click|stopPropagation={() => toggleReason(item)}>💬 이유</button>
        <button class="fb-btn ghost" class:active={item.isBookmarked}
          on:click|stopPropagation={() => toggleBookmark(item)}>{item.isBookmarked ? '🔖 북마크됨' : '🔖 북마크'}</button>
        <button class="fb-btn ghost" class:active={item.isRead}
          on:click|stopPropagation={() => toggleRead(item)}>{item.isRead ? '✓ 읽음' : '읽음 표시'}</button>
      </div>
      {#if item._reasonOpen}
        <input class="fb-reason" placeholder="왜 좋은지/관심없는지 (선택)"
          bind:value={item._reason}
          on:click|stopPropagation
          on:keydown|stopPropagation={(e) => e.key === 'Enter' && saveReason(item)} />
      {/if}
    </div>
    {/if}
  {/each}

  <h2>더보기</h2>
  {#each briefing.more as item}
    {#if !(hideRead && item.isRead)}
    <div class="more-wrap" class:read={item.isRead}>
      <div class="more-item" on:click={() => open(item)} role="link" tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && open(item)} style="cursor:pointer">
        {#if item.source}<span class="src-tag">{item.source}</span>{/if}
        {#if item.genre}<span class="tag">{item.genre}</span>{/if}
        <span class="line">{item.line}</span>
        <span class="src">▲{item.score}</span>
      </div>
      <div class="fb-actions sm">
        <button class="fb-btn" class:active={item.feedback === 'like'}
          on:click|stopPropagation={() => vote(item, 'like')}>👍</button>
        <button class="fb-btn dislike" class:active={item.feedback === 'dislike'}
          on:click|stopPropagation={() => vote(item, 'dislike')}>👎</button>
        <button class="fb-btn ghost" on:click|stopPropagation={() => toggleReason(item)}>💬</button>
        <button class="fb-btn ghost" class:active={item.isBookmarked}
          on:click|stopPropagation={() => toggleBookmark(item)}>{item.isBookmarked ? '🔖' : '🔖'}</button>
        <button class="fb-btn ghost" class:active={item.isRead}
          on:click|stopPropagation={() => toggleRead(item)}>{item.isRead ? '✓' : '읽음'}</button>
      </div>
      {#if item._reasonOpen}
        <input class="fb-reason" placeholder="왜 좋은지/관심없는지 (선택)"
          bind:value={item._reason}
          on:click|stopPropagation
          on:keydown|stopPropagation={(e) => e.key === 'Enter' && saveReason(item)} />
      {/if}
    </div>
    {/if}
  {/each}

  <div style="margin:20px 0 8px;text-align:center">
    <!-- 갱신은 최신 브리핑 전용 — 후보 풀은 최신 수집분이라 과거 브리핑에 승격하면 안 됨(서버도 409로 차단) -->
    {#if !isLatest}
      <p class="muted" style="margin:8px 0">지난 브리핑은 여기까지입니다.</p>
    {:else if !exhausted}
      <button class="fb-btn ghost" on:click={loadMore} disabled={moreLoading}
        style="padding:10px 20px">
        {moreLoading ? '불러오는 중…' : '↻ 갱신 — 다음 글 더 보기'}
      </button>
    {:else}
      <p class="muted" style="margin:8px 0">오늘 글은 여기까지입니다 — 내일 새벽 브리핑에서 더 보여드립니다.</p>
    {/if}
    {#if moreError}
      <p style="color:#f87171;margin:4px 0;font-size:0.85em">불러오기 실패: {moreError}</p>
    {/if}
  </div>
{/if}

<style>
  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .hide-read {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #aaa;
    white-space: nowrap;
    cursor: pointer;
    margin-top: 8px;
  }
  .date-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .date-nav .fb-btn {
    padding: 4px 10px;
    font-size: 12px;
  }
  .date-nav .fb-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .date-nav p {
    margin: 0;
  }
  .past-badge {
    display: inline-block;
    font-size: 11px;
    color: var(--accent);
    background: rgba(99, 102, 241, 0.12);
    padding: 2px 8px;
    border-radius: 6px;
    white-space: nowrap;
  }
  /* 읽은 글은 흐리게 — 호버 시 원래대로 */
  .card.read,
  .more-wrap.read {
    opacity: 0.45;
    transition: opacity 0.15s;
  }
  .card.read:hover,
  .more-wrap.read:hover {
    opacity: 1;
  }
</style>
