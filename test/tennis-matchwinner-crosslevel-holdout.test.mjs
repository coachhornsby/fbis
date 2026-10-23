import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMainTourHoldout,evaluateMatchWinnerTransfer} from '../scripts/lib/tennis-matchwinner-transfer.mjs';
const meta={tour:'atp',sourceTier:'MAIN_TOUR',path:'atp_matches_2025.csv'};
const match=(date='20250815',score='6-3 6-4')=>({
 tourney_date:date,tourney_id:'2025-fixture',match_num:'102',
 winner_id:'p0',loser_id:'p1',score,best_of:'3',surface:'Hard',tourney_level:'A'
});
test('main-tour holdout requires full regulation match and conservative embargo',()=>{
 const rows=[match(),{...match(),match_num:'103',score:'6-3 3-0 RET'},
  {...match(),match_num:'104',best_of:'5'},
  {...match('20261015'),match_num:'105'}];
 const r=sanitizeMainTourHoldout(meta,rows,{cutoffExclusive:'20261001'});
 assert.equal(r.length,1);
 assert.equal(r[0].year,2025);
 assert.ok(r[0].outcomeP1===0||r[0].outcomeP1===1);
});
const playerStats=(serveWon,retWon)=>({
 matches:6,svpt:500,serveWon,returnPts:500,returnWon:retWon
});
function store(){
 const groups=new Map();
 for(const year of [2024,2025,2026]){
  const lower=new Map(),main=new Map();
  for(let i=0;i<14;i++){
   const id='p'+i;
   lower.set(id,playerStats(300,185));
   main.set(id,playerStats(year===2026?310:330,year===2026?185:200));
  }
  groups.set('atp|'+year+'|ATP_QUAL_CHALL:C|hard',lower);
  groups.set('atp|'+year+'|MAIN_TOUR|hard',main);
 }
 return {groups};
}
test('true 2025/2026 outcomes cannot leak into earlier-year predictions',()=>{
 const data=store();
 const events=[...sanitizeMainTourHoldout(meta,[match()],{cutoffExclusive:'20261001'}),
  ...sanitizeMainTourHoldout(meta,[match('20260815')],{cutoffExclusive:'20261001'})];
 const opts={simulations:100,minPairedMatches:1,minTournamentClusters:1};
 const original=evaluateMatchWinnerTransfer(data,events,opts);
 assert.equal(original.pairedMatches,2);
 assert.equal(original.productionWrites,0);
 assert.equal(original.canAuthorizeWager,false);
 assert.equal(original.partitions.length,4);
 const a=original.rowSamples.find(x=>x.year===2025);
 const b=original.rowSamples.find(x=>x.year===2026);
 assert.ok(a&&b);
 const main2026=data.groups.get('atp|2026|MAIN_TOUR|hard');
 for(const entry of main2026.values())entry.serveWon=470;
 const after=evaluateMatchWinnerTransfer(data,events,opts);
 assert.equal(after.rowSamples.find(x=>x.year===2025).adjustedProbability,a.adjustedProbability);
 assert.equal(after.rowSamples.find(x=>x.year===2026).adjustedProbability,b.adjustedProbability);
});
test('missing eligible prior-year calibration never triggers a wagerable forecast',()=>{
 const data=store();
 data.groups.delete('atp|2024|MAIN_TOUR|hard');
 const events=sanitizeMainTourHoldout(meta,[match()],{cutoffExclusive:'20261001'});
 const result=evaluateMatchWinnerTransfer(data,events,{simulations:100});
 assert.equal(result.pairedMatches,0);
 assert.ok(result.unscoredReasonCounts.NO_BOTH_PLAYER_QUALIFIED_PRIOR_TIER_PROFILE>=1);
 assert.equal(result.canQualify,false);
});
