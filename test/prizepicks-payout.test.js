import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIZEPICKS_STANDARD_POWER,
  PRIZEPICKS_STANDARD_FLEX,
  standardPowerBreakEvenPerLeg,
  standardFlexBreakEvenPerLeg,
  standardFlexExpectedReturnAtEqualLegProbability,
  evaluatePrizePicksLineup,
} from "../functions/lib/prizePicksPayout.js";

test("PrizePicks standard payout tables match current published minimum-guarantee rates", () => {
  assert.deepEqual(PRIZEPICKS_STANDARD_POWER,{2:3,3:6,4:10,5:20,6:37.5});
  assert.deepEqual(PRIZEPICKS_STANDARD_FLEX,{
    2:{2:2,1:.5},
    3:{3:3,2:1},
    4:{4:6,3:1.5},
    5:{5:10,4:2,3:.4},
    6:{6:25,5:2,4:.4},
  });
});

test("Power equal-leg break-even math is internally consistent", () => {
  for (const n of [2,3,4,5,6]) {
    const p=standardPowerBreakEvenPerLeg(n);
    const m=PRIZEPICKS_STANDARD_POWER[n];
    assert.ok(Math.abs((p ** n) * m - 1) < 1e-10);
  }
});

test("Flex equal-leg break-even solves expected return to one unit", () => {
  for (const n of [2,3,4,5,6]) {
    const p=standardFlexBreakEvenPerLeg(n);
    const er=standardFlexExpectedReturnAtEqualLegProbability(n,p);
    assert.ok(Math.abs(er-1)<1e-8, `n=${n} p=${p} er=${er}`);
  }
});

test("2-pick standard Power lineup calculates exact EV from leg probabilities", () => {
  const out=evaluatePrizePicksLineup({
    playType:"power",
    rows:[{probability:.65},{probability:.65}],
  });
  assert.equal(out.ok,true);
  assert.equal(out.status,"STANDARD_PAYOUT");
  assert.equal(out.payoutMultiplier,3);
  assert.ok(Math.abs(out.winProbability-.4225)<1e-12);
  assert.ok(Math.abs(out.expectedReturn-1.2675)<1e-12);
  assert.ok(Math.abs(out.evPerUnit-.2675)<1e-12);
});

test("3-pick Flex lineup evaluates every correct-pick outcome", () => {
  const out=evaluatePrizePicksLineup({
    playType:"flex",
    rows:[{probability:.60},{probability:.60},{probability:.60}],
  });
  assert.equal(out.ok,true);
  // 3/3: .216*3 = .648; 2/3: .432*1 = .432; total = 1.08
  assert.ok(Math.abs(out.expectedReturn-1.08)<1e-12);
  assert.ok(Math.abs(out.evPerUnit-.08)<1e-12);
});

test("Demon/Goblin lineup fails closed without actual details-screen payout", () => {
  const out=evaluatePrizePicksLineup({
    playType:"power",
    rows:[
      {probability:.90,odds_tier:"demon"},
      {probability:.65,odds_tier:"standard"},
    ],
  });
  assert.equal(out.ok,false);
  assert.equal(out.status,"ACTUAL_PAYOUT_REQUIRED_SPECIAL_PROJECTION");
  assert.equal(out.expectedReturn,null);
});

test("special-projection Power lineup can be evaluated with actual quoted multiplier", () => {
  const out=evaluatePrizePicksLineup({
    playType:"power",
    quotedMultiplier:4.2,
    rows:[
      {probability:.90,odds_tier:"demon"},
      {probability:.65,odds_tier:"standard"},
    ],
  });
  assert.equal(out.ok,true);
  assert.equal(out.status,"QUOTED_PAYOUT");
  assert.ok(Math.abs(out.expectedReturn-(.90*.65*4.2))<1e-12);
});

test("same-game lineup fails closed unless actual payout or explicit standard confirmation is supplied", () => {
  const rows=[
    {probability:.65,eventId:"g1"},
    {probability:.65,eventId:"g1"},
  ];
  const blocked=evaluatePrizePicksLineup({playType:"power",rows});
  assert.equal(blocked.ok,false);
  assert.equal(blocked.status,"ACTUAL_PAYOUT_REQUIRED_SAME_GAME");

  const confirmed=evaluatePrizePicksLineup({playType:"power",rows,allowSameGameStandard:true});
  assert.equal(confirmed.ok,true);
  assert.equal(confirmed.payoutMultiplier,3);
});
