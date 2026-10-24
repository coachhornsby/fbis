import test from "node:test";
import assert from "node:assert/strict";
import {summarizeFootballProspectiveReadiness} from "../functions/lib/footballProspectiveReadinessResearch.js";
const now="2026-10-24T23:00:00Z";
const base={sport:"cfb",gameId:"a",modelId:"CFB-VERIFIED-DRIVE-MATCHUP-SHADOW-v0",capturedAt:"2026-10-23T18:00:00Z",kickoff:"2026-10-24T15:00:00Z",homeTeamId:"A",awayTeamId:"B",gradedAt:null};
test("Distinguish truly overdue finals from future and in-progress kickoffs",()=>{
 const x=summarizeFootballProspectiveReadiness([base,{...base,gameId:"b",homeTeamId:"C",kickoff:"2026-10-25T00:00:00Z"},{...base,gameId:"c",homeTeamId:"D",kickoff:"2026-10-24T21:00:00Z"}],{sport:"cfb",asOf:now,sourceLatestObservedAt:"2026-10-24T13:00:00Z"});
 assert.equal(x.receiptCount,3);
 assert.equal(x.overduePhysicalGames,1);
 assert.equal(x.models[base.modelId].future,1);
 assert.equal(x.models[base.modelId].inProgressOrRecentlyFinished,1);
 assert.equal(x.sourceAgeHours,10);
 assert.equal(x.canAuthorizeWager,false);
});
test("Graded result and superseded model are kept distinct",()=>{
 const r=summarizeFootballProspectiveReadiness([{...base,sport:"nfl",modelId:"NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3",gradedAt:"2026-10-24T21:00:00Z"}],{sport:"nfl",asOf:now});
 assert.equal(r.models["NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3"].status,"SUPERSEDED_KICKOFF_FIELD_VERSION");
 assert.equal(r.models["NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3"].graded,1);
 assert.equal(r.canQualify,false);
});
test("Postkickoff fabricated pregame receipts fail closed",()=>{
 const r=summarizeFootballProspectiveReadiness([{...base,capturedAt:"2026-10-24T20:00:00Z"}],{sport:"cfb",asOf:now});
 assert.equal(r.receiptCount,0);
 assert.equal(r.excluded.INVALID_PREGAME_RECEIPT,1);
});
