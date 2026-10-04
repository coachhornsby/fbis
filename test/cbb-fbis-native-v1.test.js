import test from "node:test";
import assert from "node:assert/strict";
import {buildFbisCbbRatings,projectFbisCbbGame,FBIS_CBB_MODEL_ID} from "../functions/lib/cbbFbisRatings.js";
import {conferenceForTeamSeason} from "../functions/lib/cbbConferenceMembership.js";
import {buildCbbMoneyResearch,SIDE_DISLOCATION_THRESHOLD} from "../functions/lib/cbbMoneySelector.js";

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
