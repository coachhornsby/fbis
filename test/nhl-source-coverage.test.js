import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {nhlModelTeamCode} from "../functions/lib/nhlTeamCodes.js";
import {projectNhlProV2Game} from "../functions/lib/nhlProV2.js";
import {projectNhlV1Game} from "../functions/lib/nhlFbisV1.js";
import {projectNhlResearchGame} from "../functions/lib/nhlResearchModel.js";
import {NHL_PRO_V2_ARTIFACT} from "../data/models/nhl-pro-v2.js";
import {NHL_FBIS_V1_ARTIFACT} from "../data/models/nhl-fbis-v1.js";
import {packNhlEspnMarketObservations,nhlSourceCompleteness} from "../functions/lib/nhlFreeMarket.js";
const pairs=[["LA","LAK","VGK"],["SJ","SJS","EDM"],["TB","TBL","NYI"],["NJ","NJD","VAN"]];
test("ESPN aliases map only model feature inputs, leaving ESPN event identities intact",()=>{
 for(const [raw,official] of pairs)assert.equal(nhlModelTeamCode(raw),official);
 for(const s of ["TOR","ANA","CGY","UTA","VGK","BOS","NYI","NYR"])assert.equal(nhlModelTeamCode(s),s);
});
test("every previously missing alias fixture yields a market-free NHL PRO projection",()=>{
 for(const [raw,official,opponent] of pairs){
  const game={id:"espn-"+raw,sport:"nhl",start:"2026-10-11T02:00:00Z",
    home:{abbr:raw},away:{abbr:opponent},odds:{}};
  const base={ok:true,teams:{
    [official]:{games:0,gfpg:3.1,gapg:3.0},
    [opponent]:{games:0,gfpg:3.05,gapg:3.0}
  },currentGoalies:[],priorGoalies:[],skatersByTeam:{},schedule:[]};
  const ctx={ok:true,base,artifact:NHL_PRO_V2_ARTIFACT,edge:{},persistentProfiles:{teams:{},goalies:{}},
    sourceLineage:{asOf:"2026-10-10T19:00:00Z"}};
  const p=projectNhlProV2Game(game,ctx);
  assert.equal(p.ok,true,raw);
  assert.equal(p.home,raw,raw);assert.equal(p.away,opponent,raw);
  assert.equal(p.modelHomeCode,official,raw);
  assert.ok(Number.isFinite(p.projHome)&&Number.isFinite(p.projAway),raw);
  assert.ok(Math.abs(p.probability.homeWinIncludingOt+p.probability.awayWinIncludingOt-1)<.001);
  assert.equal(p.marketInformed,false);assert.equal(p.canAuthorizeWager,false);
  const changed=projectNhlProV2Game({...game,odds:{homeMl:-240,awayMl:+230}},ctx);
  assert.equal(changed.projHome,p.projHome,raw);
  assert.equal(changed.probability.homeWinIncludingOt,p.probability.homeWinIncludingOt,raw);
 }
});
test("NHL v1 and official team priors also resolve alias source teams without conflating identities",()=>{
 for(const [raw,official,opponent] of pairs){
  const game={id:"alias-"+raw,sport:"nhl",start:"2026-10-11T02:00:00Z",home:{abbr:raw},away:{abbr:opponent},odds:{}};
  const teams={[official]:{games:0,gfpg:3.1,gapg:3,pp:.2,pk:.8},[opponent]:{games:0,gfpg:3,gapg:3.1,pp:.2,pk:.8}};
  const v1=projectNhlV1Game(game,{ok:true,teams,artifact:NHL_FBIS_V1_ARTIFACT,currentGoalies:[],priorGoalies:[],schedule:[]});
  assert.equal(v1.ok,true,raw);
  const prior=projectNhlResearchGame(game,{ok:true,leagueAvgGoals:3.05,seasonId:"20252026",byAbbr:{
    [official]:{goalsForPerGame:3.1,goalsAgainstPerGame:3},
    [opponent]:{goalsForPerGame:3,goalsAgainstPerGame:3.1}
  }});
  assert.equal(prior.ok,true,raw);
  assert.equal(prior.homeAbbr,raw);
 }
});
const g={id:"espn401",sport:"nhl",start:"2026-10-11T02:00:00Z",
 home:{abbr:"CGY"},away:{abbr:"ANA"},
 odds:{softSource:"espn",homeMl:-125,awayMl:+115,total:6.5,spread:-1.5}};
test("free NHL scoreboard quote persists a two-sided ESPN REFERENCE pair, not Pinnacle",()=>{
 const x=packNhlEspnMarketObservations(g,{date:"2026-10-10",at:"2026-10-11T00:30:00Z",checkpoint:"PREGAME"});
 assert.equal(x.rows.length,2);assert.deepEqual(x.rows.map(x=>x.side),["HOME","AWAY"]);
 assert.ok(x.rows.every(r=>r.book==="ESPN_FEED_REFERENCE"&&r.paired===1&&!r.rejectedPostStart));
 assert.ok(Math.abs(x.rows[0].noVig+x.rows[1].noVig-1)<.0001);
 assert.equal(x.rows[0].price,-125);assert.equal(x.rows[1].price,115);
});
test("no free source quote is fabricated after start, on partial prices or other-book provenance",()=>{
 const opts={date:"2026-10-10",at:"2026-10-11T02:01:00Z"};
 assert.equal(packNhlEspnMarketObservations(g,opts).rows.length,0);
 assert.equal(packNhlEspnMarketObservations({...g,odds:{softSource:"espn",homeMl:-125}}, {...opts,at:"2026-10-10T23:30:00Z"}).rows.length,0);
 assert.equal(packNhlEspnMarketObservations({...g,odds:{...g.odds,pinPresent:true}}, {...opts,at:"2026-10-10T23:30:00Z"}).rows.length,0);
 assert.equal(packNhlEspnMarketObservations({...g,odds:{...g.odds,homeMl:800,awayMl:800}}, {...opts,at:"2026-10-10T23:30:00Z"}).rows.length,0);
});
test("NHL collector completeness is explicit without granting wager authority",()=>{
 const rows=[{...g,nhlProV2:{ok:true},nhlStarterEvidence:{home:{state:"PROJECTED"},away:{state:"CONFIRMED"}}},
   {...g,id:"missing",odds:{},nhlProV2:{ok:false,reason:"MISSING_TEAM_CODE"}}];
 const c=nhlSourceCompleteness(rows);
 assert.equal(c.scheduled,2);assert.equal(c.pure,1);assert.equal(c.mlPairs,1);
 assert.equal(c.missing.find(x=>x.eventId==="missing").projectionReason,"MISSING_TEAM_CODE");
});
test("NHL provider mapping is disabled for paid collection unless separately opted in",async()=>{
 const src=await readFile(new URL("../functions/lib/slateEngineCore.js",import.meta.url),"utf8");
 const parlay=await readFile(new URL("../functions/lib/parlay.js",import.meta.url),"utf8");
 const today=await readFile(new URL("../functions/lib/todayBoard.js",import.meta.url),"utf8");
 assert.match(src,/NHL_ODDS_PROVIDER_OPT_IN/);
 assert.match(src,/strictCacheOnly:[\s\S]*NHL_ODDS_PROVIDER_OPT_IN/);
 assert.match(parlay,/nhl: "icehockey_nhl"/);
 assert.match(today,/String\(row\.book\|\|""\) !== "Pinnacle"/);
});
