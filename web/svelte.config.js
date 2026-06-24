import adapter from '@sveltejs/adapter-static';

/** SPA 모드: 모든 라우트를 클라이언트에서 렌더(별도 API 서버 호출). */
/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ fallback: 'index.html', strict: false }),
  },
};

export default config;
