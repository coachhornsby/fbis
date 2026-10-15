import test from "node:test";
import assert from "node:assert/strict";
import {pinnoddsReferenceDifference} from "../src/lib/pinnoddsReferenceDifference.js";

const offers=[
{source:"PinnOdds",marketFamily:"spread",period:"full_game",side:"away",line:-5,decimalOdds:1.97,sourceMarketId:"spread5",capturedAt:"2026-10-15T12:00:00Z"},
{source:"PinnOdds",marketFamily:"spread",period:"full_game",side:"home",line:5,decimalOdds:1.9,sourceMarketId:"spread5",capturedAt:"2026-10-15T12:00:00Z"},
{source:"PinnOdds",marketFamily:"total",period:"full_game",side:"over",line:49,decimalOdds:1.9,sourceMarketId:"total49",capturedAt:"2026-10-15T12:00:00Z"},
{source:"PinnOdds",marketFamily:"total",period:"full_game",side:"under",line:49,decimalOdds:1.9,sourceMarketId:"total49",capturedAt:"2026-10-15T12:00:00Z"}
];
const game={sport:"cfb",away:{abbr:"ECU"},home:{abbr:"UAB"},pinnoddsResearch:{offers,latestCapturedAt:"2026-10-15T12:00:00Z"}};
const projected={available:true,away:34.1,home:18.2,total:52.3};
test("computes independent CFB spread and total gaps from paired PinnOdds captures",()=>{
 const x=pinnoddsReferenceDifference(game,projected);
 assert.equal(x.spread.modelHome,15.9);
 assert.equal(x.spread.offeredHome,5);
 assert.equal(x.spread.delta,10.9);
 assert.equal(x.spread.side,"away");
 assert.equal(x.total.delta,3.3);
 assert.equal(x.total.side,"over");
 assert.equal(x.leading.kind,"spread");
 assert.equal(x.evEligible,false);
 assert.equal(x.executable,false);
});
test("gaps never exist when model missing or stored snapshot identity unverified",()=>{
 assert.equal(pinnoddsReferenceDifference(game,{available:false,away:34.1,home:18.2}).available,false);
 assert.equal(pinnoddsReferenceDifference({...game,durableFallback:{statusUnverified:true}},projected).available,false);
});
test("missing paired PinnOdds lines never borrow moneyline or fabricated total",()=>{
 const x=pinnoddsReferenceDifference({...game,pinnoddsResearch:{offers:[offers[0]]}},projected);
 assert.equal(x.spread,null);
 assert.equal(x.total,null);
 assert.equal(x.available,false);
});
test("side sign follows home spread conventions",()=>{
 const x=pinnoddsReferenceDifference(game,{available:true,away:15,home:32,total:47});
 assert.equal(x.spread.delta,-22);
 assert.equal(x.spread.side,"home");
 assert.equal(x.total.delta,-2);
 assert.equal(x.total.side,"under");
});
