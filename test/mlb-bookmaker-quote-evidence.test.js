import test from "node:test";
import assert from "node:assert/strict";
import { classifyNhlQuoteEvidence as classifyBookQuote } from "../functions/lib/nhlBookQuoteEvidence.js";
import { summarizeParlayEvent, mergeParlay } from "../functions/lib/parlay.js";

test("MLB quote captured before first pitch retains independent bookmaker timestamp",()=>{
 const r=classifyBookQuote({gameStart:"2026-10-12T00:00:00Z",
  capturedAt:"2026-10-11T23:59:00Z",sourceObservedAt:"2026-10-11T23:30:00Z"});
 assert.equal(r.captureClass,"PREGAME_SOURCE_TIME_VERIFIED");
 assert.equal(r.sourceObservedAt,"2026-10-11T23:30:00.000Z");
});
test("MLB after-first-pitch capture fails prospective classification",()=>{
 const r=classifyBookQuote({gameStart:"2026-10-12T00:00:00Z",
  capturedAt:"2026-10-12T00:01:00Z",sourceObservedAt:"2026-10-11T23:30:00Z"});
 assert.equal(r.captureClass,"POST_START");
 assert.equal(r.sourceObservedAt,null);
});
test("MLB paired two-way market source cannot be constructed across books",()=>{
 const ev={id:"game-3",home_team:"Milwaukee Brewers",away_team:"Los Angeles Dodgers",
  bookmakers:[
   {key:"draftkings",title:"DraftKings",markets:[{key:"h2h",outcomes:[{name:"Milwaukee Brewers",price:-112}]}]},
   {key:"fanduel",title:"FanDuel",markets:[{key:"h2h",outcomes:[{name:"Los Angeles Dodgers",price:-108}]}]}
  ]};
 const r=summarizeParlayEvent(ev,"mlb");
 assert.equal(r.homeMl,null);
 assert.equal(r.awayMl,null);
 assert.equal(r.moneylineBook,null);
});
test("MLB reference market and free-book provenance do not become operator execution",()=>{
 const ev={id:"game-4",home_team:"Milwaukee Brewers",away_team:"Los Angeles Dodgers",
  commence_time:"2026-10-12T00:00:00Z",softSource:"sharpapi",
  bookmakers:[{key:"draftkings",title:"DraftKings",last_update:"2026-10-11T23:30:00Z",
   markets:[{key:"h2h",outcomes:[
    {name:"Milwaukee Brewers",price:-113},{name:"Los Angeles Dodgers",price:102}
   ]}]}]};
 const s=summarizeParlayEvent(ev,"mlb");
 assert.equal(s.homeMl,-113);
 assert.equal(s.awayMl,102);
 assert.equal(s.moneylineBook,"DraftKings");
 assert.equal(s.observedAt,"2026-10-11T23:30:00.000Z");
 assert.equal(s.heritageListed,false);
 const g=mergeParlay([{
  id:"board-4",sport:"mlb",start:ev.commence_time,
  home:{name:"Milwaukee Brewers",abbr:"MIL",canonicalId:"mlb-mil"},
  away:{name:"Los Angeles Dodgers",abbr:"LAD",canonicalId:"mlb-lad"},
  odds:{},status:{state:"pre"},
 }],[s],"mlb","2026-10-11")[0];
 assert.equal(g.odds.book,"DraftKings");
 assert.equal(g.odds.sourceTimestamp,"2026-10-11T23:30:00.000Z");
 assert.equal(g.odds.heritageListed,false);
});
