import test from "node:test";
import assert from "node:assert/strict";
import {
  projectSoccerForm,
  projectSoccerFromHistory,
  buildScoreMatrix,
  soccerSeasonYear,
  SOCCER_FBIS_ID,
  SOCCER_LEAGUES,
  soccerConfidencePick,
} from "../functions/lib/soccerFbisV1.js";
import { SPORTS, BOARD_SPORTS } from "../functions/lib/slateEngineCore.js";

test("soccer seven-league board is registered",()=>{
  assert.equal(SPORTS.soccer.id,"soccer");
  assert.ok(BOARD_SPORTS.includes("soccer"));
  assert.deepEqual(SOCCER_LEAGUES,["eng.1","esp.1","ger.1","ita.1","fra.1","usa.1","usa.nwsl"]);
});

test("soccer season keys respect split-year Europe and calendar-year MLS/NWSL",()=>{
  assert.equal(soccerSeasonYear(new Date("2026-02-01T12:00:00Z"),"eng.1"),2025);
  assert.equal(soccerSeasonYear(new Date("2026-09-01T12:00:00Z"),"eng.1"),2026);
  assert.equal(soccerSeasonYear(new Date("2026-02-01T12:00:00Z"),"usa.1"),2026);
  assert.equal(soccerSeasonYear(new Date("2026-02-01T12:00:00Z"),"usa.nwsl"),2026);
});

test("Dixon-Coles score matrix is normalized",()=>{
  const cells=buildScoreMatrix(1.6,1.1,{rho:-0.08});
  const total=cells.reduce((s,x)=>s+x.p,0);
  assert.ok(Math.abs(total-1)<1e-10);
  assert.ok(cells.every(x=>x.p>=0));
});

test("Soccer-FBIS-v1 legacy fallback is independent and research-only",()=>{
  const p=projectSoccerForm({neutralSite:false},{
    homePrior:{games:38,pointsFor:70,pointsAgainst:35},
    awayPrior:{games:38,pointsFor:48,pointsAgainst:49},
    homeCurrent:{games:7,pointsFor:15,pointsAgainst:7},
    awayCurrent:{games:7,pointsFor:8,pointsAgainst:11},
  });
  assert.equal(p.ok,true);
  assert.equal(p.modelId,SOCCER_FBIS_ID);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
  assert.ok(p.pHomeWin>p.pAwayWin);
  assert.ok(Math.abs(p.pHomeWin+p.pDraw+p.pAwayWin-1)<1e-8);
  assert.ok(p.pBttsYes>0&&p.pBttsYes<1);
  assert.ok(p.totals["2.5"].over>0&&p.totals["2.5"].over<1);
});

test("canonical history projection is point-in-time and ignores future rows",()=>{
  const teams={
    h:{espnId:"1",name:"Home"},
    a:{espnId:"2",name:"Away"},
    x:{espnId:"3",name:"Other"},
  };
  const history=[
    {date:"2026-08-01",home:teams.h,away:teams.x,homeScore:3,awayScore:0},
    {date:"2026-08-02",home:teams.a,away:teams.x,homeScore:1,awayScore:1},
    {date:"2026-08-09",home:teams.x,away:teams.h,homeScore:1,awayScore:2},
    {date:"2026-08-10",home:teams.x,away:teams.a,homeScore:2,awayScore:0},
    {date:"2026-08-17",home:teams.h,away:teams.x,homeScore:2,awayScore:0},
    {date:"2026-08-18",home:teams.a,away:teams.x,homeScore:1,awayScore:0},
  ];
  const game={start:"2026-08-25T19:00:00Z",soccerLeague:"eng.1",home:teams.h,away:teams.a};
  const p1=projectSoccerFromHistory(game,history);
  const p2=projectSoccerFromHistory(game,[...history,{date:"2026-09-01",home:teams.a,away:teams.h,homeScore:9,awayScore:0}]);
  assert.equal(p1.ok,true);
  assert.equal(p2.ok,true);
  assert.equal(p1.home,p2.home);
  assert.equal(p1.away,p2.away);
  assert.equal(p1.provenance.pointInTimeCutoff,"2026-08-25");
  assert.equal(p1.marketInformed,false);
  assert.equal(p1.canQualify,false);
});


test("canonical history resolves exact team names across provider-specific IDs",()=>{
  const history=[
    {date:"2026-07-01",home:{espnId:"182",name:"Chicago Fire FC"},away:{espnId:"10",name:"Other A"},homeScore:2,awayScore:1},
    {date:"2026-07-02",home:{espnId:"11",name:"Other B"},away:{espnId:"9727",name:"Vancouver Whitecaps"},homeScore:1,awayScore:2},
    {date:"2026-07-08",home:{espnId:"12",name:"Other C"},away:{espnId:"182",name:"Chicago Fire FC"},homeScore:0,awayScore:1},
    {date:"2026-07-09",home:{espnId:"9727",name:"Vancouver Whitecaps"},away:{espnId:"13",name:"Other D"},homeScore:2,awayScore:0},
  ];
  const p=projectSoccerFromHistory({
    start:"2026-08-01T18:00:00Z",
    soccerLeague:"usa.1",
    home:{id:"t_09gmAn",name:"Chicago Fire FC"},
    away:{id:"t_2CuHdk",name:"Vancouver Whitecaps"},
  },history);
  assert.equal(p.ok,true);
  assert.equal(p.provenance.marketUsed,false);
});

test("canonical model exposes coherent soccer market probabilities",()=>{
  const h={espnId:"10",name:"Alpha"};
  const a={espnId:"20",name:"Beta"};
  const x={espnId:"30",name:"Gamma"};
  const y={espnId:"40",name:"Delta"};
  const history=[];
  for(let i=1;i<=12;i++){
    const day=String(i).padStart(2,"0");
    history.push({date:`2026-07-${day}`,home:h,away:i%2?x:y,homeScore:2+(i%3===0?1:0),awayScore:i%4===0?1:0});
    history.push({date:`2026-07-${day}`,home:i%2?x:y,away:a,homeScore:i%3===0?2:1,awayScore:i%4===0?1:0});
  }
  const p=projectSoccerFromHistory({start:"2026-08-01T18:00:00Z",home:h,away:a,soccerLeague:"eng.1"},history);
  assert.equal(p.ok,true);
  assert.ok(Math.abs(p.pHomeWin+p.pDraw+p.pAwayWin-1)<1e-8);
  assert.ok(Math.abs(p.pBttsYes+p.pBttsNo-1)<1e-8);
  assert.ok(Math.abs(p.totals["2.5"].over+p.totals["2.5"].under-1)<1e-8);
  assert.ok(Math.abs(p.homeAsian["0"].win+p.homeAsian["0"].push+p.homeAsian["0"].loss-1)<1e-8);
  assert.equal(p.uncertainty.pointInTime,true);
  assert.equal(p.diagnostics.restAdjustmentApplied,false);
});


test("soccer confidence policy produces bounded star ratings and a canonical pick",()=>{
  const p={
    ok:true,
    pHomeWin:0.64,
    pDraw:0.21,
    pAwayWin:0.15,
    uncertainty:{level:"LOW",homeHistoryGames:22,awayHistoryGames:24},
  };
  const pick=soccerConfidencePick({
    soccerLeague:"eng.1",
    home:{name:"Home FC"},
    away:{name:"Away FC"},
  },p);
  assert.equal(pick.available,true);
  assert.equal(pick.market,"1X2");
  assert.equal(pick.side,"HOME");
  assert.equal(pick.pick,"Home FC");
  assert.ok(pick.stars>=4&&pick.stars<=5);
  assert.equal(pick.qualification,"RESEARCH_ONLY");
  assert.equal(pick.authorized,false);
});

test("soccer confidence caps sparse and legacy evidence",()=>{
  const sparse=soccerConfidencePick({
    soccerLeague:"eng.1",home:{name:"H"},away:{name:"A"}
  },{
    ok:true,pHomeWin:0.75,pDraw:0.15,pAwayWin:0.10,
    uncertainty:{level:"HIGH",homeHistoryGames:3,awayHistoryGames:4},
  });
  assert.ok(sparse.stars<=2);

  const legacy=soccerConfidencePick({
    soccerLeague:"eng.1",home:{name:"H"},away:{name:"A"}
  },{
    ok:true,pHomeWin:0.80,pDraw:0.12,pAwayWin:0.08,
    uncertainty:{level:"LOW",homeHistoryGames:30,awayHistoryGames:30,legacyTeamFormFallback:true},
  });
  assert.ok(legacy.stars<=2);
});
