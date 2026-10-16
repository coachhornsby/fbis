import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPinnoddsR2BoardResearch,preferFreshPinnoddsArchive} from '../functions/lib/pinnoddsArchiveBoard.js';
const at='2026-10-16T17:30:00Z',now='2026-10-16T17:40:00Z',start='2026-10-17T00:00:00Z';
const offer=(eventId,side,odds,marketFamily='moneyline',line=null)=>({
 source:'PinnOdds',sport:'cfb',eventId,marketFamily,period:'full_game',side,
 line,decimalOdds:odds,sourceMarketId:eventId+':full_game:'+marketFamily+':primary:',
 sourceOutcomeId:side,sourceObservedAt:null,eventStart:start,standardOrAlt:'standard'
});
function storage(value){return {async get(){return {async json(){return value}}}}}
const envelope=rows=>({source:'PinnOdds',schemaVersion:1,readOnly:true,canAuthorizeWager:false,
 ingestionScope:'IMMUTABLE_FULL_BOARD_FETCH_FBISEXISTING_PROJECTIONS_GAME_MARKETS',
 sportId:5,feed:'prematch',collectedAt:at,rows});
test('R2 archive returns captured paired PinnOdds lines for only verified board games',async()=>{
 const rows=[
  offer('fbis1','home',1.9),offer('fbis1','away',1.92),
  offer('fbis1','home',1.91,'spread',-3.5),offer('fbis1','away',1.91,'spread',3.5),
  offer('fbis1','over',1.9,'total',46.5),offer('fbis1','under',1.92,'total',46.5),
  offer('unmodeled','home',1.8),offer('unmodeled','away',2.1)
 ];
 const result=await loadPinnoddsR2BoardResearch(storage(envelope(rows)),{
  sport:'cfb',games:[{id:'fbis1'}],now
 });
 assert.equal(result.byGame.fbis1.offers.length,6);
 assert.equal(result.byGame.unmodeled,undefined);
 assert.deepEqual(result.byGame.fbis1.pairedMarkets,['moneyline','spread','total']);
 assert.equal(result.byGame.fbis1.offers[0].executionEligible,false);
 assert.equal(result.byGame.fbis1.latestCapturedAt,at);
});
test('Archive must have valid source, clock, and scope, with zero chance to qualify',async()=>{
 for(const altered of [{source:'unknown'},{readOnly:false},{ingestionScope:'UNSCOPED'}]){
  const r=await loadPinnoddsR2BoardResearch(storage({...envelope([offer('fbis1','home',1.9),offer('fbis1','away',2)]),...altered}),{sport:'cfb',games:[{id:'fbis1'}],now});
  assert.deepEqual(r.byGame,{});
 }
 const old=await loadPinnoddsR2BoardResearch(storage({...envelope([offer('fbis1','home',1.9),offer('fbis1','away',2)]),collectedAt:'2026-10-14T17:30:00Z'}),{sport:'cfb',games:[{id:'fbis1'}],now});
 assert.deepEqual(old.byGame,{});
});
test('archived fresh prices override older D1 receipts without changing eligibility',()=>{
 const stale={byGame:{x:{latestCapturedAt:'2026-10-16T10:00:00Z',offers:[{old:true}]}}};
 const fresh={byGame:{x:{latestCapturedAt:at,offers:[{new:true}]}}};
 const merged=preferFreshPinnoddsArchive(stale,fresh);
 assert.deepEqual(merged.byGame.x.offers,[{new:true}]);
 assert.equal(merged.r2ArchiveCoverage.matchedGames,1);
});
