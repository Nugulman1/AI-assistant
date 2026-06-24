<script>
  import { api } from '$lib/api.js';
  import { token } from '$lib/store.js';
  import { goto } from '$app/navigation';

  let passcode = '';
  let error = '';
  let loading = false;

  async function submit() {
    error = '';
    loading = true;
    try {
      const { token: t } = await api.login(passcode);
      token.set(t);
      goto('/');
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
</script>

<h1>개발 뉴스 브리핑</h1>
<p class="muted">패스코드로 로그인하세요.</p>

<form on:submit|preventDefault={submit}>
  <div class="row" style="margin-top:20px">
    <input
      type="password"
      bind:value={passcode}
      placeholder="패스코드"
      autocomplete="current-password"
    />
  </div>
  <button class="primary" type="submit" disabled={loading || !passcode}>
    {loading ? '확인 중…' : '로그인'}
  </button>
  {#if error}<p style="color:#f87171;margin-top:12px">{error}</p>{/if}
</form>
