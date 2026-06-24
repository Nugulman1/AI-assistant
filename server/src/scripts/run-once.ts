import { getDb } from '../db.js';
import { generateBriefing } from '../briefing.js';

/** 스케줄러 없이 브리핑 1건을 즉시 생성 — 로컬 검증용. */
getDb();
const result = await generateBriefing();
console.log('\n=== 생성 결과 ===');
console.log(JSON.stringify(result, null, 2));
process.exit(0);
