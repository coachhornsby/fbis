import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
test('one-shot ingestion caps each shared-quota provider at one and verifies private writes',()=>{
 const s=readFileSync(new URL('../scripts/capture-college-current-sources.mjs',import.meta.url),'utf8');
 assert.match(s,/counts\[provider\]>=1/);assert.match(s,/maxSharedProviderCalls:2/);assert.match(s,/primaryModelInfluence:0/);
 assert.match(s,/COLLEGE_R2_READBACK_MISMATCH/);assert.match(s,/private\/college-sources\/cbbd\/adjusted\/2027\/latest.json/);
 assert.doesNotMatch(s,/private\/(?:cbb|cfb)\/projections|D1_DATABASE|ratings\/adjusted\?season=2026/);
});
test('publication artifacts contain receipts only and no new recurring job',()=>{
 const s=readFileSync(new URL('../.github/workflows/fbis-college-current-sources-once.yml',import.meta.url),'utf8');
 assert.doesNotMatch(s,/\n\s+schedule:|\n\s+cron:/);assert.match(s,/path: artifacts\/college-current-sources\/receipt.json/);
 assert.match(s,/if: github.event_name == 'push'/);
});
