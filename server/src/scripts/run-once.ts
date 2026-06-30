import { getDb } from '../db.js';
import { generateBriefing } from '../briefing.js';
import { collectAndStoreBest } from '../best.js';
import { collectAndStoreTrending } from '../github-best.js';

/** 스케줄러 없이 브리핑 1건 + 기간별 베스트 + GitHub 트렌딩을 즉시 생성 — 로컬 검증용. */
getDb();
const result = await generateBriefing();
const best = await collectAndStoreBest();
const trending = await collectAndStoreTrending();
console.log('\n=== 생성 결과 ===');
console.log(JSON.stringify({ briefing: result, best, trending }, null, 2));
process.exit(0);
