<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  let data = null;
  let error = '';

  onMount(async () => {
    try {
      data = await api.dashboard();
    } catch (e) {
      error = e.message;
    }
  });

  // 장르별 클릭/코퍼스 합쳐 한 표로
  $: rows = (() => {
    if (!data) return [];
    const map = new Map();
    for (const c of data.corpus) map.set(c.genre, { genre: c.genre, items: c.items, clicks: 0 });
    for (const c of data.clicks) {
      const r = map.get(c.genre) || { genre: c.genre, items: 0, clicks: 0 };
      r.clicks = c.clicks;
      map.set(c.genre, r);
    }
    const arr = [...map.values()];
    const maxClicks = Math.max(1, ...arr.map((r) => r.clicks));
    const maxItems = Math.max(1, ...arr.map((r) => r.items));
    for (const r of arr) {
      r.clickPct = (r.clicks / maxClicks) * 100;
      r.itemPct = (r.items / maxItems) * 100;
    }
    return arr.sort((a, b) => b.clicks - a.clicks || b.items - a.items);
  })();
</script>

<h1>관심사 대시보드</h1>
<p class="muted">어떤 장르를 실제로 여는지(클릭) vs 수집된 글 분포. 클릭이 진짜 관심사를 드러냅니다.</p>

{#if error}
  <p style="color:#f87171">{error}</p>
{:else if !data}
  <p class="muted" style="margin-top:24px">불러오는 중…</p>
{:else}
  <p class="muted" style="margin-top:16px">총 읽음: {data.totalReads}회</p>

  {#if data.totalReads === 0}
    <p class="muted">아직 클릭 기록이 없습니다. 브리핑에서 글을 열면 여기 쌓입니다.</p>
  {/if}

  <h2>장르별</h2>
  {#each rows as r}
    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px">
        <span>{r.genre}</span>
        <span class="muted">클릭 {r.clicks} · 수집 {r.items}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span class="muted" style="width:44px;font-size:11px">클릭</span>
        <div class="bar" style="width:{r.clickPct}%"></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="muted" style="width:44px;font-size:11px">수집</span>
        <div class="bar corpus" style="width:{r.itemPct}%"></div>
      </div>
    </div>
  {/each}
{/if}
