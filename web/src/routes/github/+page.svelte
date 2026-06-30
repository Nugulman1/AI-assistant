<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';

  const periods = [
    { key: 'daily', label: '일간', unit: '오늘' },
    { key: 'weekly', label: '주간', unit: '이번 주' },
    { key: 'monthly', label: '월간', unit: '이번 달' },
  ];

  let period = 'daily';
  let items = [];
  let collectedAt = null;
  let loading = true;
  let error = '';
  let reqId = 0; // 세대 토큰 — 탭 빠른 전환 시 stale 응답이 최신을 덮어쓰지 않게

  $: unit = periods.find((p) => p.key === period)?.unit ?? '';

  async function load(p) {
    const myId = ++reqId;
    period = p;
    loading = true;
    error = '';
    try {
      const res = await api.githubTrending(p);
      if (myId !== reqId) return; // 더 최근 요청이 있으면 이 응답은 버린다
      items = res.items;
      collectedAt = res.collectedAt;
    } catch (e) {
      if (myId !== reqId) return;
      error = e.message;
    } finally {
      if (myId === reqId) loading = false;
    }
  }

  function fmtDate(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' });
  }

  function fmtNum(n) {
    return (n ?? 0).toLocaleString('en-US');
  }

  onMount(() => load('daily'));
</script>

<h1>GitHub 트렌딩</h1>
<p class="muted">기간별 급상승 리포지토리 — github.com/trending 의 일/주/월 베스트.</p>

<div class="tabs">
  {#each periods as p}
    <button class="tab" class:active={period === p.key} on:click={() => load(p.key)}>{p.label}</button>
  {/each}
</div>

{#if loading}
  <p class="muted" style="margin-top:24px">불러오는 중…</p>
{:else if error}
  <p style="color:#f87171;margin-top:24px">{error}</p>
{:else if items.length === 0}
  <p class="muted" style="margin-top:24px">아직 수집된 트렌딩이 없습니다. 다음 수집 사이클 후 채워집니다.</p>
{:else}
  {#if collectedAt}<p class="muted" style="font-size:13px">갱신: {fmtDate(collectedAt)}</p>{/if}
  {#each items as item, i}
    <a class="best-row" href={item.url} target="_blank" rel="noopener">
      <span class="best-rank">{i + 1}</span>
      <span class="best-main">
        <span class="best-title">{item.name}</span>
        {#if item.description}<span class="best-desc">{item.description}</span>{/if}
        <span class="best-meta">
          ★ {fmtNum(item.stars)}{#if item.language} · {item.language}{/if} · +{fmtNum(item.period_stars)} stars {unit}
        </span>
      </span>
    </a>
  {/each}
{/if}

<style>
  .tabs {
    display: flex;
    gap: 8px;
    margin: 16px 0 4px;
  }
  .tab {
    padding: 8px 16px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid #3a3a3a;
    color: #aaa;
    cursor: pointer;
  }
  .tab.active {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
  }
  .best-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 12px 4px;
    border-bottom: 1px solid #2a2a2a;
    text-decoration: none;
    color: inherit;
  }
  .best-row:hover .best-title {
    text-decoration: underline;
  }
  .best-rank {
    flex: 0 0 auto;
    width: 24px;
    text-align: right;
    color: #777;
    font-variant-numeric: tabular-nums;
  }
  .best-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .best-title {
    line-height: 1.4;
  }
  .best-desc {
    font-size: 14px;
    color: #bbb;
    line-height: 1.4;
  }
  .best-meta {
    font-size: 13px;
    color: #888;
  }
</style>
