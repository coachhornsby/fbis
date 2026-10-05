import test from "node:test";
import assert from "node:assert/strict";
import { buildScoreMatrix } from "../functions/lib/soccerFbisV1.js";
import { priceSoccerScoreMatrix, heritageSoccerFullMatchMenu } from "../functions/lib/soccerHeritageMarkets.js";
import { heritageSoccerCompetition, HERITAGE_SOCCER_COMPETITIONS, HERITAGE_SOCCER_FUTURES } from "../functions/lib/soccerCompetitionRegistry.js";

test("Heritage competition registry covers the supplied match competitions",()=>{
  assert.ok(HERITAGE_SOCCER_COMPETITIONS.length>=29);
  assert.equal(heritageSoccerCompetition("England Premier League")?.key,"eng.1");
  assert.equal(heritageSoccerCompetition("Copa Libertadores")?.type,"continental-cup");
  assert.equal(heritageSoccerCompetition("United States USL Championship")?.key,"usa.usl_championship");
  assert.ok(HERITAGE_SOCCER_FUTURES.includes("International FIFA World Cup Futures"));
});

test("quarter totals settle as split Asian lines",()=>{
  const matrix=[{home:2,away:0,p:1}];
  const priced=priceSoccerScoreMatrix(matrix);
  assert.deepEqual(priced.totalAt(2.25).over,{win:0,push:.5,loss:.5});
  assert.deepEqual(priced.totalAt(1.75).over,{win:1,push:0,loss:0});
});

test("quarter handicaps settle half push/half win correctly",()=>{
  const matrix=[{home:1,away:1,p:1}];
  const priced=priceSoccerScoreMatrix(matrix);
  assert.deepEqual(priced.asianHandicapAt(0.25).home,{win:.5,push:.5,loss:0});
  assert.deepEqual(priced.asianHandicapAt(-0.25).home,{win:0,push:.5,loss:.5});
});

test("Heritage menu includes full match derivatives and blocks process markets",()=>{
  const priced=priceSoccerScoreMatrix(buildScoreMatrix(1.4,1.0));
  const menu=heritageSoccerFullMatchMenu(priced);
  assert.ok(menu.totals.find(x=>x.line===2.75));
  assert.ok(menu.handicaps.find(x=>x.homeLine===-0.25));
  assert.ok(menu.unsupportedWithoutAdditionalProcessModel.includes("to-advance"));
  assert.ok(Math.abs(menu.matchResult.home+menu.matchResult.draw+menu.matchResult.away-1)<1e-9);
});
