import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTennisContext, tennisContextServeAdjustment, deriveCourtSpeedIndex } from "../functions/lib/tennisContextV2.js";
import { buildSharpMarketPrior, tennisMarketResidualProjection, deriveMarketMovementFeatures } from "../functions/lib/tennisMarketV2.js";
import { simulateTennisV2, simulateTennisMarketV2 } from "../functions/lib/tennisFbisV2.js";
import { projectTennisPlayerPropsV2 } from "../functions/lib/tennisPlayerPropModel.js";
import { actionObservationToTennisMarket, actionObservationToTennisMarkets, buildTennisV2Validation } from "../functions/lib/tennisV2Ledger.js";
import { buildActorInput, normalizeActionGameRow } from "../functions/lib/actionApifyShadow.js";

const p=(name,serve=.64,ret=.36)=>({
  id:name,name,historyMatches:80,surfaceMatches:30,elo:1700,surfaceElo:{hard:1700},
  firstServeIn:.62,firstServeWin:.72,secondServeWin:.52,servePointWin:serve,
  aceRate:.075,doubleFaultRate:.035,bpSaveRate:.62,bpFacedPerServiceGame:.28,
  servicePointsPerGame:6.4,returnPointWin:ret,returnFirstWin:.28,returnSecondWin:.48,
  aceAllowedRate:.075,dfReceivedRate:.035,bpCreatePerReturnGame:.28,bpConvertRate:.38,surface:"hard"
});

test("tennis context remains explicit when missing",()=>{
  const c=normalizeTennisContext({});
  assert.equal(c.indoor,null);
  assert.equal(c.courtSpeedIndex,null);
  const a=tennisContextServeAdjustment({},{});
  assert.equal(a.total,0);
  assert.equal(a.completeness.present,0);
});

test("fast indoor context lifts serve and fatigue/injury reduce it",()=>{
  const good=tennisContextServeAdjustment({courtSpeedIndex:1.15,indoor:true,altitudeM:800},{});
  const bad=tennisContextServeAdjustment({hoursSinceLastMatch:18,minutesLast3Days:420,injuryStatus:"limited"},{});
  assert.ok(good.total>0);
  assert.ok(bad.total<0);
});

test("court speed derives from tournament serve environment",()=>{
  const fast=deriveCourtSpeedIndex([{holdPct:.88,aceRate:.12,servePointWin:.69},{holdPct:.86,aceRate:.11,servePointWin:.68}],{tour:"atp"});
  const slow=deriveCourtSpeedIndex([{holdPct:.70,aceRate:.04,servePointWin:.58},{holdPct:.73,aceRate:.05,servePointWin:.60}],{tour:"atp"});
  assert.ok(fast>1);
  assert.ok(slow<1);
});

test("market prior prefers pinnacle and blends betfair when available",()=>{
  const prior=buildSharpMarketPrior({quotes:[
    {book:"pinnacle",p1Price:1.80,p2Price:2.10,format:"decimal"},
    {book:"betfair",p1Price:1.85,p2Price:2.05,format:"decimal",isExchange:true,volume:100000},
    {book:"draftkings",p1Price:-130,p2Price:110,format:"american"}
  ]});
  assert.equal(prior.source,"pinnacle+betfair");
  assert.ok(prior.p1>.5&&prior.p1<.6);
  assert.ok(prior.dispersion>=0);
});

test("market residual stays anchored and never authorizes",()=>{
  const x=tennisMarketResidualProjection({
    fundamentalP1:.72,
    market:{p1:.60,source:"pinnacle"},
    actionIntel:{publicSplits:{markets:[{market:"ML",ticketPct:40,moneyPct:65,moneyTicketGap:25}]}}
  });
  assert.ok(x.p1>.60&&x.p1<.72);
  assert.equal(x.canAuthorizeWager,false);
  assert.equal(x.action.sharpLabel,null);
});

test("movement features capture velocity and reversals",()=>{
  const m=deriveMarketMovementFeatures([
    {p1:.50,observedAt:"2026-10-05T12:00:00Z"},
    {p1:.54,observedAt:"2026-10-05T13:00:00Z"},
    {p1:.52,observedAt:"2026-10-05T14:00:00Z"},
  ]);
  assert.equal(m.n,3);
  assert.equal(m.reversals,1);
  assert.ok(Math.abs(m.move-.02)<1e-9);
});

test("v2 fundamental and market layers stay separated",()=>{
  const game={id:"t1",tour:"atp",surface:"hard",bestOf:3,player1:p("A",.65,.37),player2:p("B",.62,.34),
    playerContexts:[{courtSpeedIndex:1.08,hoursSinceLastMatch:48},{hoursSinceLastMatch:20,minutesLast3Days:380}],
    marketQuotes:[{book:"pinnacle",p1Price:1.70,p2Price:2.20,format:"decimal"}]};
  const pure=simulateTennisV2(game,{simulations:200},{seed:"v2",researchBacktest:true});
  assert.equal(pure.marketInformed,false);
  assert.equal(pure.fundamentalOnly,true);
  const combo=simulateTennisMarketV2(game,{simulations:200},{seed:"v2m",researchBacktest:true});
  assert.equal(combo.governance.pureModelMarketFree,true);
  assert.equal(combo.governance.canAuthorizeWager,false);
  assert.ok(Number.isFinite(combo.market.p1));
});

test("ACTION actor input preserves tennis sharp-gap research filters",()=>{
  const i=buildActorInput({leagues:["atp"],maxItems:5,freePlan:false,minSharpGap:12.5,minNumBets:100,sortBy:"sharpGap",includeLineMovement:true});
  assert.equal(i.minSharpGap,12.5);
  assert.equal(i.minBets,100);
  assert.equal(i.sortBy,"sharpGap");
});


test("ACTION ATP/WTA competitor schema normalizes player identity and no-vig moneyline",()=>{
  const raw={
    gameId:114596,league:"atp",startTime:"2026-10-05T15:00:00Z",status:"scheduled",
    title:"Player Alpha vs Player Beta",
    competitors:[
      {competitorId:271825,playerId:9001,side:"home",type:"player",player:{id:9001,name:"Player Alpha"}},
      {competitorId:271826,playerId:9002,side:"away",type:"player",player:{id:9002,name:"Player Beta"}}
    ],
    consensus:{
      moneyline:{sides:[
        {competitorId:271825,playerId:9001,side:"noside",odds:327,noVigProbability:.220628,ticketPercent:null,moneyPercent:null,sharpGap:null},
        {competitorId:271826,playerId:9002,side:"noside",odds:-479,noVigProbability:.779372,ticketPercent:null,moneyPercent:null,sharpGap:null}
      ]},
      spread:{sides:[]},total:{sides:[]}
    },
    booksPricing:[],lineMovement:{},lineMovementHistory:[],props:[]
  };
  const row=normalizeActionGameRow(raw,{scrapedAt:"2026-10-05T14:00:00Z"});
  assert.ok(row);
  assert.equal(row.homeTeam,"Player Alpha");
  assert.equal(row.awayTeam,"Player Beta");
  assert.equal(row.homePlayerId,"271825");
  assert.equal(row.awayPlayerId,"271826");
  assert.equal(row.consensus.moneylineHome,327);
  assert.equal(row.consensus.moneylineAway,-479);
  assert.ok(Math.abs(row.marketQuality.noVig.moneylineHome-.220628)<1e-6);
  assert.equal(row.publicBetting.moneylineHome,null);
});


test("v2 derivative prop path prioritizes total games and remains research gated",()=>{
  const r=projectTennisPlayerPropsV2({
    id:"prop-v2",tour:"atp",surface:"hard",bestOf:3,
    player1:p("A",.65,.37),player2:p("B",.62,.34),
    playerContexts:[{courtSpeedIndex:1.05},{hoursSinceLastMatch:22}]
  },[{playerId:"A",market:"aces",line:7.5},{playerId:"A",market:"total_games_won",line:12.5}]);
  assert.equal(r.ok,true);
  assert.equal(r.rows[0].market,"total_games");
  assert.ok(r.rows.some(x=>x.market==="aces"));
  assert.equal(r.canAuthorizeWager,false);
  assert.ok(r.rows.every(x=>x.propGate==="RESEARCH"));
});

test("ACTION observation converts to canonical tennis market snapshot",()=>{
  const m=actionObservationToTennisMarket({
    action_game_id:"114596",sport:"atp",home_team:"A",away_team:"B",
    consensus_json:JSON.stringify({moneylineHome:-120,moneylineAway:110}),
    public_betting_json:JSON.stringify({moneylineHome:{ticketsPercent:40,moneyPercent:55,moneyMinusTickets:15}}),
    market_quality_json:JSON.stringify({noVig:{moneylineHome:.545,moneylineAway:.455}}),
    collected_at:"2026-10-05T12:00:00Z"
  });
  assert.equal(m.canonicalEventId,"tennis:action:114596");
  assert.equal(m.player1NoVig,.545);
  assert.equal(m.moneyMinusTicketPct,15);
});


test("ACTION observation expands tennis moneyline, game spread and total games",()=>{
  const markets=actionObservationToTennisMarkets({
    action_game_id:"full1",sport:"atp",home_team:"Player A",away_team:"Player B",
    consensus_json:JSON.stringify({
      moneylineHome:-150,moneylineAway:130,
      spreadHome:-2.5,spreadHomeOdds:-110,spreadAway:2.5,spreadAwayOdds:-110,
      total:22.5,overOdds:-105,underOdds:-115
    }),
    market_quality_json:JSON.stringify({noVig:{
      moneylineHome:.59,moneylineAway:.41,spreadHome:.5,spreadAway:.5,over:.49,under:.51
    }}),
    public_betting_json:JSON.stringify({
      moneylineHome:{ticketsPercent:55,moneyPercent:60},
      spreadHome:{ticketsPercent:48,moneyPercent:57,moneyMinusTickets:9},
      over:{ticketsPercent:62,moneyPercent:54,moneyMinusTickets:-8}
    }),
    collected_at:"2026-10-05T12:00:00Z"
  });
  assert.deepEqual(markets.map(x=>x.marketType),["moneyline","spread","total"]);
  const spread=markets.find(x=>x.marketType==="spread");
  const total=markets.find(x=>x.marketType==="total");
  assert.equal(spread.player1Line,-2.5);
  assert.equal(spread.player2Line,2.5);
  assert.equal(spread.moneyMinusTicketPct,9);
  assert.equal(total.player1Line,22.5);
  assert.equal(total.overPrice,-105);
  assert.equal(total.underPrice,-115);
  assert.equal(total.overNoVig,.49);
});

test("prospective validation cannot authorize wagers",()=>{
  const rows=Array.from({length:600},(_,i)=>({
    tour:i%2?"atp":"wta",graded_at:"2026-10-05",clv:i%3?0.01:-0.01,profit_units:i%2?0.8:-1
  }));
  const v=buildTennisV2Validation(rows);
  assert.equal(v.gates.canAuthorizeWager,false);
  assert.equal(v.status,"RESEARCH_ONLY");
});


test("game/set workload fatigue is explicit and penalizes heavy recent load",()=>{
  const light=tennisContextServeAdjustment({gamesLast3Days:30,setsLast3Days:3},{});
  const heavy=tennisContextServeAdjustment({gamesLast3Days:95,gamesLast7Days:170,setsLast3Days:11,setsLast7Days:20},{});
  assert.equal(Math.abs(light.parts.gamesFatigue3d),0);
  assert.ok(heavy.total<0);
  assert.ok(heavy.parts.gamesFatigue3d<0);
  assert.ok(heavy.parts.setsFatigue7d<0);
});


test("missing ACTION tennis split fields remain null, never numeric zero",()=>{
  const m=actionObservationToTennisMarket({
    action_game_id:"n1",sport:"atp",home_team:"A",away_team:"B",
    consensus_json:JSON.stringify({moneylineHome:-120,moneylineAway:110}),
    public_betting_json:JSON.stringify({moneylineHome:{ticketsPercent:null,moneyPercent:null,moneyMinusTickets:null}}),
    market_quality_json:JSON.stringify({noVig:{moneylineHome:.545, moneylineAway:.455}}),
    collected_at:"2026-10-05T12:00:00Z"
  });
  assert.equal(m.publicTicketPct,null);
  assert.equal(m.publicMoneyPct,null);
  assert.equal(m.moneyMinusTicketPct,null);
});
