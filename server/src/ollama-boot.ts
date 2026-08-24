/**
 * 앱 서버 부팅 시 로컬 Ollama 자동 기동 — 프로젝트 스코프 자동시작.
 * OLLAMA_MODEL 이 설정돼 있고 로컬 주소인데 응답이 없으면 `ollama serve` 를
 * detached 로 띄운다(앱 종료와 무관하게 유지). 실패해도 앱은 Anthropic 폴백으로 정상.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env, hasOllama } from './env.js';

async function ping(ms = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${env.ollamaUrl}/api/version`, {
      signal: AbortSignal.timeout(ms),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureOllama(): Promise<void> {
  if (!hasOllama()) return;
  // 원격 Ollama(다른 호스트)는 여기서 띄울 수 없다 — 로컬 주소일 때만.
  if (!/localhost|127\.0\.0\.1/.test(env.ollamaUrl)) return;
  if (await ping()) {
    console.log('[ollama] 이미 실행 중');
    return;
  }

  // node 는 .bashrc PATH 를 모를 수 있다 — 수동 설치 경로(~/.local/ollama) 우선 탐색.
  const manual = path.join(os.homedir(), '.local/ollama/bin/ollama');
  const bin = process.env.OLLAMA_BIN ?? (fs.existsSync(manual) ? manual : 'ollama');
  console.log(`[ollama] 자동 기동: ${bin} serve`);
  try {
    const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' });
    child.on('error', (e) => console.warn('[ollama] 실행 실패:', e.message));
    child.unref();
  } catch (e) {
    console.warn('[ollama] 실행 실패:', (e as Error).message);
    return;
  }

  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await ping()) {
      console.log('[ollama] 기동 완료');
      return;
    }
  }
  console.warn('[ollama] 10초 내 응답 없음 — AI 호출은 Anthropic 폴백으로 동작');
}
