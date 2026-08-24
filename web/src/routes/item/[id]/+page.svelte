<script>
  import { onMount, tick } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api.js';

  let item = null;
  let loading = true;
  let error = '';

  let deepLoading = false;
  let deepError = '';

  // Q&A — 이력은 클라이언트가 보관(서버 무저장)
  let chat = []; // {role:'user'|'assistant', content}
  let question = '';
  let asking = false;
  let askError = '';
  let chatBottom;

  $: itemId = Number($page.params.id);

  onMount(load);

  async function load() {
    loading = true;
    error = '';
    try {
      const { item: it } = await api.item(itemId);
      item = it;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // 심층 요약 생성 — 로컬 AI라 수십 초 걸릴 수 있음
  async function makeDeep() {
    if (deepLoading) return;
    deepLoading = true;
    deepError = '';
    try {
      const { deep } = await api.itemDeep(itemId);
      item.deep = deep;
      item = item;
    } catch (e) {
      deepError = e instanceof Error ? e.message : String(e);
    } finally {
      deepLoading = false;
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    asking = true;
    askError = '';
    const history = chat.map(({ role, content }) => ({ role, content }));
    chat = [...chat, { role: 'user', content: q }];
    question = '';
    await tick();
    chatBottom?.scrollIntoView({ behavior: 'smooth' });
    try {
      const { answer } = await api.itemAsk(itemId, q, history);
      chat = [...chat, { role: 'assistant', content: answer }];
      await tick();
      chatBottom?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      askError = e instanceof Error ? e.message : String(e);
    } finally {
      asking = false;
    }
  }
</script>

{#if loading}
  <p class="muted">불러오는 중…</p>
{:else if error}
  <p style="color:#f87171">불러오기 실패: {error}</p>
{:else if item}
  <a href="/" class="back">← 브리핑으로</a>

  <div class="tags" style="margin-top:8px">
    {#if item.source}<span class="src-tag">{item.source}</span>{/if}
    {#if item.genre}<span class="genre">{item.genre}</span>{/if}
  </div>
  <h1 class="title">{item.title}</h1>
  <p class="muted meta-line">
    ▲ {item.score} · 💬 {item.comments} ·
    <a href={item.url} target="_blank" rel="noreferrer">원문 열기 ↗</a>
  </p>
  <p class="card-summary">{item.cardSummary}</p>

  <h2>🔬 심층 요약</h2>
  {#if item.deep}
    <div class="deep">
      <p class="deep-overview">{item.deep.overview}</p>
      <ul>
        {#each item.deep.points as p}
          <li>{p}</li>
        {/each}
      </ul>
      <p class="deep-takeaway">💡 {item.deep.takeaway}</p>
      <button class="fb-btn ghost" on:click={makeDeep} disabled={deepLoading}>
        {deepLoading ? '다시 생성 중…' : '↻ 다시 생성'}
      </button>
    </div>
  {:else}
    <div class="deep-empty">
      <p class="muted">원문을 가져와 로컬 AI가 심층 요약합니다 (수십 초 걸릴 수 있어요).</p>
      <button class="fb-btn" on:click={makeDeep} disabled={deepLoading}>
        {deepLoading ? '원문 수집·요약 중…' : '심층 요약 생성'}
      </button>
    </div>
  {/if}
  {#if deepError}<p style="color:#f87171;font-size:0.85em">{deepError}</p>{/if}

  <h2>💬 이 글에 대해 질문하기</h2>
  <div class="chat">
    {#each chat as m}
      <div class="msg {m.role}">
        <span class="who">{m.role === 'user' ? '나' : 'AI'}</span>
        <div class="bubble">{m.content}</div>
      </div>
    {/each}
    {#if asking}<p class="muted">답변 생성 중…</p>{/if}
    {#if askError}<p style="color:#f87171;font-size:0.85em">{askError}</p>{/if}
    <div bind:this={chatBottom}></div>
  </div>
  <form class="ask-row" on:submit|preventDefault={ask}>
    <input
      placeholder="예: 이 글에서 말하는 핵심 원인이 뭐야?"
      bind:value={question}
      disabled={asking}
    />
    <button class="fb-btn" type="submit" disabled={asking || !question.trim()}>질문</button>
  </form>
{/if}

<style>
  .back {
    color: var(--accent);
    text-decoration: none;
    font-size: 14px;
  }
  .title {
    margin: 6px 0 4px;
    line-height: 1.3;
  }
  .meta-line a {
    color: var(--accent);
  }
  .card-summary {
    color: #aaa;
    font-size: 14px;
    border-left: 3px solid #333;
    padding-left: 10px;
  }
  .deep {
    background: rgba(99, 102, 241, 0.06);
    border: 1px solid rgba(99, 102, 241, 0.25);
    border-radius: 10px;
    padding: 14px 16px;
  }
  .deep-overview {
    font-weight: 600;
    margin-top: 0;
  }
  .deep ul {
    margin: 8px 0;
    padding-left: 20px;
  }
  .deep li {
    margin: 6px 0;
    line-height: 1.5;
  }
  .deep-takeaway {
    color: var(--accent);
  }
  .deep-empty {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .chat {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 10px;
  }
  .msg {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .msg .who {
    flex: 0 0 auto;
    font-size: 12px;
    color: #888;
    margin-top: 6px;
    width: 22px;
  }
  .msg .bubble {
    background: #26262e;
    border-radius: 10px;
    padding: 8px 12px;
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .msg.user .bubble {
    background: rgba(99, 102, 241, 0.18);
  }
  .ask-row {
    display: flex;
    gap: 8px;
  }
  .ask-row input {
    flex: 1;
    background: #1c1c22;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 10px 12px;
    color: inherit;
  }
</style>
