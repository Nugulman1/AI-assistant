/**
 * npm run news            — 최근 2일치 목록 (번호·id·제목·소스·HN 점수)
 * npm run news -- dig <n> — 한 건의 원문 + HN 댓글을 dig/*.md 로 저장 (Claude Code 가 읽어 토의)
 *
 * 항목 파일: docs/data/items.json (NEWS_ITEMS_FILE 로 경로 override, --remote 면 GitHub raw 에서 fetch)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ITEMS_PATH, ITEMS_RAW_URL, readItems, type Item, type ItemsFile } from '../items.js';
import { fetchArticleText } from '../sources/fulltext.js';
import { extractText } from '../sources/text.js';

const USAGE = `사용법:
  npm run news [-- --remote]              최근 2일치 목록
  npm run news -- dig <id|번호> [--remote]  원문·HN 댓글을 dig/ 에 저장
  환경변수 NEWS_ITEMS_FILE=<path>          items.json 경로 override`;

const RECENT_DAYS = 2;
const MAX_TOP_COMMENTS = 30;
const COMMENT_MAX_LEN = 2000;
const ARTICLE_MAX_LEN = 20000;

function fail(msg: string): never {
  process.stderr.write(`${msg}\n\n${USAGE}\n`);
  process.exit(1);
}

/** 로컬 타임존 기준 YYYY-MM-DD. */
function localDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function loadItems(remote: boolean): Promise<ItemsFile> {
  if (remote) {
    const res = await fetch(ITEMS_RAW_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) fail(`원격 items.json 가져오기 실패: HTTP ${res.status}`);
    return (await res.json()) as ItemsFile;
  }
  const file = process.env.NEWS_ITEMS_FILE ?? ITEMS_PATH;
  if (!fs.existsSync(file)) fail(`items.json 없음: ${file} (먼저 npm run collect 또는 --remote)`);
  return readItems(file);
}

/**
 * 목록·dig 가 공유하는 유일한 순서: firstSeenAt 로컬 날짜 최근 2일치를 날짜 내림차순으로 묶고,
 * 날짜 안에서는 파일 순서. 번호는 이 순서의 1-based 인덱스 — 두 명령이 같은 함수를 쓰므로 일치한다.
 */
function recentItems(data: ItemsFile): { date: string; items: Item[] }[] {
  const byDate = new Map<string, Item[]>();
  for (const it of data.items) {
    const d = localDate(it.firstSeenAt);
    (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(it);
  }
  return [...byDate.keys()]
    .sort()
    .reverse()
    .slice(0, RECENT_DAYS)
    .map((date) => ({ date, items: byDate.get(date)! }));
}

function describe(it: Item): string {
  const src = it.sources.length >= 2 ? `${it.sources.join(', ')} ×${it.sources.length}` : it.sources[0];
  const parts = [`[${src}]`];
  if (it.hn) parts.push(`HN ↑${it.hn.points} 💬${it.hn.comments}`);
  if (it.score !== undefined) parts.push(`↑${it.score}`);
  return parts.join('  ');
}

function printList(data: ItemsFile): void {
  const groups = recentItems(data);
  if (groups.length === 0) {
    console.log('항목 없음');
  }
  let n = 0;
  for (const { date, items } of groups) {
    console.log(`\n## ${date}`);
    for (const it of items) {
      n += 1;
      console.log(`${String(n).padStart(3)}. ${it.id}  ${it.title}\n     ${describe(it)}`);
    }
  }
  const gen = new Date(data.generatedAt);
  console.log(`\n마지막 수집 ${localDate(gen)} ${gen.toTimeString().slice(0, 5)} (${data.items.length}건 보관)`);
}

function findItem(data: ItemsFile, ref: string): Item {
  if (/^\d+$/.test(ref)) {
    const flat = recentItems(data).flatMap((g) => g.items);
    const it = flat[Number(ref) - 1];
    if (!it) fail(`번호 ${ref} 없음 (1–${flat.length})`);
    return it;
  }
  const hits = data.items.filter((it) => it.id.startsWith(ref));
  if (hits.length === 0) fail(`id '${ref}' 로 시작하는 항목 없음`);
  if (hits.length > 1) fail(`id '${ref}' 가 여러 개와 일치: ${hits.map((h) => h.id).join(', ')}`);
  return hits[0];
}

// ── HN 댓글 (Algolia items API: 트리 전체를 한 번에 준다) ──
interface HnNode {
  author: string | null;
  text: string | null; // 삭제된 댓글은 null
  children: HnNode[];
}
interface Comment {
  author: string;
  text: string;
  reply?: { author: string; text: string };
}

function toComment(node: HnNode): Comment | undefined {
  const text = extractText(node.text, COMMENT_MAX_LEN);
  if (!text) return undefined;
  return { author: node.author ?? '[deleted]', text };
}

/** 최상위 댓글 순서대로 최대 30개, 각각 첫 (살아있는) 답글 1개까지. */
async function fetchHnComments(hnId: string): Promise<Comment[]> {
  const res = await fetch(`https://hn.algolia.com/api/v1/items/${hnId}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const root = (await res.json()) as HnNode;
  const out: Comment[] = [];
  for (const top of root.children ?? []) {
    if (out.length >= MAX_TOP_COMMENTS) break;
    const c = toComment(top);
    if (!c) continue;
    for (const child of top.children ?? []) {
      const r = toComment(child);
      if (r) {
        c.reply = r;
        break;
      }
    }
    out.push(c);
  }
  return out;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

async function dig(data: ItemsFile, ref: string): Promise<void> {
  const it = findItem(data, ref);
  process.stderr.write(`원문 가져오는 중: ${it.url}\n`);
  const [article, comments] = await Promise.all([
    fetchArticleText(it.url, ARTICLE_MAX_LEN),
    it.hn
      ? fetchHnComments(it.hn.id).then(
          (c) => ({ ok: true as const, c }),
          (e: unknown) => ({ ok: false as const, err: e instanceof Error ? e.message : String(e) }),
        )
      : Promise.resolve(undefined),
  ]);

  const lines: string[] = [`# ${it.title}`, '', `- url: ${it.url}`, `- 소스: ${it.sources.join(', ')}`];
  if (it.hn) {
    lines.push(`- HN: https://news.ycombinator.com/item?id=${it.hn.id} (↑${it.hn.points} 💬${it.hn.comments})`);
  }
  if (it.score !== undefined) lines.push(`- 점수: ${it.score}`);
  lines.push(`- 발행: ${it.publishedAt}`, '', '## 본문', '');
  lines.push(article ?? '본문 추출 실패: 타임아웃·차단·비HTML(PDF 등)·본문 파싱 불가 중 하나 — url 을 직접 열어야 한다.');

  if (comments) {
    lines.push('', '## HN 댓글', '');
    if (!comments.ok) {
      lines.push(`댓글 가져오기 실패: ${comments.err}`);
    } else if (comments.c.length === 0) {
      lines.push('댓글 없음');
    } else {
      comments.c.forEach((c, i) => {
        lines.push(`### ${i + 1}. ${c.author}`, '', c.text, '');
        if (c.reply) lines.push(`> **${c.reply.author}** ↳ ${c.reply.text}`, '');
      });
    }
  }
  lines.push('', '## 메모', '', '');

  const dir = path.resolve('dig');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${localDate(new Date())}-${it.id}-${slugify(it.title)}.md`);
  fs.writeFileSync(file, lines.join('\n'));
  console.log(file);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const remote = args.includes('--remote');
  const rest = args.filter((a) => a !== '--remote');

  if (rest.length === 0) {
    printList(await loadItems(remote));
    return;
  }
  if (rest[0] === 'dig' && rest.length === 2) {
    await dig(await loadItems(remote), rest[1]);
    return;
  }
  fail(`알 수 없는 인수: ${rest.join(' ')}`);
}

main().catch((e: unknown) => {
  process.stderr.write(`오류: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
