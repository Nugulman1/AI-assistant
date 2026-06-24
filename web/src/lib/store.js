import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'briefing_token';

const initial = browser ? localStorage.getItem(KEY) : null;
export const token = writable(initial);

if (browser) {
  token.subscribe((v) => {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  });
}
