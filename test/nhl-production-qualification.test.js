import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalProjectionConfidence} from '../functions/lib/projectionConfidence.js';
import {bivariateDistribution} from '../functions/lib/nhlProV2.js';
import {nhlMarketDistribution,evaluateNhlPropWagerV1,evaluateNhlGameWagers} from '../functions/lib/nhlWagerV1.js';
import {normalizePinnoddsMarkets} from '../functions/lib/pinnoddsMarkets.js';
import {nhlFinalEvidence} from '../functions/api/nhl-wager-research.js';

test('NHL generic quality, conviction, caller calibration and missing model cannot create five stars',()=>{
 for(const extra of [{},{quality:{score:100},rec:{tag:'CONVICTION'}},{nhlGameConfidence:{score:100,validated:true}}]){
  const c=canonicalProjectionConfidence({sport:'nhl',model:{projHome:4,projAway:2},...extra});
  assert.equal(c.source,'NHL_INDEPENDENT_EVIDENCE');assert.equal(c.stars,1);assert.equal(c.calibrated,false);
 }
});
test('regulation and full-game outcomes conserve probability but differ on ties',()=>{
 for(const [h,a] of [[3,3],[5.25,1.45],[1.45,5.25]]){
  const d=bivariateDistribution(h,a,6,-1.5);
  assert.ok(Math.abs(d.homeRegWin+d.awayRegWin+d.regulationTie-1)<.0002);
  assert.equal(d.homeWinIncludingOt+d.awayWinIncludingOt,1);
  assert.ok(d.homeWinIncludingOt>d.homeRegWin);
  assert.ok(d.truncatedMass<.00001);
  assert.equal(d.fullGameScoreMarketsValidated,false);
  assert.match(d.scoringTreatment.emptyNet,/NOT_STATE_MODELED/);
  assert.equal(d.otAllocation.includesShootout,true);
 }
 assert.equal(bivariateDistribution(-1,3),null);
});
test('puck lines apply to home differential with mirrored away side',()=>{
 const favorite=nhlMarketDistribution(4,2,{homeSpread:-1.5});
 const dog=nhlMarketDistribution(2,4,{homeSpread:1.5});
 assert.ok(favorite.homeCover>.5);assert.ok(dog.homeCover<.5);
 assert.ok(Math.abs(favorite.homeCover-dog.awayCover)<.0002);
 assert.ok(Math.abs(favorite.homeCover+favorite.awayCover-1)<.0002);
 assert.notEqual(favorite.homeCover,nhlMarketDistribution(4,4,{homeSpread:-1.5}).homeCover);
});
test('raw goal gap without prices cannot create cover economics or authority',()=>{
 const out=evaluateNhlGameWagers({nhlProV2:{projHome:5,projAway:1},odds:{spread:-1.5,total:6}});
 assert.deepEqual(out.offers,[]);assert.equal(out.canQualify,false);
});
test('all absent or invalid NHL prop price pairs fail closed',()=>{
 for(const value of [undefined,null,'',0,1,-99,NaN])for(const side of ['overOdds','underOdds']){
  const r=evaluateNhlPropWagerV1({sport:'nhl',probabilityOver:.8,probabilityUnder:.2,overOdds:-110,underOdds:-110,[side]:value,
   propGate:'CLEAR',validationStatus:'PROMOTE_RESEARCH'});
  assert.equal(r.decision,'PASS');assert.equal(r.researchCandidate,false);assert.equal(r.canQualify,false);assert.equal(r.canAuthorizeWager,false);
 }
});
test('NHL PinnOdds drops missing prices for all game markets and retains reference-only roles',()=>{
 const event={event_id:1,league_name:'NHL',starts:'2026-10-21T00:00:00Z',home:'Boston Bruins',away:'New York Rangers',periods:{num_0:{money_line:{home:1.9,away:null},spreads:{a:{hdp:-1.5,home:2.5,away:''}},totals:{a:{points:6,over:1.95,under:0}}}}};
 const r=normalizePinnoddsMarkets({events:[event]},{sportId:4,capturedAt:'2026-10-20T12:00:00Z'});
 assert.equal(r.rows.length,3);
 assert.deepEqual(r.rows.map(x=>x.marketFamily),['moneyline','spread','total']);
 for(const x of r.rows){assert.equal(x.executionEligible,false);assert.equal(x.raw.canQualify,false);assert.equal(x.raw.canAuthorizeWager,false);}
});
test('NHL settlement requires explicit final evidence',()=>{
 for(const g of [{home:{score:3},away:{score:2}},{status:'LIVE'},{gameState:'CRIT'},{}])assert.equal(nhlFinalEvidence(g),false);
 for(const g of [{gameState:'OFF'},{status:'FINAL'},{status:{type:{completed:true}}}])assert.equal(nhlFinalEvidence(g),true);
});

test('historical audit metrics and five-star economics exclude unverified records',async()=>{
 const {projectionAudit,fiveStarCohort}=await import('../scripts/nhl-production-audit.mjs');
 const metrics=projectionAudit([{projHome:3,projAway:2,actualHomeGoals:4,actualAwayGoals:1,homeWinProb:.75}]);
 assert.equal(metrics.scoreMae,1);assert.equal(metrics.totalMae,0);assert.equal(metrics.marginMae,2);assert.equal(metrics.brier,.0625);
 const empty=fiveStarCohort([{canonicalStars:5,scope:'GAME',result:'WIN',profitUnits:1,riskUnits:1}]);
 assert.equal(empty.cohorts[0].n,0);assert.equal(empty.profitabilityClaimPermitted,false);
 const out=fiveStarCohort([{canonicalStars:5,scope:'PROP',result:'WIN',profitUnits:1,riskUnits:1,priceEvidenceVerified:true,pitVerified:true}]);
 assert.equal(out.cohorts[1].n,1);assert.equal(out.cohorts[1].roi,1);assert.equal(out.cohorts[1].maxDrawdown,0);
});

test('independent NHL evidence remains capped and ignores price and quality changes',()=>{
 const t=Date.now(),cutoff=new Date(t-60000).toISOString();
 const g={id:'nhl-verified',sport:'nhl',start:new Date(t+3600000).toISOString(),home:{abbr:'BOS'},away:{abbr:'NYR'},
  nhlProV2:{ok:true,independent:true,modelId:'NHL-PRO-v2',eventId:'nhl-verified',home:'BOS',away:'NYR',projHome:3.5,projAway:2.8,
   featureCutoffTimestamp:cutoff,marketInformed:false,dataLineage:{asOf:cutoff,marketInputsUsedForProjection:false},
   probability:{homeRegWin:.5,awayRegWin:.3,regulationTie:.2,rawHomeWinIncludingOt:.62,eloHead:.6,homeWinIncludingOt:.6,awayWinIncludingOt:.4},
   layers:{goalie:{home:{selectionState:'PIT_CONFIRMED_STARTER'},away:{selectionState:'PIT_CONFIRMED_STARTER'}}}}};
 const a=canonicalProjectionConfidence(g),b=canonicalProjectionConfidence({...g,quality:{score:100},odds:{spread:-.5,homeMl:500},rec:{tag:'CONVICTION'}});
 assert.equal(a.stars,3);assert.equal(a.score,b.score);assert.equal(a.calibrated,false);assert.equal(a.fiveStarEligible,false);assert.equal(a.canAuthorizeWager,false);
});
test('missing CLV coverage cannot validate a game confidence cohort',async()=>{
 const {auditConfidenceRows}=await import('../functions/lib/nhlWagerCalibration.js');
 const rows=Array.from({length:150},(_,i)=>({wager_scope:'GAME',confidence:i<50?55:i<100?65:85,result:'WIN',profit_units:1,risk_units:1,calibrated_probability:.8}));
 const a=auditConfidenceRows(rows,'GAME');assert.equal(a.validated,false);assert.ok(a.failures.includes('clv-coverage-insufficient'));
});
test('stale NHL PinnOdds records cannot become board offers',async()=>{
 const {selectPinnoddsBoardOffers}=await import('../functions/lib/pinnoddsBoardResearch.js');
 const pair=['home','away'].map(side=>({source:'PinnOdds',sport:'nhl',canonical_event_id:'nhl-stale',period:'full_game',market_family:'moneyline',side,decimal_odds:1.91,collected_at:'2026-10-17T10:00:00Z',event_start_time:'2026-10-21T00:00:00Z'}));
 assert.deepEqual(selectPinnoddsBoardOffers(pair,{now:'2026-10-20T12:00:00Z'}),{});
});
