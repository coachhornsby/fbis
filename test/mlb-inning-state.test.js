import test from "node:test";
import assert from "node:assert/strict";
import { readMlbInningState } from "../functions/lib/mlbInningState.js";

test("MLB hydrated linescore records top, bottom, and inning number", () => {
  assert.deepEqual(readMlbInningState({currentInning:6,inningState:"Top"}),{inning:6,inningHalf:"TOP"});
  assert.deepEqual(readMlbInningState({currentInning:8,inningState:"Bottom"}),{inning:8,inningHalf:"BOT"});
  assert.deepEqual(readMlbInningState({currentInning:5,inningState:"Middle"}),{inning:5,inningHalf:"MID"});
  assert.deepEqual(readMlbInningState({currentInning:9,inningState:"End"}),{inning:9,inningHalf:"END"});
});
test("Fallback only when explicit provider top/bottom indicator exists", () => {
  assert.deepEqual(readMlbInningState({currentInning:2,isTopInning:false}),{inning:2,inningHalf:"BOT"});
  assert.deepEqual(readMlbInningState({currentInning:2}),{inning:2,inningHalf:null});
});
test("No fabricated current inning", () => {
  assert.deepEqual(readMlbInningState({}),{inning:null,inningHalf:null});
  assert.deepEqual(readMlbInningState({currentInning:0,inningState:"Top"}),{inning:null,inningHalf:"TOP"});
});
