import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildNhlCardEvidence } from "../src/lib/nhlCardEvidence.js";
import { attachNhlCardStarterEvidence, nhlOfficialEventCrosswalk } from "../functions/lib/nhlCardStarterEvidence.js";
import { bestEdge } from "../src/lib/boardEvidence.js";

function game(){
  return {sport:"nhl",id:"nhl-test",start:"2026-10-10T23:00:00Z",home:{abbr:"CGY"},away:{abbr:"ANA"},
    nhlProV2:{ok:true,modelId:"NHL-PRO-v2",modelVersion:"research-v2",
      home:"CGY",away:"ANA",projHome:3.3,projAway:3.1,
      probability:{homeWinIncludingOt:.543,awayWinIncludingOt:.457},
      layers:{goalie:{home:{name:"Goalie C",goalieId:"12"},away:{name:"Goalie A",goalieId:"16"}}}},
    nhlUnifiedMoneylineShadow:{probabilityAudit:{ok:true}},
    nhlGoalieProbabilityShadow:{starterEvidence:{home:{state:"CONFIRMED_STARTER",lineupMatched:true,evidenceAt:"2026-10-10T18:00:00Z"},away:{state:"EXPECTED_G1",lineupMatched:true}}},
    matchupFactors:[{id:"five-v-five",label:"5v5 xG",available:true}],
  };
}
function view(){return {sport:"nhl",away:{abbr:"ANA"},home:{abbr:"CGY"},market:{homeMl:-120,awayMl:+110,role:"REFERENCE_MARKET",book:"Pinnacle"},action:{available:false}};}
test("NHL card reports researched probabilities, reference quote, and each goalie status without granting authority",()=>{
  const e=buildNhlCardEvidence(game(),view());
  assert.equal(e.moneyline.valid,true);
  assert.equal(e.moneyline.home,"54.3%");
  assert.equal(e.moneyline.away,"45.7%");
  assert.equal(e.market.home,"-120");
  assert.equal(e.market.away,"+110");
  assert.equal(e.market.role,"REFERENCE ONLY");
  assert.equal(e.goalies.home.state,"CONFIRMED");
  assert.equal(e.goalies.away.state,"PROJECTED");
  assert.equal(e.qualified,false);
  assert.equal(e.researchOnly,true);
  assert.equal(e.coverage.action,"UNAVAILABLE");
});
test("NHL moneyline integrity hold suppresses apparently attractive percentages",()=>{
  const g=game();g.nhlUnifiedMoneylineShadow.probabilityAudit={ok:false,reasons:["HOME_AWAY_IDENTITY_MISMATCH"]};
  const e=buildNhlCardEvidence(g,view());assert.equal(e.moneyline.valid,false);
  assert.equal(e.moneyline.home,null);assert.equal(e.moneyline.integrity,"INTEGRITY HOLD");
});
test("NHL game identity mismatch is not treated as a reliable moneyline",()=>{
  const g=game();g.nhlProV2.home="ANA";
  assert.equal(buildNhlCardEvidence(g,view()).moneyline.valid,false);
});
test("NHL missing scores, market and goalies stay explicit and never become zero prices",()=>{
  const g={sport:"nhl",home:{abbr:"CGY"},away:{abbr:"ANA"}};
  const v={sport:"nhl",home:{abbr:"CGY"},away:{abbr:"ANA"},market:{},action:{available:false}};
  const e=buildNhlCardEvidence(g,v);
  assert.equal(e.moneyline.valid,false);assert.equal(e.market.role,"NO TIMESTAMPED MONEYLINE QUOTE");
  assert.equal(e.coverage.projection,"UNAVAILABLE");assert.equal(e.coverage.goalies,"UNAVAILABLE");
  assert.equal(e.market.home,"—");
});
test("historical moneyline snapshot is labeled archived, never current execution",()=>{
  const g=game();g.marketLineHistory=[
    {market:"ml",selection:"home",sportsbook:"Reference",americanPrice:-112,collectedAt:"2026-10-10T16:00:00Z"},
    {market:"ml",selection:"away",sportsbook:"Reference",americanPrice:102,collectedAt:"2026-10-10T16:00:00Z"},
    {market:"ml",selection:"home",sportsbook:"Reference",americanPrice:-500,collectedAt:"2026-10-11T01:00:00Z"}
  ];
  const v={...view(),market:{}};
  const e=buildNhlCardEvidence(g,v);
  assert.equal(e.market.home,"-112");assert.equal(e.market.away,"+102");
  assert.match(e.market.role,/ARCHIVED/);assert.equal(e.coverage.moneyline,"HISTORICAL_ONLY");
});
test("missing model or market means unevaluated, not NO EDGE",()=>{
  const base={projection:{available:false},market:{available:false,referenceOnly:false},comparison:{}};
  assert.equal(bestEdge(base).detail,"NO INDEPENDENT MODEL");
  assert.equal(bestEdge({...base,projection:{available:true}}).detail,"NO CURRENT MARKET");
  assert.equal(bestEdge({...base,projection:{available:true},market:{available:true}}).detail,"NO COMPARABLE LINE");
});
test("NHL compact and expanded cards share evidence contract and avoid unconditional edge badges",async()=>{
  const compact=await readFile(new URL("../src/components/board/CompactGameCard.jsx",import.meta.url),"utf8");
  const premium=await readFile(new URL("../src/components/board/PremiumGameCard.jsx",import.meta.url),"utf8");
  const component=await readFile(new URL("../src/components/board/NhlBettingIntelligence.jsx",import.meta.url),"utf8");
  for(const code of [compact,premium]) {
    assert.match(code,/NhlBettingIntelligence/);
    assert.match(code,/[Mm]odel \/ market gap|MODEL \/ MARKET GAP/);
    assert.doesNotMatch(code,/<NhlEvidenceStrip/);
    assert.doesNotMatch(code,/<NhlPlayerProjectionStrip/);
  }
  assert.match(component,/RESEARCH ONLY/);
  assert.match(component,/const NA="N\/A"/);
  assert.doesNotMatch(component,/canAuthorizeWager\s*:\s*true/);
  assert.match(compact,/LIVE SCORE NOT AVAILABLE FROM FEED/);
  assert.match(premium,/LIVE SCORE NOT AVAILABLE FROM FEED/);
});

test("point-in-time persisted goalie profiles enrich every NHL card without changing forecasts",()=>{
  const g={sport:"nhl",id:"401892479",start:"2026-10-10T23:00:00Z",
    home:{abbr:"VGK"},away:{abbr:"LA"},odds:{total:6.5}};
  const profiles={teams:{vgk:{next_game_id:"401892479",next_game_start:g.start},la:{next_game_id:"401892479",next_game_start:g.start}},
    goalies:{
      vgk:[{player_id:"100",player_name:"Expected Vegas Goalie",goalie_state:"EXPECTED_G1",team_key:"vgk",expected_start_probability:.7,source_updated_at:"2026-10-10T16:00:00Z"}],
      la:[{player_id:"200",player_name:"Expected LA Goalie",goalie_state:"EXPECTED_G1",team_key:"la",expected_start_probability:.6,source_updated_at:"2026-10-10T16:00:00Z"}]}};
  const result=attachNhlCardStarterEvidence([g],profiles,Date.parse("2026-10-10T19:00:00Z"));
  const enriched=result.games[0];
  assert.equal(enriched.nhlStarterEvidence.home.name,"Expected Vegas Goalie");
  assert.equal(enriched.nhlStarterEvidence.away.name,"Expected LA Goalie");
  assert.equal(enriched.nhlStarterEvidence.home.state,"PROJECTED");
  assert.equal(enriched.nhlStarterEvidence.canQualify,false);
  assert.equal(enriched.odds,g.odds);
  const vm={sport:"nhl",home:{abbr:"VGK"},away:{abbr:"LA"},market:{},action:{available:false}};
  const card=buildNhlCardEvidence(enriched,vm);
  assert.equal(card.goalies.home.name,"Expected Vegas Goalie");
  assert.equal(card.goalies.away.state,"PROJECTED");
  assert.equal(card.coverage.projection,"UNAVAILABLE");
});
test("stale or unrelated goalie rows never become confirmed current-game starters",()=>{
  const game={sport:"nhl",id:"new-game",start:"2026-10-10T23:00:00Z",home:{abbr:"CGY"},away:{abbr:"ANA"}};
  const profiles={teams:{cgy:{next_game_id:"previous-game"}},goalies:{cgy:[{
    player_id:"12",player_name:"Prior Starter",team_key:"cgy",goalie_state:"LAST_CONFIRMED_STARTER",
    source_updated_at:"2026-10-10T16:00:00Z"}]}};
  const x=attachNhlCardStarterEvidence([game],profiles,Date.parse("2026-10-10T20:00:00Z")).games[0];
  assert.equal(x.nhlStarterEvidence.home.state,"HISTORICAL_PROXY_UNVERIFIED");
  assert.equal(x.nhlStarterEvidence.home.name,null);
});

test("official NHL game ID crosswalk recovers expected starters on ESPN-identified matchup",()=>{
 const start="2026-10-11T02:00:00Z",updated="2026-10-10T23:44:00Z",now=Date.parse("2026-10-11T01:20:00Z");
 const game={sport:"nhl",id:"401892481",start,home:{abbr:"VGK"},away:{abbr:"LA"},modelVersion:"FBIS-v1.4"};
 const teams={
  vgk:{next_game_id:"2026020083",next_game_start:start,next_opponent_key:"la",next_site:"HOME",source_updated_at:updated},
  la:{next_game_id:"2026020083",next_game_start:start,next_opponent_key:"vgk",next_site:"ROAD",source_updated_at:updated}
 };
 const profiles={teams,goalies:{
  vgk:[{player_id:"100",player_name:"Projected Goalie",goalie_state:"EXPECTED_G1",team_key:"vgk",expected_start_probability:.7,source_updated_at:updated}],
  la:[{player_id:"200",player_name:"Previous Starter",goalie_state:"LAST_CONFIRMED_STARTER",team_key:"la",hierarchy_rank:1,expected_start_probability:.7,source_updated_at:updated}],
 }};
 const cross=nhlOfficialEventCrosswalk(game,profiles,now);
 assert.equal(cross.officialGameId,"2026020083");
 const attached=attachNhlCardStarterEvidence([game],profiles,now).games[0];
 assert.equal(attached.nhlStarterEvidence.home.name,"Projected Goalie");
 assert.equal(attached.nhlStarterEvidence.home.state,"PROJECTED");
 assert.equal(attached.nhlStarterEvidence.away.name,"Previous Starter");
 assert.equal(attached.nhlStarterEvidence.away.state,"PRIOR_GAME_STARTER_UNVERIFIED");
 assert.equal(attached.nhlStarterEvidence.away.eventIdentity.officialGameId,"2026020083");
 assert.equal(attached.nhlStarterEvidence.modelInputsChanged,false);
 assert.equal(attached.nhlStarterEvidence.canQualify,false);
 const vm={sport:"nhl",home:{abbr:"VGK"},away:{abbr:"LA"},market:{total:6.5},action:{available:false}};
 const display=buildNhlCardEvidence(attached,vm);
 assert.equal(display.goalies.home.state,"PROJECTED");
 assert.equal(display.goalies.away.state,"PREVIOUS GAME · NOT CONFIRMED TODAY");
 assert.equal(display.coverage.goalies,"CONTEXT_ONLY");
 assert.equal(display.coverage.projection,"UNAVAILABLE");
});
test("crosswalk fails closed on wrong opponent, swapped home/road, stale and post-start observations",()=>{
 const start="2026-10-11T02:00:00Z";
 const g={sport:"nhl",id:"espn123",start,home:{abbr:"CGY"},away:{abbr:"ANA"}};
 const rows={teams:{
  cgy:{next_game_id:"nhl-true",next_game_start:start,next_opponent_key:"ana",next_site:"HOME",source_updated_at:"2026-10-10T23:20:00Z"},
  ana:{next_game_id:"nhl-true",next_game_start:start,next_opponent_key:"cgy",next_site:"ROAD",source_updated_at:"2026-10-10T23:20:00Z"}
 }};
 const now=Date.parse("2026-10-11T01:00:00Z");
 assert.equal(nhlOfficialEventCrosswalk(g,rows,now).officialGameId,"nhl-true");
 for(const field of ["next_opponent_key","next_site","next_game_id","next_game_start","source_updated_at"]){
  const bad=JSON.parse(JSON.stringify(rows));
  bad.teams.cgy[field]=field==="next_opponent_key"?"vgk":field==="next_site"?"ROAD":field==="next_game_id"?"other":field==="next_game_start"?"2026-10-11T04:00:00Z":"2026-10-11T03:00:00Z";
  assert.equal(nhlOfficialEventCrosswalk(g,bad,now),null,field);
 }
});
test("NHL compact card never advertises a legacy implied score as independent model",async()=>{
 const code=await readFile(new URL("../src/components/board/CompactGameCard.jsx",import.meta.url),"utf8");
 assert.match(code,/NO INDEPENDENT NHL MODEL/);
 assert.match(code,/MODEL \/ REFERENCE GAP/);
 assert.match(code,/PREGAME PROJ/);
});

test("NHL goalie context presents independently labeled sides and responsive source tiles",async()=>{
 const {readFile}=await import("node:fs/promises");
 const jsx=await readFile(new URL("../src/components/board/NhlEvidenceStrip.jsx",import.meta.url),"utf8");
 const css=await readFile(new URL("../src/components/board/nhlEvidenceStrip.css",import.meta.url),"utf8");
 assert.match(jsx,/nhl-goalie-pair/);
 assert.match(jsx,/Starter not identified/);
 assert.match(jsx,/e\.goalies\[side\]\.state/);
 assert.match(css,/auto-fit,minmax/);
 assert.match(css,/nhl-goalie-side/);
});
