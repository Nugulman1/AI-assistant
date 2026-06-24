<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { enablePush } from '$lib/push.js';

  let config = null;
  let sources = [];
  let msg = '';
  let error = '';
  let pushMsg = '';

  // 새 소스 입력
  let newType = 'rss';
  let newName = '';
  let newUrl = '';

  async function load() {
    error = '';
    try {
      config = await api.getConfig();
      sources = await api.sources();
    } catch (e) {
      error = e.message;
    }
  }

  async function saveConfig() {
    msg = '';
    try {
      config = await api.setConfig({
        arrival_time: config.arrival_time,
        lead_minutes: Number(config.lead_minutes),
        more_count: Number(config.more_count),
        timezone: config.timezone,
      });
      msg = '저장됨';
      setTimeout(() => (msg = ''), 2000);
    } catch (e) {
      error = e.message;
    }
  }

  async function addSource() {
    if (!newName || !newUrl) return;
    try {
      await api.addSource({ type: newType, name: newName, url: newUrl });
      newName = '';
      newUrl = '';
      sources = await api.sources();
    } catch (e) {
      error = e.message;
    }
  }

  async function toggleSource(s) {
    await api.updateSource(s.id, { enabled: !s.enabled });
    sources = await api.sources();
  }

  async function removeSource(s) {
    await api.deleteSource(s.id);
    sources = await api.sources();
  }

  async function turnOnPush() {
    pushMsg = '';
    try {
      await enablePush();
      pushMsg = '푸시 구독 완료 (도착 시각에 알림이 옵니다).';
    } catch (e) {
      pushMsg = '실패: ' + e.message;
    }
  }

  onMount(load);
</script>

<h1>설정</h1>
{#if error}<p style="color:#f87171">{error}</p>{/if}

{#if config}
  <h2>도착 시각</h2>
  <p class="muted">이 시각에 완성된 브리핑이 도착합니다. 수집·AI 는 N분 전에 시작합니다.</p>
  <div class="row" style="margin-top:12px">
    <div style="flex:1">
      <label>도착 시각</label>
      <input type="time" bind:value={config.arrival_time} />
    </div>
    <div style="flex:1">
      <label>리드(분 전)</label>
      <input type="number" min="1" max="120" bind:value={config.lead_minutes} />
    </div>
  </div>
  <div class="row">
    <div style="flex:1">
      <label>더보기 개수</label>
      <input type="number" min="1" max="20" bind:value={config.more_count} />
    </div>
    <div style="flex:1">
      <label>타임존</label>
      <input bind:value={config.timezone} />
    </div>
  </div>
  <button class="primary" on:click={saveConfig}>설정 저장</button>
  {#if msg}<span class="muted" style="margin-left:12px">{msg}</span>{/if}

  <h2>알림</h2>
  <button class="primary" on:click={turnOnPush}>이 기기에서 푸시 켜기</button>
  {#if pushMsg}<p class="muted" style="margin-top:10px">{pushMsg}</p>{/if}
{/if}

<h2>소스</h2>
{#each sources as s}
  <div class="row" style="justify-content:space-between">
    <div>
      <strong style="opacity:{s.enabled ? 1 : 0.4}">{s.name}</strong>
      <span class="muted">· {s.type} · {s.url}</span>
    </div>
    <div style="display:flex;gap:6px">
      <button on:click={() => toggleSource(s)}>{s.enabled ? '끄기' : '켜기'}</button>
      <button on:click={() => removeSource(s)}>삭제</button>
    </div>
  </div>
{/each}

<h2>소스 추가</h2>
<div class="row">
  <select bind:value={newType} style="flex:0 0 130px">
    <option value="rss">rss</option>
    <option value="hackernews">hackernews</option>
    <option value="reddit">reddit</option>
  </select>
  <input bind:value={newName} placeholder="이름" style="flex:1" />
</div>
<div class="row">
  <input bind:value={newUrl} placeholder="피드 URL / subreddit / top" />
  <button class="primary" on:click={addSource}>추가</button>
</div>

<style>
  button {
    background: var(--card2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
  }
  button.primary {
    background: var(--accent2);
    border: none;
    color: #fff;
  }
</style>
