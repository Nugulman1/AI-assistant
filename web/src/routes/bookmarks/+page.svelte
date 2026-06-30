<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  let items = [];
  let loading = true;
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const { bookmarks } = await api.bookmarks();
      items = bookmarks;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  // 북마크 해제 — 목록에서 즉시 제거(서버 상태와 동기화)
  async function removeBookmark(item) {
    try {
      await api.updateStatus(item.id, { isBookmarked: false });
      items = items.filter((b) => b.id !== item.id);
    } catch (_e) {
      /* 무시 */
    }
  }

  function open(item) {
    // 원문 클릭 = 자동 읽음(백엔드 처리). 북마크 목록 자체는 읽음으로 사라지지 않음.
    api.read(item.id).catch(() => {});
    window.open(item.url, '_blank', 'noopener');
  }

  onMount(load);
</script>

<h1>북마크</h1>
<p class="muted">저장해 둔 글 — 브리핑 기간과 무관하게 영구 보관됩니다.</p>

{#if loading}
  <p class="muted" style="margin-top:24px">불러오는 중…</p>
{:else if error}
  <p style="color:#f87171;margin-top:24px">{error}</p>
{:else if items.length === 0}
  <p class="muted" style="margin-top:24px">아직 북마크한 글이 없습니다. 브리핑에서 🔖 버튼으로 저장하세요.</p>
{:else}
  {#each items as item}
    <div class="bm-row">
      <div class="bm-main" on:click={() => open(item)} role="link" tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && open(item)} style="cursor:pointer">
        <div class="tags">
          {#if item.source}<span class="src-tag">{item.source}</span>{/if}
          {#if item.genre}<span class="tag">{item.genre}</span>{/if}
        </div>
        <span class="bm-title">{item.title}</span>
        <span class="bm-meta">▲ {item.score} · 💬 {item.comments}</span>
      </div>
      <button class="fb-btn ghost" on:click|stopPropagation={() => removeBookmark(item)}>🔖 해제</button>
    </div>
  {/each}
{/if}

<style>
  .bm-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 4px;
    border-bottom: 1px solid #2a2a2a;
  }
  .bm-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .bm-main:hover .bm-title {
    text-decoration: underline;
  }
  .bm-title {
    line-height: 1.4;
  }
  .bm-meta {
    font-size: 13px;
    color: #888;
  }
</style>
