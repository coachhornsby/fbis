import test from "node:test";
import assert from "node:assert/strict";
import { buildSportAccountabilityReport } from "../functions/lib/sportAccountability.js";
const base={
 sport:"nfl",gameId:"evt1",snapshotId:"snap1",frozenAt:"2026-10-20T13:00:00Z",
 start:"2026-10-20T18:00:00Z",gradedAt:"2026-10-20T22:00:00Z",
 engine:"NFL-FBIS",modelVersion:"v1",projectionKind:"FBIS",matchup:"Away at Home",
 projHome:24,projAway:17,actualHome:21,actualAway:20,pHomeFinal:.6,
};
test("eleven sport reporting rows are present and no absence is labeled zero",()=>{
 const x=buildSportAccountabilityReport([base]);
 assert.equal(x.sports.length,11);
 assert.equal(x.eligibleForecasts,1);
 assert.equal(x.sports.find(s=>s.sport==="tennis").status,"NO_VERIFIED_PREGAME_OUTCOMES");
 assert.equal(x.sports.find(s=>s.sport==="tennis").scoreMae,null);
 assert.equal(x.sports.find(s=>s.sport==="nfl").scoreMae,3.5);
 assert.equal(x.sports.find(s=>s.sport==="nfl").brier,.16);
 assert.equal(x.sports.find(s=>s.sport==="nfl").simulationStatus,"NO_VERIFIED_SIMULATION_EVIDENCE");
 assert.equal(x.sports.find(s=>s.sport==="nfl").roi,null);
 assert.equal(x.governance.autoWagerAuthority,false);
});
test("retains latest frozen pregame row per game + version without post-start overwrite",()=>{
 const x=buildSportAccountabilityReport([
   base,
   {...base,snapshotId:"snap2",frozenAt:"2026-10-20T16:00:00Z",projHome:23},
   {...base,snapshotId:"snap3",frozenAt:"2026-10-20T20:00:00Z",projHome:21},
 ]);
 assert.equal(x.eligibleForecasts,1);
 assert.equal(x.receipts[0].snapshotId,"snap2");
 assert.equal(x.rejectionCounts.POST_START_FORECAST,1);
});
test("missing start, missing gradedAt, future predictions and market-based forecasts are excluded",()=>{
 const x=buildSportAccountabilityReport([
  {...base,gameId:"missing-start",start:null},
  {...base,gameId:"missing-grade",gradedAt:null},
  {...base,gameId:"late",frozenAt:base.gradedAt},
  {...base,gameId:"market",projectionKind:"PINNACLE_IMPLIED"},
  {...base,gameId:"unset",actualHome:null},
  {...base,gameId:"exclude",projectionState:"LEARNING_EXCLUDED"},
 ]);
 assert.equal(x.eligibleForecasts,0);
 assert.equal(x.rejectionCounts.MISSING_PREGAME_CLOCK,1);
 assert.equal(x.rejectionCounts.UNVERIFIED_SETTLEMENT_TIME,1);
 assert.equal(x.rejectionCounts.POST_START_FORECAST,1);
 assert.equal(x.rejectionCounts.MARKET_IMPLIED,1);
 assert.equal(x.rejectionCounts.UNSETTLED,1);
 assert.equal(x.rejectionCounts.EXPLICITLY_EXCLUDED,1);
});
test("sport-level and model-level reporting remains separate; tied games are not binary win events",()=>{
 const x=buildSportAccountabilityReport([
   {...base,gameId:"a",sport:"soccer",actualHome:1,actualAway:1,projHome:1,projAway:1,pHomeFinal:.7},
   {...base,gameId:"b",sport:"nfl",modelVersion:"v2"},
   {...base,gameId:"c",sport:"nba",modelVersion:"v2"},
 ]);
 assert.equal(x.eligibleForecasts,3);
 assert.equal(x.cohorts.length,3);
 assert.equal(x.sports.find(s=>s.sport==="soccer").brier,null);
 assert.equal(x.sports.find(s=>s.sport==="soccer").winnerHitRate,null);
});
test("scores are derived from real outcomes only, never simulation or wager projection",()=>{
 const x=buildSportAccountabilityReport([{...base,probabilityEvidenceValid:false,projHome:25}]);
 assert.equal(x.sports.find(s=>s.sport==="nfl").brier,null);
 assert.equal(x.sports.find(s=>s.sport==="nfl").roi,null);
 assert.equal(x.sports.find(s=>s.sport==="nfl").intervalCoverage80,null);
});
