import test from "node:test";
import assert from "node:assert/strict";
import { projectNbaGame, calibrateNbaProjection } from "../functions/lib/nbaModel.js";
import { projectNbaProfileGame,NBA_PROFILE_MODEL_ID } from "../functions/lib/nbaProfileModel.js";

const hist=(pf,pa)=>Array.from({length:8},(_,i)=>({date:`2026-09-${String(20+i).padStart(2,"0")}T00:00:00Z`,pointsFor:pf+i%3,pointsAgainst:pa,possessions:100,fga:88,orb:10,tov:12,fta:20}));
const game={id:"g1",homeId:"1",awayId:"2",home:{id:"1",abbr:"BOS"},away:{id:"2",abbr:"NYK"},start:"2026-10-06T23:00:00Z",featureCutoff:"2026-10-06T12:00:00Z"};
const sequence=[...Array.from({length:2},(_,i)=>({id:"p"+i,homeId:i?"3":"1",awayId:i?"2":"4",home:{id:i?"3":"1",abbr:i?"MIA":"BOS"},away:{id:i?"2":"4",abbr:i?"NYK":"CHI"},start:`2026-10-0${4+i}T23:00:00Z`})),game];

test("v1-profile leaves v1 control untouched when profile overlay is empty",()=>{
 const ctx={homeHistory:hist(115,110),awayHistory:hist(111,113)};
 const v1=projectNbaGame(game,ctx);
 const p=projectNbaProfileGame(game,{...ctx,impact:{players:{},roleContexts:{}},sequence});
 assert.equal(p.modelId,NBA_PROFILE_MODEL_ID);
 assert.equal(p.canQualify,false);assert.equal(p.canAuthorize,false);
 assert.equal(p.provenance.marketUsed,false);
 // Profile model may differ only through the richer persistent schedule context; no deep features exist.
 assert.ok(p.profileOverlay);assert.ok(!("fourFactors" in p.profileOverlay));assert.ok(!("shotProfile" in p.profileOverlay));
 assert.equal(v1.modelId,"NBA-FBIS-v1");
});

test("persistent OUT state creates an explicit availability overlay",()=>{
 const ctx={homeHistory:hist(115,110),awayHistory:hist(111,113)};
 const impact={players:{"23":{playerId:"23",teamId:"1",net:5,skill:{minutes:32}}},roleContexts:{"23":{unavailable:[{playerId:"23",status:"OUT",source:"PERSISTENT_TEAM_PROFILE",observedAt:"2026-10-06T10:00:00Z"}],role:{minutesDelta:0,usageMultiplier:1},lineup:{netDelta:0}}}};
 const p=projectNbaProfileGame(game,{...ctx,impact,sequence});
 assert.ok(p.profileOverlay.home.availabilityPoints<0);
 assert.ok(p.profileOverlay.home.lostMinutes>0);
 assert.ok(p.margin<projectNbaProfileGame(game,{...ctx,impact:{players:{},roleContexts:{}},sequence}).margin);
});

test("profile challenger carries no market input surface",()=>{
 const p=projectNbaProfileGame(game,{homeHistory:hist(115,110),awayHistory:hist(111,113),impact:{players:{},roleContexts:{}},sequence});
 assert.equal(p.provenance.marketUsed,false);
 assert.equal(p.marketInformed,false);
});


test("v1-profile applies the incumbent calibration before profile overlay",()=>{
 const ctx={homeHistory:hist(115,110),awayHistory:hist(111,113)};
 const fit={version:"control-fit",calibration:{margin:{intercept:1,slope:1.1,sigma:14},total:{intercept:2,slope:.9,sigma:18}}};
 const p=projectNbaProfileGame(game,{...ctx,impact:{players:{},roleContexts:{}},sequence,fit});
 assert.equal(p.provenance.calibratedBaseVersion,"control-fit");
 assert.equal(p.canQualify,false);
 assert.equal(p.canAuthorize,false);
});
