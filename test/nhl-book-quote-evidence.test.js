import test from "node:test";
import assert from "node:assert/strict";
import { classifyNhlQuoteEvidence } from "../functions/lib/nhlBookQuoteEvidence.js";
const start="2026-10-12T00:00:00Z";
test("valid original quote before kickoff remains explicitly timestamped",()=>{
 const x=classifyNhlQuoteEvidence({gameStart:start,sourceObservedAt:"2026-10-11T23:40:00Z",
   capturedAt:"2026-10-11T23:50:00Z"});
 assert.equal(x.captureClass,"PREGAME_SOURCE_TIME_VERIFIED");
 assert.equal(x.sourceObservedAt,"2026-10-11T23:40:00.000Z");
});
test("missing source timestamp is never replaced with collector receipt",()=>{
 const x=classifyNhlQuoteEvidence({gameStart:start,sourceObservedAt:null,capturedAt:"2026-10-11T23:50:00Z"});
 assert.equal(x.captureClass,"PREGAME_UNVERIFIED_SOURCE_TIME");
 assert.equal(x.sourceObservedAt,null);
});
test("late capture never becomes prospective even with old upstream quote",()=>{
 const x=classifyNhlQuoteEvidence({gameStart:start,sourceObservedAt:"2026-10-11T23:40:00Z",
  capturedAt:"2026-10-12T00:15:00Z"});
 assert.equal(x.captureClass,"POST_START");
 assert.equal(x.sourceObservedAt,null);
});
test("future-dated vendor quote cannot be certified as pregame",()=>{
 const x=classifyNhlQuoteEvidence({gameStart:start,sourceObservedAt:"2026-10-12T00:10:00Z",
   capturedAt:"2026-10-11T23:50:00Z"});
 assert.equal(x.captureClass,"PREGAME_UNVERIFIED_SOURCE_TIME");
 assert.equal(x.sourceObservedAt,null);
});
