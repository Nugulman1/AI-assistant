<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  let briefing = null;
  let loading = true;
  let error = '';
  let moreLoading = false;
  let exhausted = false;
  let moreError = '';

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
  }

  // 갱신 — 풀의 다음 글들을 그때 요약해 더보기 아래에 한줄로 추가. 소진 시 비활성.
  async function loadMore() {
    if (!briefing || moreLoading || exhausted) return;
    moreLoading = true;
    moreError = '';
    try {
      const { items, exhausted: done } = await api.moreNext(briefing.id);
      briefing.more = [...briefing.more, ...items];
      briefing = briefing; // 반응성 트리거
      if (done) exhausted = true;
    } catch (e) {
      moreError = e instanceof Error ? e.message : String(e);
    } finally {
      moreLoading = false;
    }
  }

  async function open(item) {
    // 읽기 기록(보조 학습 신호) 후 새 탭으로
    try {
      await api.read(item.id);
    } catch (_e) {
      /* 기록 실패해도 링크는 열어줌 */
    }
    window.open(item.url, '_blank', 'noopener');
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
  <h1>오늘의 개발 브리핑</h1>
  <p class="muted">{briefing.arrivalDate}</p>

  <h2>필독</h2>
  {#if briefing.mustRead.length === 0}
    <p class="muted">필독 항목이 없습니다.</p>
  {/if}
  {#each briefing.mustRead as item}
    <div class="card" on:click={() => open(item)} role="link" tabindex="0"
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
      </div>
      {#if item._reasonOpen}
        <input class="fb-reason" placeholder="왜 좋은지/관심없는지 (선택)"
          bind:value={item._reason}
          on:click|stopPropagation
          on:keydown|stopPropagation={(e) => e.key === 'Enter' && saveReason(item)} />
      {/if}
    </div>
  {/each}

  <h2>더보기</h2>
  {#each briefing.more as item}
    <div class="more-wrap">
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
      </div>
      {#if item._reasonOpen}
        <input class="fb-reason" placeholder="왜 좋은지/관심없는지 (선택)"
          bind:value={item._reason}
          on:click|stopPropagation
          on:keydown|stopPropagation={(e) => e.key === 'Enter' && saveReason(item)} />
      {/if}
    </div>
  {/each}

  <div style="margin:20px 0 8px;text-align:center">
    {#if !exhausted}
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
