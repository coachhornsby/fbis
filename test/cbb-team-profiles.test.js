import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCbbTeamProfiles, persistCbbTeamProfiles, CBB_TEAM_PROFILE_ENDPOINT,
} from "../functions/lib/cbbTeamProfiles.js";

const at = "2026-04-08T13:00:00.000Z";
const row = {
  season:2026,teamId:150,team:"Duke",conference:{abbreviation:"ACC"},
  record:{games:38,wins:35,losses:3},
  summary:{trackedShots:2198,pace:66.5,rawNetRating:25.2},
  teamStats:{
    points:{total:3110},possessions:2550,rawOffensiveRating:121.9,
    threePointFieldGoals:{attempted:820,pct:0.347},
    fourFactors:{effectiveFieldGoalPct:0.58,turnoverRatio:0.145,
      offensiveReboundPct:0.31,freeThrowRate:0.29},
  },
  opponentStats:{
    points:{total:2398},possessions:2530,rawOffensiveRating:94.8,
    fourFactors:{effectiveFieldGoalPct:0.44,turnoverRatio:0.19},
  },
  shotProfile:{
    atRim:{rate:0.449,pct:0.647},
    twoPointJumper:{rate:0.116,pct:0.429},
    threePointJumper:{rate:0.435,pct:0.347},
    distribution:{threeRate:0.435,midrangeRate:0.116,jumperRate:0.551},
  },
  adjustedEfficiency:{
    offensiveRating:129.2,defensiveRating:88.7,netRating:40.5,
    rankings:{offense:4,defense:1,net:2},
  },
};
test("bulk CBBD payload makes a private research team snapshot without further API calls",()=>{
  const result=buildCbbTeamProfiles([row],{season:2026,observedAt:at});
  assert.equal(result.matched,1);
  const p=result.profiles[0];
  assert.equal(p.team,"Duke");
  assert.equal(p.sourceEndpoint,CBB_TEAM_PROFILE_ENDPOINT);
  assert.equal(p.season,2026);
  assert.equal(p.observedAt,at);
  assert.equal(p.shooting.atRim.rate,0.449);
  assert.equal(p.shooting.threeRate,0.435);
  assert.equal(p.adjustedEfficiency.net,40.5);
  assert.equal(p.defenseAllowed.fourFactors.turnoverRatio,0.19);
  assert.equal(p.governance.canInfluenceProjection,false);
  assert.equal(p.governance.canAuthorizeWager,false);
  assert.equal(p.quality.staleForHistoricalPregame,true);
});
test("unresolved teams and wrong seasons are quarantined, not assigned to real teams",()=>{
  const bad={...row,team:"Invented University"};
  const result=buildCbbTeamProfiles([bad,{...row,season:2025}],{season:2026,observedAt:at});
  assert.equal(result.matched,0);
  assert.equal(result.unresolvedCount,2);
  assert.deepEqual(result.unresolved.map(x=>x.reason).sort(),
    ["canonical-identity-unresolved","season-mismatch"]);
});
test("unknown shooting fields stay null; samples with zero attempts are not treated as available",()=>{
  const result=buildCbbTeamProfiles([{
    ...row,summary:{trackedShots:0},
    shotProfile:{atRim:{pct:null},distribution:{}},
  }],{season:2026,observedAt:at});
  assert.equal(result.profiles[0].shooting.atRim.rate,null);
  assert.equal(result.profiles[0].quality.shootingAvailable,false);
  assert.equal(result.profiles[0].shooting.threeRate,null);
});
test("profile writer fails closed without migrated D1",async()=>{
  const missing=await persistCbbTeamProfiles({},[row],{season:2026,observedAt:at});
  assert.equal(missing.ok,false);
  assert.equal(missing.networkCalls,0);
  assert.equal(missing.reason,"CBB_PROFILE_D1_REQUIRED");
});
test("bulk profile save uses the D1 batch with no network transport",async()=>{
  const commands=[];
  const DB={
    prepare(sql){
      if(sql.includes("sqlite_master"))return{first:async()=>({name:"cbb_team_profile_snapshots"})};
      return{bind(...args){return{sql,args}}};
    },
    async batch(stmts){commands.push(...stmts);return stmts.map(()=>({meta:{changes:1}}));},
  };
  const saved=await persistCbbTeamProfiles({DB},[row],{season:2026,observedAt:at,jobRunId:"offline"});
  assert.equal(saved.ok,true);
  assert.equal(saved.inserted,1);
  assert.equal(saved.networkCalls,0);
  assert.equal(commands.length,1);
  assert.match(commands[0].sql,/can_authorize_wager,created_at/);
  const profile=JSON.parse(commands[0].args[8]);
  assert.equal(profile.governance.mode,"RESEARCH");
});
