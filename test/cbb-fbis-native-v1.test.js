import test from "node:test";
import assert from "node:assert/strict";
import {buildFbisCbbRatings,projectFbisCbbGame,FBIS_CBB_MODEL_ID} from "../functions/lib/cbbFbisRatings.js";
import {conferenceForTeamSeason} from "../functions/lib/cbbConferenceMembership.js";
import {buildCbbMoneyResearch,SIDE_DISLOCATION_THRESHOLD} from "../functions/lib/cbbMoneySelector.js";
import {buildCbbTeamPlayerState,cbbPlayerGameFeatures} from "../functions/lib/cbbPlayerGameModel.js";
import {projectCbbPlayerPropV2,CBB_PLAYER_PROP_PROMOTED_MARKETS} from "../functions/lib/cbbPlayerValidated.js";
import {buildCbbPlayerPropSignal,gradeCbbPlayerPropSignal,CBB_PLAYER_PROP_TRACK_Z} from "../functions/lib/cbbPlayerPropMoney.js";
import {validateCbbMoneyTicket,CBB_MONEY_STRATEGY_V1} from "../functions/lib/strategy.js";

const rows=[
 {gameId:"1",startDate:"2025-11-01T18:00:00Z",team:"A",opponent:"B",teamId:"A",conference:"X",isHome:true,points:80,poss:70,fgm:30,fga:60,threeMade:10,threeAtt:25,ftm:10,fta:14,orb:8,drb:22,tov:10},
 {gameId:"1",startDate:"2025-11-01T18:00:00Z",team:"B",opponent:"A",teamId:"B",conference:"X",isHome:false,points:68,poss:70,fgm:25,fga:58,threeMade:8,threeAtt:23,ftm:10,fta:13,orb:7,drb:20,tov:14},
 {gameId:"2",startDate:"2025-11-03T18:00:00Z",team:"A",opponent:"C",teamId:"A",conference:"X",isHome:false,points:76,poss:68,fgm:28,fga:58,threeMade:9,threeAtt:22,ftm:11,fta:15,orb:9,drb:20,tov:11},
 {gameId:"2",startDate:"2025-11-03T18:00:00Z",team:"C",opponent:"A",teamId:"C",conference:"Y",isHome:true,points:70,poss:68,fgm:26,fga:59,threeMade:7,threeAtt:21,ftm:11,fta:15,orb:8,drb:19,tov:12},
 {gameId:"3",startDate:"2025-11-04T18:00:00Z",team:"B",opponent:"D",teamId:"B",conference:"X",isHome:true,points:74,poss:69,fgm:27,fga:59,threeMade:8,threeAtt:22,ftm:12,fta:16,orb:9,drb:21,tov:10},
 {gameId:"3",startDate:"2025-11-04T18:00:00Z",team:"D",opponent:"B",teamId:"D",conference:"Y",isHome:false,points:66,poss:69,fgm:24,fga:58,threeMade:7,threeAtt:20,ftm:11,fta:14,orb:7,drb:19,tov:15},
];

test("native CBB ratings are independent and include SOS/conference strength",()=>{
 const c=buildFbisCbbRatings(rows,{asOf:"2025-11-10T00:00:00Z",season:2025,iterations:8});
 assert.equal(c.ok,true);
 assert.equal(c.methodology.kenpomInput,false);
 assert.equal(c.methodology.dynamicNationalEnvironment,true);
 assert.equal(c.hcaModel.independent,true);
 assert.equal(c.hcaModel.kenpomInput,false);
 assert.equal(c.hcaModel.marketInformed,false);
 assert.equal(c.methodology.torvikInput,false);
 assert.equal(c.methodology.marketInformed,false);
 const a=c.byTeamId.A,b=c.byTeamId.B;
 assert.ok(a&&b);
 assert.ok(Number.isFinite(a.adjOe));
 assert.ok(Number.isFinite(a.adjDe));
 assert.ok(Number.isFinite(a.tempo));
 assert.ok(Number.isFinite(a.sos));
 assert.ok(Number.isFinite(a.sosO));
 assert.ok(Number.isFinite(a.sosD));
 assert.ok(Number.isFinite(a.nonConferenceSos));
 assert.ok(Number.isFinite(a.conferenceStrength));
 assert.ok(Number.isFinite(a.pacePressure));
 assert.ok(Number.isFinite(a.paceControl));
 assert.ok(Number.isFinite(a.hca));
 assert.ok(c.conferences.X);
 assert.ok(c.conferences.Y);
});

test("projection exposes independent score and schedule decomposition",()=>{
 const c=buildFbisCbbRatings(rows,{asOf:"2025-11-10T00:00:00Z",season:2025,iterations:8});
 const p=projectFbisCbbGame({neutral:false},c.byTeamId.A,c.byTeamId.B);
 assert.equal(p.ok,true);
 assert.equal(p.modelId,FBIS_CBB_MODEL_ID);
 assert.equal(p.independent,true);
 assert.equal(p.marketInformed,false);
 assert.equal(p.kenpomInput,false);
 assert.ok(Number.isFinite(p.total));
 assert.ok(Number.isFinite(p.margin));
 assert.ok(Number.isFinite(p.possessions));
 assert.ok(Number.isFinite(p.basePossessions));
 assert.ok(Number.isFinite(p.paceAdjustment));
 assert.ok(p.schedule.home);
});


test("season-aware conference membership is independent and current",()=>{
 assert.equal(conferenceForTeamSeason("Houston",2025),"big_twelve");
 assert.equal(conferenceForTeamSeason("UConn",2025),"big_east");
 assert.equal(conferenceForTeamSeason("Texas",2023),"big_twelve");
 assert.equal(conferenceForTeamSeason("Texas",2024),"sec");
 assert.equal(conferenceForTeamSeason("USC",2023),"pac_twelve");
 assert.equal(conferenceForTeamSeason("USC",2024),"big_ten");
});

test("projection exposes OREB-DRB matchup interaction",()=>{
 const c=buildFbisCbbRatings(rows,{asOf:"2025-11-10T00:00:00Z",season:2025,iterations:8});
 const p=projectFbisCbbGame({neutral:false},c.byTeamId.A,c.byTeamId.B);
 assert.ok(Object.prototype.hasOwnProperty.call(p.matchup.home,"orebVsDrb"));
 assert.ok(Object.prototype.hasOwnProperty.call(p.matchup.away,"orebVsDrb"));
 assert.ok(Object.prototype.hasOwnProperty.call(p.matchup.home,"drbRate"));
});


test("money-first side dislocation is prospective and fail-closed",()=>{
 const fbis={
  ok:true,margin:15,possessions:70,paceAdjustment:0,reliability:.6,hca:4,
  matchup:{home:{efg:1,twoPt:1,threePt:1,orebVsDrb:1,drbRate:72,turnover:1,ftr:1},away:{efg:0,twoPt:0,threePt:0,orebVsDrb:0,drbRate:72,turnover:0,ftr:0}},
  schedule:{home:{sos:2,conferenceStrength:3},away:{sos:0,conferenceStrength:1}}
 };
 const game={sport:"cbb",home:{school:"A"},away:{school:"B"},odds:{spread:2},cbbFbisNative:fbis,challengers:{"FBIS-CBB-RATINGS-v2":fbis}};
 const m=buildCbbMoneyResearch(game);
 assert.equal(SIDE_DISLOCATION_THRESHOLD,10);
 assert.equal(m.sideDislocation.authority.canAuthorizeWager,false);
 assert.equal(m.sideDislocation.authority.canQualify,false);
 assert.equal(m.governance.noAutoWager,true);
});


test("CBB money ticket validator enforces prospective dislocation contract",()=>{
 const good=validateCbbMoneyTicket({
  strategyId:CBB_MONEY_STRATEGY_V1.id,sport:"cbb",gameId:"g1",market:"SPREAD",side:"HOME",
  line:-3,edge:10.5,qualifiedAt:"2026-11-01T18:00:00Z",modelVersion:"CBB-MONEY-SELECTOR-v1",
  role:"prospective",qualified:false,benchmarkPrice:-110
 });
 assert.equal(good.ok,true);
 assert.equal(good.ticket.strategyId,CBB_MONEY_STRATEGY_V1.id);
 assert.equal(good.ticket.qualified,false);
 const bad=validateCbbMoneyTicket({
  strategyId:CBB_MONEY_STRATEGY_V1.id,sport:"cbb",gameId:"g2",market:"SPREAD",side:"AWAY",
  line:4,edge:6,qualifiedAt:"2026-11-01T18:00:00Z",modelVersion:"CBB-MONEY-SELECTOR-v1",
  role:"prospective",qualified:false,benchmarkPrice:-110
 });
 assert.equal(bad.ok,false);
 assert.ok(bad.errors.includes("side_dislocation"));
});


test("CBB money validator freezes one ticket identity per game",()=>{
 const base={strategyId:CBB_MONEY_STRATEGY_V1.id,sport:"cbb",gameId:"g-freeze",market:"SPREAD",line:-3,edge:11,qualifiedAt:"2026-11-01T18:00:00Z",modelVersion:"CBB-MONEY-SELECTOR-v1",role:"prospective",qualified:false,benchmarkPrice:-110};
 const home=validateCbbMoneyTicket({...base,side:"HOME"});
 const away=validateCbbMoneyTicket({...base,side:"AWAY",line:3,edge:-11});
 assert.equal(home.ok,true); assert.equal(away.ok,true);
 assert.equal(home.ticket.id,away.ticket.id);
});


test("player-game layer builds independent rotation features",()=>{
 const players=Array.from({length:8},(_,i)=>({
  id:String(i+1),name:"P"+(i+1),projectedMinutes:30-i,minutesPerGame:28-i,roleConfidence:.8,sampleSize:10,
  pointsPer40:18-i*.5,reboundsPer40:6+i*.2,assistsPer40:4,threesMadePer40:1.5,
  fieldGoalAttemptsPer40:13,freeThrowAttemptsPer40:4,offensiveReboundsPer40:1.5,defensiveReboundsPer40:4.5,turnoversPer40:2,
  effectiveFieldGoalPct:55,trueShootingPct:58,
  role:{startsRecent:4,lastGameMinutes:28-i,lastGameDnp:false,minuteStability:.8}
 }));
 const a=buildCbbTeamPlayerState(players),b=buildCbbTeamPlayerState(players.map((p,i)=>({...p,pointsPer40:p.pointsPer40-1,projectedMinutes:p.projectedMinutes-1})));
 assert.equal(a.ok,true);assert.ok(a.projectedMinutes>190);assert.ok(a.pointsProxy>0);
 const f=cbbPlayerGameFeatures(a,b);assert.ok(Number.isFinite(f.pointsProxyDiff));assert.ok(Number.isFinite(f.roleConfidenceSum));
});


test("validated player prop v2 only promotes proven markets",()=>{
 const p={
  projectedMinutes:30,minutesPerGame:29,roleConfidence:.9,sampleSize:15,
  pointsPerGame:14,reboundsPerGame:6,assistsPerGame:3,threesMadePerGame:1.5,
  pointsPer40:18,reboundsPer40:7.5,assistsPer40:4,threesMadePer40:1.8,
  fieldGoalAttemptsPer40:13,freeThrowAttemptsPer40:4,offensiveReboundsPer40:2,defensiveReboundsPer40:5,turnoversPer40:2.2,
  recent:{points:15,rebounds:6.5,assists:3.2,threesMade:1.6},
  trend:{points:16,rebounds:7,assists:3.5,threesMade:1.7},
  volatility:{points:5,rebounds:2.2,assists:1.4,threesMade:1},
  role:{minuteStability:.85,lastGameDnp:false}
 };
 assert.deepEqual(CBB_PLAYER_PROP_PROMOTED_MARKETS,["points","rebounds","assists","points_rebounds_assists"]);
 const pts=projectCbbPlayerPropV2(p,"points",{possessions:70,teamScore:74,home:true});
 assert.equal(pts.ok,true);assert.ok(Number.isFinite(pts.projection));assert.ok(pts.sigma>0);
 assert.equal(projectCbbPlayerPropV2(p,"three_pointers_made",{possessions:70,teamScore:74,home:true}).ok,false);
});

test("player prop money signals freeze standardized edge and grade line CLV",()=>{
 const sig=buildCbbPlayerPropSignal(
  {eventId:"g1",playerName:"Player A",team:"A",market:"points",fbisProjection:18,fbisSigma:5,modelVersion:"CBB-PLAYER-PROP-v2",validatedPredictive:true},
  {line:15,projectionId:"pp1",collectedAt:"2026-11-01T12:00:00Z",startTime:"2026-11-01T20:00:00Z"}
 );
 assert.equal(sig.ok,true);assert.equal(sig.side,"MORE");assert.ok(Math.abs(sig.zEdge)>=CBB_PLAYER_PROP_TRACK_Z);
 const graded=gradeCbbPlayerPropSignal({side:sig.side,signalLine:sig.signalLine},20,16.5,"2026-11-01T19:30:00Z");
 assert.equal(graded.ok,true);assert.equal(graded.result,"WIN");assert.equal(graded.lineClv,1.5);
});
