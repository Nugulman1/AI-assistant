<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  let briefing = null;
  let loading = true;
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const { briefing: b } = await api.briefing();
      briefing = b;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function open(item) {
    // 읽기 기록(대시보드 학습 원천) 후 새 탭으로
    try {
      await api.read(item.id);
    } catch (_e) {
      /* 기록 실패해도 링크는 열어줌 */
    }
    window.open(item.url, '_blank', 'noopener');
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
    </div>
  {/each}

  <h2>더보기</h2>
  {#each briefing.more as item}
    <div class="more-item" on:click={() => open(item)} role="link" tabindex="0"
      on:keydown={(e) => e.key === 'Enter' && open(item)} style="cursor:pointer">
      {#if item.source}<span class="src-tag">{item.source}</span>{/if}
      {#if item.genre}<span class="tag">{item.genre}</span>{/if}
      <span class="line">{item.line}</span>
      <span class="src">▲{item.score}</span>
    </div>
  {/each}
{/if}
