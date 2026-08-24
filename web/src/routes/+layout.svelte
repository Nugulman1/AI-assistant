<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  // PWA 서비스워커 등록 (dev/prod 경로를 플러그인이 알아서 처리)
  onMount(async () => {
    try {
      const { registerSW } = await import('virtual:pwa-register');
      registerSW({ immediate: true });
    } catch (_e) {
      /* SW 미지원 환경은 무시 */
    }
  });

  $: path = $page.url.pathname;
  const links = [
    { href: '/', label: '브리핑' },
    { href: '/best', label: '베스트' },
    { href: '/github', label: 'GitHub' },
    { href: '/bookmarks', label: '북마크' },
    { href: '/dashboard', label: '대시보드' },
    { href: '/settings', label: '설정' },
  ];
</script>

<nav class="nav">
  {#each links as l}
    <a href={l.href} class:active={path === l.href}>{l.label}</a>
  {/each}
</nav>

<main class="container">
  <slot />
</main>
