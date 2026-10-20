import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { selectNhlCardProps } from "../src/lib/nhlCardProps.js";
import { nhlPlayerProV2RowsForSide } from "../functions/lib/nhlPlayerProV2.js";

const start="2026-10-12T01:00:00Z",early=Date.parse("2026-10-11T23:00:00Z");
const game=()=>({
  id:"401892481",sport:"nhl",start,
  home:{abbr:"VGK"},away:{abbr:"LA"},
  nhlProV2:{ok:true,projHome:3.4,projAway:3.1},
  playerProjectionRows:[
    {eventId:"401892481",team:"LA",playerId:"10",playerName:"Away Shooter",market:"shots_on_goal",fbisProjection:3.71,independent:true,marketInformed:false,propGate:"HOLD"},
    {eventId:"401892481",team:"VGK",playerId:"20",playerName:"Home Shooter",market:"shots_on_goal",fbisProjection:3.05,independent:true,marketInformed:false,propGate:"HOLD"},
    {eventId:"401892481",team:"VGK",playerId:"20",playerName:"Home Shooter",market:"points",fbisProjection:1.2,independent:true,marketInformed:false,propGate:"HOLD"}
  ]
});
test("cards show two independent skaters, representing both teams, without inventing props",()=>{
 const rows=selectNhlCardProps(game(),{now:early});
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(x=>x.player),["Away Shooter","Home Shooter"]);
 assert.deepEqual(rows.map(x=>x.projection),[3.7,3.1]);
 assert.ok(rows.every(x=>x.researchOnly&&x.qualified===false));
});
test("no model, no player/event identity, out or market-informed player never becomes a displayed prop",()=>{
 const g=game();
 assert.deepEqual(selectNhlCardProps({...g,nhlProV2:{ok:false}}, {now:early}),[]);
 g.playerProjectionRows[0].eventId="different-event";
 g.playerProjectionRows[1].marketInformed=true;
 const fallback=selectNhlCardProps(g,{now:early});
 assert.equal(fallback.length,1); // The independent points forecast remains valid research context.
 assert.equal(fallback[0].market,"points");
 g.playerProjectionRows[2].propGate="BLOCKED";
 assert.deepEqual(selectNhlCardProps(g,{now:early}),[]);
});
test("no retrospective in-play or final projections without explicit PIT pregame lock",()=>{
 const g=game();
 assert.deepEqual(selectNhlCardProps(g,{now:Date.parse(start)+2000,live:true}),[]);
 assert.deepEqual(selectNhlCardProps(g,{now:Date.parse(start)+360000,final:true}),[]);
 const pit={...g.playerProjectionRows[0],projectionLockAt:"2026-10-11T22:00:00Z",pointInTimeVerified:true};
 const r=selectNhlCardProps({...g,playerProjectionRows:[pit]},{now:Date.parse(start)+2000,live:true});
 assert.equal(r.length,1);
 assert.equal(r[0].player,"Away Shooter");
 assert.equal(r[0].historical,true);
});
test("official LAK skater source resolves ESPN LA and keeps display/event identity",()=>{
 const g=game();
 const ctx={
  teams:{LAK:{gfpg:3.1,shotFor:31,shotsFor:31},VGK:{gapg:3.0,shotsAgainst:29}},
  skatersByTeam:{LAK:[
    {id:"player-10",name:"Away Shooter",position:"F",shotsPerGame:3.5,goalsPerGame:.4,assistsPerGame:.5,pointsPerGame:.9}
  ]},
  currentGoalies:[],priorGoalies:[],persistentProfiles:{teams:{},players:{}}
 };
 const rows=nhlPlayerProV2RowsForSide(g,"away",ctx);
 assert.ok(rows.some(x=>x.market==="shots_on_goal"&&x.team==="LA"&&x.player.name==="Away Shooter"));
 assert.ok(rows.every(x=>Number.isFinite(x.projection)));
});
test("both NHL card routes use the same concise card without changing other sports",async()=>{
 const [compact,premium,card]=await Promise.all([
  readFile(new URL("../src/components/board/CompactGameCard.jsx",import.meta.url),"utf8"),
  readFile(new URL("../src/components/board/PremiumGameCard.jsx",import.meta.url),"utf8"),
  readFile(new URL("../src/components/board/NhlDecisionCard.jsx",import.meta.url),"utf8")
 ]);
 assert.doesNotMatch(compact,/if \(isNhl\) return <NhlDecisionCard/);
 assert.doesNotMatch(premium,/if \(sportId === "nhl"\) return <><NhlDecisionCard/);
 assert.match(card,/selectNhlCardProps/);
 assert.doesNotMatch(card,/BEST EDGE|NO EDGE|PROBABILITY UNVERIFIED · INTEGRITY HOLD/);
});

test("NHL premium hero retains model-market gap and provenance guard without altering player props",async()=>{
 const [card,style]=await Promise.all([
  readFile(new URL("../src/components/board/NhlDecisionCard.jsx",import.meta.url),"utf8"),
  readFile(new URL("../src/components/board/nhlDecisionCard.css",import.meta.url),"utf8")
 ]);
 assert.match(card,/MODEL–MARKET GAP/);
 assert.match(card,/FBIS WIN PROBABILITY/);
 assert.match(card,/MARKET NO-VIG/);
 assert.match(card,/PIT-AUDITED RESEARCH/);
 assert.match(card,/ARCHIVED SNAPSHOT · NOT CURRENT/);
 assert.match(card,/selectNhlCardProps/);
 assert.match(style,/nhlc-edge-hero/);
 assert.match(style,/nhlc-matchup-premium/);
});

test("NHL cards retain original branded hero while the redundant props panel moves to the dedicated player-props workflow",async()=>{
 const [compact,premium,props]=await Promise.all([
 readFile(new URL("../src/components/board/CompactGameCard.jsx",import.meta.url),"utf8"),
 readFile(new URL("../src/components/board/PremiumGameCard.jsx",import.meta.url),"utf8"),
 readFile(new URL("../src/components/board/NhlPlayerProjectionStrip.jsx",import.meta.url),"utf8")
 ]);
 assert.match(compact,/cgc-team-atmosphere/);
 assert.match(compact,/cgc-best-edge/);
 assert.match(compact,/bestValuePresentation\(game,\s*vm\)/);
  assert.match(compact,/valueChoice\.value/);
 // SoftMatch: NHL betting intelligence is featured/premium-only; compact stays lean.
 assert.doesNotMatch(compact,/<NhlBettingIntelligence game=\{game\} vm=\{vm\}/);
 assert.match(premium,/<NhlBettingIntelligence game=\{game\} vm=\{vm\}/);
 assert.match(premium,/<NhlMatchupSignals game=\{game\}/);
 assert.doesNotMatch(compact,/<NhlEvidenceStrip/);
 assert.doesNotMatch(compact,/<NhlPlayerProjectionStrip/);
 assert.match(props,/selectNhlCardProps/);
});
