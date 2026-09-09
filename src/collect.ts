import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readItems, writeItems, type Item } from './items.js';
import { mergeCandidates, preferHn, preferUrl, titleKey, unionSources, type MergedItem } from './merge.js';
import { collectAll, type SourceConfig } from './sources/index.js';

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 이번 수집 결과를 기존 목록에 반영한다.
 * 같은 id(없으면 같은 titleKey)면 sources 합집합·hn 갱신·firstSeenAt 보존, 새 글이면 firstSeenAt=now.
 * 7일 지난 항목 제거 후 sources.length ↓, firstSeenAt ↓ 로 정렬.
 */
export function applyToExisting(existing: Item[], fresh: MergedItem[], now: number): Item[] {
  const nowIso = new Date(now).toISOString();
  const items = existing.map((it) => ({ ...it, sources: [...it.sources] }));
  const byId = new Map(items.map((it) => [it.id, it]));
  const byTitle = new Map(items.map((it) => [titleKey(it.title), it]));

  for (const f of fresh) {
    const hit = byId.get(f.id) ?? byTitle.get(titleKey(f.title));
    if (hit) {
      hit.sources = unionSources(hit.sources, f.sources);
      hit.url = preferUrl(hit.url, f.url);
      const hn = preferHn(hit.hn, f.hn);
      if (hn) hit.hn = hn;
      if (f.score !== undefined) hit.score = Math.max(hit.score ?? 0, f.score);
      if (f.publishedAt < hit.publishedAt) hit.publishedAt = f.publishedAt;
    } else {
      const item: Item = { ...f, firstSeenAt: nowIso };
      items.push(item);
      byId.set(item.id, item);
      byTitle.set(titleKey(item.title), item);
    }
  }

  return items
    .filter((it) => Date.parse(it.firstSeenAt) >= now - KEEP_MS)
    .sort((a, b) => b.sources.length - a.sources.length || b.firstSeenAt.localeCompare(a.firstSeenAt));
}

async function main(): Promise<void> {
  const now = Date.now();
  const configs = JSON.parse(fs.readFileSync(path.resolve('sources.json'), 'utf8')) as SourceConfig[];
  const existing = readItems();

  const results = await collectAll(configs, now);
  const fresh = mergeCandidates(results.flatMap((r) => r.items));
  const items = applyToExisting(existing.items, fresh, now);
  writeItems({ generatedAt: new Date(now).toISOString(), items });

  const knownIds = new Set(existing.items.map((it) => it.id));
  for (const r of results) {
    console.log(`${r.name}: ${r.items.length}건${r.error ? ` (실패: ${r.error})` : ''}`);
  }
  console.log(`신규: ${items.filter((it) => !knownIds.has(it.id)).length}건`);
  console.log(`총: ${items.length}건 (겹침 ${items.filter((it) => it.sources.length >= 2).length}건)`);
}

// 직접 실행일 때만 수집. 테스트가 applyToExisting 을 import 할 때 돌면 안 된다.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
