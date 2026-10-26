import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,unwrapD1} from '../scripts/cfb-core-live-readiness.mjs';
const example={game_id:'401',season:2026,week:9,can_qualify:1,final_verified:1,actual_home:31,actual_away:17,generation_at:'2026-10-24T00:00:00Z',feature_cutoff_at:'2026-10-23T23:00:00Z',kickoff:'2026-10-27T00:00:00Z',champion_spread:10,core_spread:12,champion_p_home_win:.7,core_p_home_win:.78,eligibility:'eligible_projected',core_artifact_id:'model-a',core_model_version:'CORE-v2',champion_model_version:'CFB-FBIS-v2'};
test('isolates genuinely original frozen and settled challenger records',()=>{
 const r=evaluate([example],{minimum:200});assert.equal(r.qualified,1);assert.equal(r.missing,199);assert.equal(r.automaticPromotion,false);assert.equal(r.wagerAuthority,false);
});
test('original pregame feature timestamp and separate can_qualify veto fail closed',()=>{
 const r=evaluate([{...example,generation_at:'2026-10-28T00:00:00Z'},{...example,game_id:'402',can_qualify:0}],{minimum:200});
 assert.equal(r.qualified,0);assert.equal(r.readyForHumanReview,false);
});
test('duplicate qualified receipts for a game never double count',()=>{
 const r=evaluate([example,{...example,generation_at:'2026-10-24T01:00:00Z'}],{minimum:1});assert.equal(r.qualified,1);assert.equal(r.groupedWeeks.length,1);
});

test('Wrangler --json query envelope decodes actual database result rows',()=>{
 const input=[{results:[{game_id:'401',season:2026,week:9}],success:true}];
 const rows=unwrapD1(input);
 assert.equal(rows.length,1);assert.equal(rows[0].game_id,'401');
});
