import test from "node:test";
import assert from "node:assert/strict";
import { shouldUseLiveMlbFeatureFallback } from "../functions/lib/slateEngineCore.js";
import {
  profileAgeHours,
  profileFresh,
  expectedStarterInnings,
  bullpenFatigueFromUsage,
  loadMlbPersistentState,
  buildPersistentBullpenFeed,
  attachMlbPersistentFeatureContext,
} from "../functions/lib/mlbPersistentProfiles.js";

test("persistent MLB profile freshness is bounded",()=>{
  const now=Date.parse("2026-10-05T18:00:00Z");
  assert.equal(profileAgeHours("2026-10-05T12:00:00Z",now),6);
  assert.equal(profileFresh("2026-10-05T12:00:00Z",{now,maxAgeHours:8}),true);
  assert.equal(profileFresh("2026-10-05T08:00:00Z",{now,maxAgeHours:8}),false);
});

test("starter innings combines recent usage and bullpen fatigue without blanket October haircut",()=>{
  const normal=expectedStarterInnings({seasonIpPerStart:5.8,recentIp:6.2,bullpenFatigue:.5});
  const tiredPen=expectedStarterInnings({seasonIpPerStart:5.8,recentIp:6.2,bullpenFatigue:1.0});
  const rested=expectedStarterInnings({seasonIpPerStart:5.8,recentIp:6.2,bullpenFatigue:.1});
  assert.ok(tiredPen>normal);
  assert.ok(rested<normal);
  assert.ok(normal>5.8);
});

test("bullpen fatigue rises with recent core-reliever workload",()=>{
  const low=bullpenFatigueFromUsage([
    {asOf:"2026-10-05",date:"2026-10-04",playerId:"1",pitches:8,core:true},
  ]);
  const high=bullpenFatigueFromUsage([
    {asOf:"2026-10-05",date:"2026-10-04",playerId:"1",pitches:35,core:true},
    {asOf:"2026-10-05",date:"2026-10-04",playerId:"2",pitches:30,core:true},
    {asOf:"2026-10-05",date:"2026-10-03",playerId:"1",pitches:28,core:true},
    {asOf:"2026-10-05",date:"2026-10-03",playerId:"9",pitches:35,core:false},
  ]);
  assert.ok(high.fatigueScore>low.fatigueScore);
  assert.ok(high.bullpenEraMultiplier>=1);
});

test("D1 persistent loader batches teams and players without external fetch",async()=>{
  const rows={
    team:[{
      team_id:"117",team_key:"HOU",as_of:"2026-10-05T12:00:00Z",
      profile_json:JSON.stringify({teamName:"Houston Astros",starterState:{"100":{expectedInnings:6.1}}}),
      bullpen_json:JSON.stringify({fatigue:{fatigueScore:.4}}),
      lineup_json:JSON.stringify({state:"ROSTER_BASELINE"}),
      schedule_json:JSON.stringify({nextGame:{gameId:"g1"}}),
    },{
      team_id:"147",team_key:"NYY",as_of:"2026-10-05T12:00:00Z",
      profile_json:JSON.stringify({teamName:"New York Yankees",starterState:{"200":{expectedInnings:5.9}}}),
      bullpen_json:JSON.stringify({fatigue:{fatigueScore:.3}}),
      lineup_json:JSON.stringify({state:"ROSTER_BASELINE"}),
      schedule_json:JSON.stringify({nextGame:{gameId:"g1"}}),
    }],
    pitcher:[
      {player_id:"100",team_id:"117",as_of:"2026-10-05T12:00:00Z",profile_json:JSON.stringify({asOf:"2026-10-05T12:00:00Z",expectedInnings:6.1})},
      {player_id:"200",team_id:"147",as_of:"2026-10-05T12:00:00Z",profile_json:JSON.stringify({asOf:"2026-10-05T12:00:00Z",expectedInnings:5.9})},
    ],
    hitter:[],
  };
  const db={prepare(sql){return{bind(){return this},async all(){
    if(sql.includes("mlb_team_profiles"))return{results:rows.team};
    if(sql.includes("mlb_pitcher_profiles"))return{results:rows.pitcher};
    if(sql.includes("mlb_hitter_profiles"))return{results:rows.hitter};
    return{results:[]};
  }}}};
  const result=await loadMlbPersistentState([{
    id:"g1",home:{mlbId:117},away:{mlbId:147},homeSp:{id:100},awaySp:{id:200},bpp:{batterMatchups:[]}
  }],{DB:db},{maxAgeHours:9999});
  assert.equal(result.meta.teams,2);
  assert.equal(result.meta.pitchers,2);
  assert.equal(result.byGameId.g1.homeStarter.expectedInnings,6.1);
  assert.equal(result.byGameId.g1.homeTeam.bullpen.fatigue.fatigueScore,.4);
});


test("persistent MLB state supplies offense starter and bullpen features without live fanout",()=>{
  const game={id:"g1",sport:"mlb",home:{mlbId:117},away:{mlbId:147},homeSp:{id:100},awaySp:{id:200}};
  const persistent={byGameId:{g1:{
    fresh:true,asOf:"2026-10-05T12:00:00Z",
    homeTeam:{offense:{rpg:4.8,kRate:.22},bullpen:{coreBullpenEra:3.4,adjustedBullpenEra:3.6,fatigue:{fatigueScore:.7}}},
    awayTeam:{offense:{rpg:4.2,kRate:.25},bullpen:{coreBullpenEra:3.8,adjustedBullpenEra:4.0,fatigue:{fatigueScore:.9}}},
    homeStarter:{era:3.1,k9:10.2,kRate:.29,inningsPerStart:5.9,battersFacedPerInning:4.15,starts:28},
    awayStarter:{era:4.0,k9:8.1,kRate:.22,inningsPerStart:5.3,battersFacedPerInning:4.3,starts:26},
  }},meta:{configured:true}};
  const [enriched]=attachMlbPersistentFeatureContext([game],persistent);
  assert.equal(enriched.savant.source,"MLB persistent D1 state");
  assert.equal(enriched.savant.homeRpg,4.8);
  assert.equal(enriched.savant.awaySpEra,4.0);
  assert.equal(enriched.savant.homeOpponentKRate,.25);
  const bullpen=buildPersistentBullpenFeed([game],persistent);
  assert.equal(bullpen.meta.liveFanout,false);
  assert.equal(bullpen.byTeamId["117"].era,3.6);
  assert.equal(bullpen.byTeamId["147"].fatigue.fatigueScore,.9);
});


test("production MLB board disables live Savant feature fanout when D1 is bound",()=>{
  assert.equal(shouldUseLiveMlbFeatureFallback({DB:{prepare(){}}}),false);
  assert.equal(shouldUseLiveMlbFeatureFallback({}),true);
});
