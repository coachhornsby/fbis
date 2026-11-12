import test from "node:test";
import assert from "node:assert/strict";
import {screenCbbFirstHalfUnder} from "../functions/lib/cbbFirstHalfUnderResearch.js";
const now = "2026-11-06T21:00:00.000Z";
const candidate = () => ({
  sport: "cbb", game: {started: false},
  projection: {firstHalfTotal: 65.5, method:"independent_first_half", validated:true, modelId:"RESEARCH-FIXTURE", version:"test", capturedAt:"2026-11-06T20:55:00.000Z"},
  market: {period:"1H", type:"total", side:"under", line:69.5, source:"kalshi", capturedAt:"2026-11-06T20:59:30.000Z", contractVerified:true, executable:true, allInCost:0.53, depth:20}
});
test("research candidate still has zero betting authority", () => {
  const r = screenCbbFirstHalfUnder(candidate(), {asOf:now});
  assert.equal(r.status, "RESEARCH_CANDIDATE");
  assert.equal(r.gapPoints, 4);
  assert.equal(r.authority.canAuthorizeWager, false);
  assert.equal(r.authority.stakeUnits, 0);
});
test("does not accept full game divided by 2", () => {
  const v=candidate();v.projection.method="full_game_halved";
  assert.ok(screenCbbFirstHalfUnder(v,{asOf:now}).reasons.includes("UNVERIFIED_1H_MODEL"));
});
test("fails closed when no line or price exists", () => {
  const v=candidate();delete v.market.line;delete v.market.allInCost;
  const r=screenCbbFirstHalfUnder(v,{asOf:now});
  assert.equal(r.status,"BLOCKED");
  assert.ok(r.reasons.includes("MISSING_1H_LINE"));
  assert.ok(r.reasons.includes("MISSING_ALL_IN_COST"));
});
test("rejects stale, future, and non-executable quotes", () => {
  const v=candidate();v.market.capturedAt="2026-11-06T20:50:00.000Z";v.market.executable=false;
  let r=screenCbbFirstHalfUnder(v,{asOf:now});
  assert.ok(r.reasons.includes("STALE_OR_FUTURE_MARKET"));
  assert.ok(r.reasons.includes("QUOTE_NOT_EXECUTABLE"));
  v.market.capturedAt="2026-11-06T21:01:00.000Z";
  assert.ok(screenCbbFirstHalfUnder(v,{asOf:now}).reasons.includes("STALE_OR_FUTURE_MARKET"));
});
test("rejects full-game market and started games", () => {
  const v=candidate();v.market.period="FULL";v.game.started=true;
  const r=screenCbbFirstHalfUnder(v,{asOf:now});
  assert.ok(r.reasons.includes("NOT_FIRST_HALF_UNDER_MARKET"));
  assert.ok(r.reasons.includes("GAME_STARTED"));
});
test("preferred 3 point gap is a research filter only", () => {
  const v=candidate();v.market.line=67.5;
  const r=screenCbbFirstHalfUnder(v,{asOf:now});
  assert.equal(r.gapPoints,2);
  assert.ok(r.reasons.includes("BELOW_PREFERRED_RESEARCH_GAP"));
  assert.equal(r.authority.canQualify,false);
});
