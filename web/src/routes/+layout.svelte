<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { token } from '$lib/store.js';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  // PWA 서비스워커 등록 (dev/prod 경로를 플러그인이 알아서 처리)
  onMount(async () => {
    try {
      const { registerSW } = await import('virtual:pwa-register');
      registerSW({ immediate: true });
    } catch (_e) {
      /* SW 미지원 환경은 무시 */
    }
  });

  // 토큰 없으면 로그인으로 (로그인 페이지 제외)
  $: if ($token === null && $page.url.pathname !== '/login') {
    goto('/login');
  }

  function logout() {
    token.set(null);
    goto('/login');
  }

  $: path = $page.url.pathname;
  const links = [
    { href: '/', label: '브리핑' },
    { href: '/best', label: '베스트' },
    { href: '/dashboard', label: '대시보드' },
    { href: '/settings', label: '설정' },
  ];
</script>

{#if $token}
  <nav class="nav">
    {#each links as l}
      <a href={l.href} class:active={path === l.href}>{l.label}</a>
    {/each}
    <span class="spacer"></span>
    <button on:click={logout}>로그아웃</button>
  </nav>
{/if}

<main class="container">
  <slot />
</main>
