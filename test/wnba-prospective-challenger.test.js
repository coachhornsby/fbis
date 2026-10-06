import test from "node:test";
import assert from "node:assert/strict";
import {
  attachWnbaProspectiveGameChallengers,
  attachWnbaPlayerOpportunityShadows,
  WNBA_GAMESTATE_CHALLENGER_ID,
  WNBA_LINEUP_CHALLENGER_ID,
  WNBA_PACE_CHALLENGER_ID,
  WNBA_COMBINED_CHALLENGER_ID,
  WNBA_PLAYER_OPPORTUNITY_ID
} from "../functions/lib/wnbaProspectiveChallenger.js";

function game(){
  return {
    id:"g1",start:"2026-10-07T00:00:00Z",
    home:{id:"wnba-1",espnId:"1",abbr:"H"},
    away:{id:"wnba-2",espnId:"2",abbr:"A"},
    wnbaV2:{ok:true,home:80,away:75,margin:5,total:155,sigmaMargin:10.2,sigmaTotal:12.1}
  };
}
function ctx(sample=0){
  return {
    teams:{
      "1":{asOf:"2026-10-06T12:00:00Z",closeOrtgShrunk:110,closePossessions:220,reconstructedPace:82,paceStability:.8,lineupNet100:5,lineupPossessions:700,lineupReliability:.6,lineupDurationCoverage:.72,substitutionResolution:.84},
      "2":{asOf:"2026-10-06T12:00:00Z",closeOrtgShrunk:100,closePossessions:210,reconstructedPace:80,paceStability:.7,lineupNet100:-5,lineupPossessions:650,lineupReliability:.65,lineupDurationCoverage:.72,substitutionResolution:.84},
      "3":{asOf:"2026-10-06T12:00:00Z",closeOrtgShrunk:101,closePossessions:200,reconstructedPace:76,paceStability:.75,lineupNet100:0,lineupPossessions:500,lineupReliability:.5}
    },
    coefficients:{
      [WNBA_GAMESTATE_CHALLENGER_ID]:{sourceCheckpoint:"frozen",targets:{MARGIN:{intercept:0,slope:.1,n:802}}},
      [WNBA_LINEUP_CHALLENGER_ID]:{sourceCheckpoint:"frozen",targets:{MARGIN:{intercept:0,slope:.05,n:802},TOTAL:{intercept:0,slope:.02,n:802}}},
      [WNBA_PACE_CHALLENGER_ID]:{sourceCheckpoint:"frozen",targets:{MARGIN:{intercept:0,slope:0,n:802},TOTAL:{intercept:0,slope:1,n:802}}}
    },
    sampleCounts:{
      [WNBA_GAMESTATE_CHALLENGER_ID]:sample,
      [WNBA_LINEUP_CHALLENGER_ID]:sample,
      [WNBA_PACE_CHALLENGER_ID]:sample
    }
  };
}

test("WNBA prospective challengers remain isolated and research-only",()=>{
  const r=attachWnbaProspectiveGameChallengers([game()],ctx(0));
  const x=r.games[0].wnbaPossessionChallengers;
  assert.ok(x[WNBA_GAMESTATE_CHALLENGER_ID]);
  assert.ok(x[WNBA_LINEUP_CHALLENGER_ID]);
  assert.ok(x[WNBA_PACE_CHALLENGER_ID]);
  assert.equal(x[WNBA_COMBINED_CHALLENGER_ID],undefined);
  assert.equal(x[WNBA_GAMESTATE_CHALLENGER_ID].marketInformed,false);
  assert.equal(x[WNBA_GAMESTATE_CHALLENGER_ID].canQualify,false);
  assert.equal(x[WNBA_GAMESTATE_CHALLENGER_ID].canAuthorize,false);
  assert.equal(x[WNBA_GAMESTATE_CHALLENGER_ID].featureCutoffTimestamp,"2026-10-06T12:00:00Z");
  assert.equal(r.meta.combinedEnabled,false);
});

test("lineup challenger applies reliability shrinkage",()=>{
  const r=attachWnbaProspectiveGameChallengers([game()],ctx(0));
  const x=r.games[0].wnbaPossessionChallengers[WNBA_LINEUP_CHALLENGER_ID];
  // raw margin correction = (5 - -5) * .05 = .5; min lineup reliability .6 => .3
  assert.equal(x.margin,5.3);
  assert.equal(x.feature.lineupReliability,.6);
  assert.equal(x.feature.reliabilityApplied,true);
});

test("combined challenger cannot appear until all isolated samples reach the frozen gate",()=>{
  const r=attachWnbaProspectiveGameChallengers([game()],ctx(30));
  assert.equal(r.meta.combinedEnabled,true);
  const c=r.games[0].wnbaPossessionChallengers[WNBA_COMBINED_CHALLENGER_ID];
  assert.ok(c);
  assert.equal(c.canQualify,false);
  assert.equal(c.feature.activationRule,"isolated_n>=30");
});

test("player opportunity shadow freezes distributions but keeps incumbent mean",()=>{
  const g=game();
  g.playerProjectionRows=[{
    playerId:"p1",playerName:"Player One",team:"H",market:"points",fbisProjection:18.4,fbisSigma:4.2,
    role:{minutes:30,games:20}
  },{
    playerId:"p2",playerName:"Player Two",team:"H",market:"points",fbisProjection:10,fbisSigma:3.2,
    role:{minutes:24,games:20}
  }];
  const impact={
    players:{
      p1:{skill:{games:20,minutes:30,usage:22,pointsPer40:20,reboundsPer40:6,assistsPer40:4,threesPer40:2}},
      p2:{skill:{games:20,minutes:24,usage:15,pointsPer40:14,reboundsPer40:5,assistsPer40:3,threesPer40:1}}
    },
    roles:{
      p1:{featureCutoffTimestamp:"2026-10-06T11:00:00Z",availabilityVerified:true,role:{minutesDelta:2},unavailable:[]},
      p2:{featureCutoffTimestamp:"2026-10-06T11:00:00Z",availabilityVerified:false,role:{minutesDelta:5},unavailable:[]}
    }
  };
  const r=attachWnbaPlayerOpportunityShadows([g],impact);
  const s=r.games[0].playerProjectionRows[0].opportunityShadow;
  assert.equal(s.modelId,WNBA_PLAYER_OPPORTUNITY_ID);
  assert.equal(s.projection,18.4);
  assert.equal(s.minutesMean,32);
  assert.equal(s.featureCutoffTimestamp,"2026-10-06T11:00:00Z");
  assert.deepEqual(s.expectedTeammates,[{playerId:"p2",playerName:"Player Two"}]);
  assert.equal(s.canQualify,false);
  assert.equal(s.marketInformed,false);
});
