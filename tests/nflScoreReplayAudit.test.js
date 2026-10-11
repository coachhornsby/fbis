import test from "node:test";
import assert from "node:assert/strict";
import { replayNflProScore } from "../functions/lib/nflScoreReplayAudit.js";

const zeroMatchup = {pass:0,rush:0,explosive:0,pressure:0,trenches:0,total:0};
function fixture(factor) {
  const home={teamPower:1,matchup:zeroMatchup,qb:{value:2},tracking:{value:0},specialTeams:0,context:0,hfa:0.75};
  const away={teamPower:-1,matchup:zeroMatchup,qb:{value:-2},tracking:{value:0},specialTeams:0,context:0,hfa:-0.75};
  // pre-weather 25.4 / 19.7
  const h=factor?Math.round(25.4*factor*10)/10:25.4;
  const a=factor?Math.round(19.7*factor*10)/10:19.7;
  return {ok:true,modelId:"NFL-PRO-v1",version:"v1.2",home:h,away:a,margin:Math.round((h-a)*10)/10,total:Math.round((h+a)*10)/10,
    ...(factor?{weatherTotalFactor:factor}:{}),decomposition:{baseLeaguePpg:22.5,home,away}};
}
test("reconciles frozen NFL-PRO decomposition",()=>{
  const result=replayNflProScore(fixture());
  assert.equal(result.reconciled,true);
  assert.equal(result.reconstructed.total,45.1);
});
test("replays post-computation weather multiplier",()=>{
  const result=replayNflProScore(fixture(0.9));
  assert.equal(result.reconciled,true);
});
test("fails closed if final published score diverges",()=>{
  const p=fixture();p.home=31;
  const result=replayNflProScore(p);
  assert.equal(result.reconciled,false);
  assert.equal(result.reason,"published-score-mismatch");
});
test("rejects missing frozen decomposition instead of rebuilding from current statistics",()=>{
  assert.equal(replayNflProScore({ok:true}).reason,"frozen-decomposition-unavailable");
});
test("rejects inconsistent matchup subtotal",()=>{
  const p=fixture();p.decomposition.home.matchup={...zeroMatchup,total:1};
  assert.equal(replayNflProScore(p).reason,"matchup-subtotal-mismatch");
});
