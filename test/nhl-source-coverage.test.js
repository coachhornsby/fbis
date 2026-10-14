import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {nhlModelTeamCode} from "../functions/lib/nhlTeamCodes.js";
import {projectNhlProV2Game} from "../functions/lib/nhlProV2.js";
import {projectNhlV1Game} from "../functions/lib/nhlFbisV1.js";
import {projectNhlResearchGame} from "../functions/lib/nhlResearchModel.js";
import {NHL_PRO_V2_ARTIFACT} from "../data/models/nhl-pro-v2.js";
import {NHL_FBIS_V1_ARTIFACT} from "../data/models/nhl-fbis-v1.js";
import {packNhlEspnMarketObservations,packNhlSoftBookMarketObservations,nhlSourceCompleteness} from "../functions/lib/nhlFreeMarket.js";
import {buildSoftMarketOddsByGame,hydrateOddsFromSoftMarketRows} from "../functions/lib/todayBoard.js";
import {resolveCanonicalMarket} from "../functions/lib/canonical/marketRoles.js";
import {marketLines} from "../src/lib/boardDecision.js";
import {buildNhlCardEvidence} from "../src/lib/nhlCardEvidence.js";
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
 assert.equal(c.zeroPriceRegime,false);
 assert.equal(c.missing.find(x=>x.eventId==="missing").projectionReason,"MISSING_TEAM_CODE");
 const emptyPrices=nhlSourceCompleteness([{...g,id:"a",odds:{}},{...g,id:"b",odds:{}}]);
 assert.equal(emptyPrices.zeroPriceRegime,true);
 assert.equal(emptyPrices.signalClass,"NON_EMPTY_SLATE_ZERO_ML_PAIRS");
 assert.equal(emptyPrices.mlPairs,0);
});
test("SharpAPI soft NHL quotes persist real book names into odds_snapshots rows, never Pinnacle",()=>{
 const soft={...g,odds:{softSource:"sharpapi",moneylineBook:"DraftKings",homeMl:-130,awayMl:+110,
   observedAt:"2026-10-10T22:00:00Z",pinPresent:false}};
 const freezeAt="2026-10-10T23:00:00Z";
 const x=packNhlSoftBookMarketObservations(soft,{date:"2026-10-10",at:freezeAt,checkpoint:"PREGAME"});
 assert.equal(x.rows.length,2);
 assert.ok(x.rows.every(r=>r.book==="DraftKings"&&r.paired===1&&r.market==="ml"));
 // Honest timestamps: capturedAt is FBIS freeze time; sourceObservedAt stays separate.
 assert.equal(x.rows[0].capturedAt,freezeAt);
 assert.equal(x.rows[0].sourceObservedAt,"2026-10-10T22:00:00.000Z");
 assert.equal(packNhlSoftBookMarketObservations({...soft,odds:{...soft.odds,softSource:"espn"}}, {date:"2026-10-10",at:freezeAt}).rows.length,0);
 assert.equal(packNhlSoftBookMarketObservations({...soft,odds:{...soft.odds,pinPresent:true}}, {date:"2026-10-10",at:freezeAt}).rows.length,0);
 assert.equal(packNhlSoftBookMarketObservations({...soft,odds:{...soft.odds,moneylineBook:"Pinnacle"}}, {date:"2026-10-10",at:freezeAt}).rows.length,0);
 assert.equal(packNhlSoftBookMarketObservations(soft,{date:"2026-10-10",at:"2026-10-11T02:01:00Z"}).rows.length,0);
});
test("soft packer never substitutes stale or post-start source clocks into capturedAt",()=>{
 const freezeAt="2026-10-10T23:00:00Z";
 const soft={...g,odds:{softSource:"sharpapi",moneylineBook:"FanDuel",homeMl:-120,awayMl:+100,
   observedAt:"2026-10-11T03:00:00Z",pinPresent:false}};
 const postStart=packNhlSoftBookMarketObservations(soft,{date:"2026-10-10",at:freezeAt});
 assert.equal(postStart.rows.length,2);
 assert.equal(postStart.rows[0].capturedAt,freezeAt);
 assert.equal(postStart.rows[0].sourceObservedAt,null);
 const afterFreeze=packNhlSoftBookMarketObservations({
   ...soft,odds:{...soft.odds,observedAt:"2026-10-10T23:30:00Z"}}, {date:"2026-10-10",at:freezeAt});
 assert.equal(afterFreeze.rows[0].capturedAt,freezeAt);
 assert.equal(afterFreeze.rows[0].sourceObservedAt,null);
 const missing=packNhlSoftBookMarketObservations({
   ...soft,odds:{softSource:"sharpapi",moneylineBook:"FanDuel",homeMl:-120,awayMl:+100,pinPresent:false}},
   {date:"2026-10-10",at:freezeAt});
 assert.equal(missing.rows[0].capturedAt,freezeAt);
 assert.equal(missing.rows[0].sourceObservedAt,null);
});
test("soft market hydrate pairs HOME/AWAY atomically from one book — never cross-book stitch",()=>{
 const ts="2026-10-10T22:00:00Z";
 const mixed=[
  {gameId:"g1",book:"DraftKings",period:"fg",market:"ML",side:"HOME",price:-140,capturedAt:ts},
  {gameId:"g1",book:"FanDuel",period:"fg",market:"ML",side:"AWAY",price:120,capturedAt:ts},
 ];
 assert.equal(buildSoftMarketOddsByGame(mixed).has("g1"),false);
 const complete=[
  ...mixed,
  {gameId:"g1",book:"DraftKings",period:"fg",market:"ML",side:"AWAY",price:120,capturedAt:ts},
  {gameId:"g1",book:"FanDuel",period:"fg",market:"ML",side:"HOME",price:-135,capturedAt:"2026-10-10T21:00:00Z"},
  {gameId:"g1",book:"FanDuel",period:"fg",market:"ML",side:"AWAY",price:115,capturedAt:"2026-10-10T21:00:00Z"},
 ];
 const pack=buildSoftMarketOddsByGame(complete).get("g1");
 assert.equal(pack.book,"DraftKings");
 assert.equal(pack.homeMl,-140);
 assert.equal(pack.awayMl,120);
});
test("soft hydrate preserves Pinnacle presence and coexists with soft display quotes",()=>{
 const softPack={book:"DraftKings",homeMl:-130,awayMl:110,at:1};
 const withPin=hydrateOddsFromSoftMarketRows(
  {id:"g1",odds:{pinPresent:true,pinHomeMl:-125,pinAwayMl:105}}, softPack);
 assert.equal(withPin.odds.pinPresent,true);
 assert.equal(withPin.odds.pinHomeMl,-125);
 assert.equal(withPin.odds.pinAwayMl,105);
 assert.equal(withPin.odds.homeMl,-130);
 assert.equal(withPin.odds.awayMl,110);
 assert.equal(withPin.odds.moneylineBook,"DraftKings");
 const pinPairOnly=hydrateOddsFromSoftMarketRows(
  {id:"g1",odds:{pinHomeMl:-125,pinAwayMl:105}}, softPack);
 assert.notEqual(pinPairOnly.odds.pinPresent,false);
 assert.equal(pinPairOnly.odds.pinHomeMl,-125);
 const softOnly=hydrateOddsFromSoftMarketRows({id:"g1",odds:{}}, softPack);
 assert.equal(softOnly.odds.pinPresent,false);
 assert.equal(softOnly.odds.homeMl,-130);
});
test("snapshot→hydrate→canonical: Case A odds_snapshot_soft DK pair is recognized, freshness UNKNOWN",()=>{
 const rows=[
  {gameId:"espn401",book:"DraftKings",period:"fg",market:"ML",side:"HOME",price:-130,capturedAt:"2026-10-10T23:00:00Z"},
  {gameId:"espn401",book:"DraftKings",period:"fg",market:"ML",side:"AWAY",price:110,capturedAt:"2026-10-10T23:00:00Z"},
 ];
 const pack=buildSoftMarketOddsByGame(rows).get("espn401");
 const hydrated=hydrateOddsFromSoftMarketRows(
  {id:"espn401",sport:"nhl",asOf:"2026-10-10T23:05:00Z",odds:{}}, pack);
 assert.equal(hydrated.odds.softSource,"odds_snapshot_soft");
 assert.equal(hydrated.odds.sourceTimestampUnverified,true);
 assert.equal(hydrated.odds.observedAt,null);
 const canonical=resolveCanonicalMarket(hydrated,{now:Date.parse("2026-10-10T23:10:00Z")});
 assert.equal(canonical.consensus.source,"ODDS_SNAPSHOT_SOFT");
 assert.equal(canonical.consensus.bookmaker,"DraftKings");
 assert.deepEqual(canonical.consensus.moneyline,{home:-130,away:110});
 assert.equal(canonical.consensus.executable,false);
 assert.equal(canonical.consensus.freshness,"UNKNOWN");
 assert.equal(canonical.consensus.observedAt,null);
 assert.equal(canonical.execution.available,false);
 const lines=marketLines({...hydrated,market:canonical});
 assert.equal(lines.homeMl,-130);assert.equal(lines.awayMl,110);
 assert.equal(lines.book,"DraftKings");
 assert.equal(lines.observedOnly,true);
 assert.equal(lines.marketRole,"CONSENSUS_MARKET");
});
test("snapshot→hydrate→canonical: Case B DK hydrate clears ESPN classification",()=>{
 const rows=[
  {gameId:"espn401",book:"DraftKings",period:"fg",market:"ML",side:"HOME",price:-140,capturedAt:"2026-10-10T22:00:00Z"},
  {gameId:"espn401",book:"DraftKings",period:"fg",market:"ML",side:"AWAY",price:120,capturedAt:"2026-10-10T22:00:00Z"},
 ];
 const pack=buildSoftMarketOddsByGame(rows).get("espn401");
 const hydrated=hydrateOddsFromSoftMarketRows({
  id:"espn401",sport:"nhl",
  odds:{softSource:"espn",nhlEspnObserved:true,observedAt:"2026-10-10T20:00:00Z"},
 }, pack);
 assert.equal(hydrated.odds.softSource,"odds_snapshot_soft");
 assert.equal(hydrated.odds.nhlEspnObserved,false);
 assert.equal(hydrated.odds.moneylineBook,"DraftKings");
 assert.equal(hydrated.odds.homeMl,-140);
 assert.equal(hydrated.odds.awayMl,120);
 const canonical=resolveCanonicalMarket(hydrated,{now:Date.parse("2026-10-10T23:00:00Z")});
 assert.equal(canonical.consensus.source,"ODDS_SNAPSHOT_SOFT");
 assert.notEqual(canonical.consensus.source,"OBSERVED_ESPN");
 assert.equal(canonical.consensus.bookmaker,"DraftKings");
 assert.deepEqual(canonical.consensus.moneyline,{home:-140,away:120});
 assert.equal(canonical.consensus.freshness,"UNKNOWN");
 const lines=marketLines({...hydrated,market:canonical});
 assert.equal(lines.book,"DraftKings");
 assert.equal(lines.homeMl,-140);
 assert.notEqual(lines.book,"OBSERVED_ESPN");
});
test("NHL production market calls are retired and only PinnOdds captures can reach CURRENT board",async()=>{
 const src=await readFile(new URL("../functions/lib/slateEngineCore.js",import.meta.url),"utf8");
 const today=await readFile(new URL("../functions/lib/todayBoard.js",import.meta.url),"utf8");
 const api=await readFile(new URL("../functions/api/nhl-free-odds-collect.js",import.meta.url),"utf8");
 assert.doesNotMatch(src,/await fetchParlayOdds\(/);
 assert.doesNotMatch(src,/await attachKalshiSentiment\(/);
 assert.match(src,/PINNODDS_LEDGER_ONLY/);
 assert.match(today,/pinnoddsOnlySlateMarket/);
 assert.match(today,/loadPinnoddsBoardResearch/);
 assert.match(api,/retiredOddsCollectorResponse/);
});
test("board labels observed ESPN full-game ML as non-execution source, not Pinnacle or certified EV",()=>{
 const odds={...g.odds,nhlEspnObserved:true};
 const evt={...g,odds};
 const canonical=resolveCanonicalMarket(evt,{now:Date.parse("2026-10-11T00:30:00Z")});
 assert.equal(canonical.consensus.source,"OBSERVED_ESPN");
 assert.deepEqual(canonical.consensus.moneyline,{home:-125,away:115});
 assert.equal(canonical.consensus.executable,false);
 assert.equal(canonical.execution.available,false);
 const lines=marketLines({...evt,market:canonical});
 assert.equal(lines.homeMl,-125);assert.equal(lines.awayMl,115);
 assert.equal(lines.observedOnly,true);
 const displayed=buildNhlCardEvidence(evt,{sport:"nhl",away:{abbr:"ANA"},home:{abbr:"CGY"},market:lines,action:{available:false}});
 assert.equal(displayed.market.book,"OBSERVED_ESPN");
 assert.match(displayed.market.role,/NOT EXECUTABLE/);
 assert.equal(displayed.qualified,false);
});
test("unpaired ESPN moneylines cannot leak into canonical market ML field",()=>{
 const odds={...g.odds,awayMl:null,nhlEspnObserved:true};
 const evt={...g,odds};
 const lines=marketLines({...evt,market:resolveCanonicalMarket(evt)});
 assert.equal(lines.homeMl,null);assert.equal(lines.awayMl,null);
});
