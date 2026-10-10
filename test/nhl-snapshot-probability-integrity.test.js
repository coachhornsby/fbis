import test from "node:test";
import assert from "node:assert/strict";
import { freezeFromGame } from "../functions/lib/projLedger.js";
import { nhlMoneylineSnapshotEvidence,toModelLabRow } from "../functions/lib/snapshotLearning.js";

function game(){
  return {
    id:"401892472",sport:"nhl",start:"2026-10-10T23:00:00Z",
    home:{abbr:"BUF"},away:{abbr:"UTA"},
    projectionEngine:"NHL-PRO-v2",modelVersion:"research-v2.0-event-chain-gbdt",
    odds:{},quality:{score:87,flags:[]},
    model:{
      projHome:3.3,projAway:3.2,
      pHomeFinal:.3037462328635065, // Historical generic market/form head -- must NOT leak
      layers:{market:.28140560742914383,score:.28140560742914383,form:.45454545454545453},
      recipe:{engine:"NHL-PRO-v2",version:"research-v2.0-event-chain-gbdt"}
    },
    nhlProV2:{
      ok:true,modelId:"NHL-PRO-v2",modelVersion:"research-v2.0-event-chain-gbdt",
      home:"BUF",away:"UTA",eventId:"401892472",
      featureCutoffTimestamp:"2026-10-10T18:00:00Z",projHome:3.327,projAway:3.183,
      marketInformed:false,dataLineage:{asOf:"2026-10-10T18:00:00Z",marketInputsUsedForProjection:false},
      probability:{homeRegWin:.42,awayRegWin:.38,regulationTie:.20,
        rawHomeWinIncludingOt:.5226,eloHead:.48,homeWinIncludingOt:.509,awayWinIncludingOt:.491}
    }
  };
}
test("Oct 10 Buffalo PRO-v2 freeze never attaches generic market-derived ML probability",()=>{
  const g=game(),f=freezeFromGame("2026-10-10",g);
  assert.ok(f);
  assert.equal(f.modelVersion,"research-v2.0-event-chain-gbdt");
  assert.equal(f.pHomeFinal,.509);
  assert.equal(f.pScore,.5226);
  assert.equal(f.pMarket,.28140560742914383);
  assert.equal(f.layers.probabilitySource,"NHL-PRO-v2:FULL_GAME_INCLUDING_OT_SHOOTOUT");
  assert.equal(f.layers.probabilitySourceEventId,g.id);
  assert.equal(f.layers.probabilityHomeTeam,"BUF");
  assert.equal(f.layers.probabilityAwayTeam,"UTA");
  assert.equal(f.layers.probabilityFeatureCutoffTimestamp,g.nhlProV2.featureCutoffTimestamp);
  assert.equal(f.layers.marketProbabilityNotUsedForModel,true);
  assert.equal(f.pAwayFinal,.491);
});
test("stale, reversed, score-mismatched or different-head NHL freezes fail closed",()=>{
  for(const patch of ["bad-event","bad-team","score-mismatch","bad-projection"]){
    const g=game();
    if(patch==="bad-event")g.nhlProV2.eventId="other";
    if(patch==="bad-team")g.nhlProV2.home="UTA";
    if(patch==="score-mismatch")g.model.projHome=4.2;
    if(patch==="bad-projection")g.projectionEngine="NHL-FBIS-v1";
    if(patch==="bad-projection")g.model.recipe.engine="NHL-FBIS-v1";
    const f=freezeFromGame("2026-10-10",g);
    assert.equal(f.pHomeFinal,null,patch);
    assert.equal(f.pScore,null,patch);
    assert.equal(f.layers.probabilitySource,"UNAVAILABLE_FAIL_CLOSED",patch);
    assert.ok(f.qualityFlags.includes("nhl_probability_lineage_invalid_fail_closed"));
    assert.equal(f.pMarket,.28140560742914383);
  }
});
test("non-NHL freeze retains existing generic probability behavior",()=>{
  const g=game();g.sport="mlb";
  const f=freezeFromGame("2026-10-10",g);
  assert.equal(f.pHomeFinal,.3037462328635065);
  assert.equal(f.pScore,.28140560742914383);
});

test("legacy mislabeled NHL probability is excluded from Brier learning without rewriting immutable row",()=>{
  const immutable={
    sport:"nhl",gameId:"401892472",engine:"NHL-PRO-v2",
    modelVersion:"research-v2.0-event-chain-gbdt",
    frozenAt:"2026-10-10T13:52:55.162Z",start:"2026-10-10T23:00:00Z",
    pHomeFinal:.3037462328635065,pHome:.3037462328635065,
    projHome:3.3,projAway:3.2,actualHome:3,actualAway:2,
    layers:{market:.28140560742914383,score:.28140560742914383}
  };
  const original=JSON.stringify(immutable);
  assert.equal(nhlMoneylineSnapshotEvidence(immutable).ok,false);
  const normalized=toModelLabRow(immutable);
  assert.equal(normalized.p_home_win,null);
  assert.equal(normalized.probability_evidence_status,"LEGACY_EXCLUDED");
  assert.equal(normalized.proj_home,3.3);
  assert.equal(normalized.actual_home,3);
  assert.equal(JSON.stringify(immutable),original);
  const modern=freezeFromGame("2026-10-10",game());
  assert.equal(nhlMoneylineSnapshotEvidence(modern).ok,true);
  assert.equal(toModelLabRow(modern).p_home_win,.509);
  const swapped={...modern,layers:{...modern.layers,probabilityHomeTeam:"UTA"}};
  assert.equal(nhlMoneylineSnapshotEvidence(swapped).ok,false);
  const wrongVersion=game();
  wrongVersion.modelVersion="research-unrelated-head";
  assert.equal(freezeFromGame("2026-10-10",wrongVersion).pHomeFinal,null);
});
