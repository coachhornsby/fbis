import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIZEPICKS_STANDARD_POWER,
  PRIZEPICKS_STANDARD_FLEX,
  standardPowerBreakEvenPerLeg,
  standardFlexBreakEvenPerLeg,
  standardFlexExpectedReturnAtEqualLegProbability,
  evaluatePrizePicksLineup,
  revertPrizePicksTier,
  settlePrizePicksLineup,
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


test("published DNP/Reboot tier transitions are encoded exactly", () => {
  assert.deepEqual(revertPrizePicksTier("power",6,1),{ok:true,status:"REVERTED",refund:false,playType:"power",pickCount:5});
  assert.deepEqual(revertPrizePicksTier("flex",3,1),{ok:true,status:"REVERTED",refund:false,playType:"power",pickCount:2});
  assert.deepEqual(revertPrizePicksTier("power",2,1),{ok:true,status:"REFUND",refund:true,playType:"power",pickCount:2});
  assert.deepEqual(revertPrizePicksTier("flex",2,1),{ok:true,status:"REFUND",refund:true,playType:"flex",pickCount:2});
});

test("3-pick Power with one DNP reverts to standard 2-pick Power payout", () => {
  const out=settlePrizePicksLineup({
    playType:"power",
    allowSameGameStandard:true,
    rows:[
      {outcome:"WIN",team:"A"},
      {outcome:"WIN",team:"B"},
      {outcome:"DNP",team:"C"},
    ],
  });
  assert.equal(out.ok,true);
  assert.equal(out.status,"SETTLED_REVERTED");
  assert.equal(out.playType,"power");
  assert.equal(out.pickCount,2);
  assert.equal(out.payoutMultiplier,3);
});

test("3-pick Flex with one DNP reverts to 2-pick Power", () => {
  const out=settlePrizePicksLineup({
    playType:"flex",
    allowSameGameStandard:true,
    rows:[
      {outcome:"WIN",team:"A"},
      {outcome:"WIN",team:"B"},
      {outcome:"DNP",team:"C"},
    ],
  });
  assert.equal(out.ok,true);
  assert.equal(out.playType,"power");
  assert.equal(out.pickCount,2);
  assert.equal(out.payoutMultiplier,3);
});

test("DNP/Reboot same-team remainder refunds lineup", () => {
  const out=settlePrizePicksLineup({
    playType:"power",
    allowSameGameStandard:true,
    rows:[
      {outcome:"WIN",team:"A"},
      {outcome:"WIN",team:"A"},
      {outcome:"DNP",team:"B"},
    ],
  });
  assert.equal(out.ok,true);
  assert.equal(out.status,"REFUND_SAME_TEAM_AFTER_DNP_REBOOT");
  assert.equal(out.refund,true);
  assert.equal(out.payoutMultiplier,1);
});

test("tie does not trigger same-team ineligibility and uses 2-pick special payout", () => {
  const out=settlePrizePicksLineup({
    playType:"power",
    allowSameGameStandard:true,
    rows:[
      {outcome:"WIN",team:"A"},
      {outcome:"TIE",team:"A"},
    ],
  });
  assert.equal(out.ok,true);
  assert.equal(out.status,"SETTLED_TIE_SPECIAL");
  assert.equal(out.payoutMultiplier,1.5);
  assert.equal(out.refund,false);
});

test("2-pick tie plus loss is a loss for Power and Flex", () => {
  for(const playType of ["power","flex"]){
    const out=settlePrizePicksLineup({
      playType,
      allowSameGameStandard:true,
      rows:[
        {outcome:"LOSS",team:"A"},
        {outcome:"TIE",team:"B"},
      ],
    });
    assert.equal(out.ok,true);
    assert.equal(out.status,"SETTLED_LOSS");
    assert.equal(out.payoutMultiplier,0);
  }
});

test("2-pick DNP or Reboot returns entry rather than paying a multiplier", () => {
  const dnp=settlePrizePicksLineup({
    playType:"power",
    allowSameGameStandard:true,
    rows:[
      {outcome:"WIN",team:"A"},
      {outcome:"DNP",team:"B"},
    ],
  });
  assert.equal(dnp.status,"REFUND_REVERTED_BELOW_MINIMUM");
  assert.equal(dnp.payoutMultiplier,1);

  const reboot=settlePrizePicksLineup({
    playType:"flex",
    allowSameGameStandard:true,
    rows:[
      {outcome:"WIN",team:"A"},
      {outcome:"REBOOT",side:"MORE",team:"B"},
    ],
  });
  assert.equal(reboot.status,"REFUND_REVERTED_BELOW_MINIMUM");
  assert.equal(reboot.payoutMultiplier,1);
});

test("Reboot settlement rejects LESS because published Reboots apply only to MORE", () => {
  const out=settlePrizePicksLineup({
    playType:"power",
    allowSameGameStandard:true,
    rows:[
      {outcome:"WIN",team:"A"},
      {outcome:"REBOOT",side:"LESS",team:"B"},
      {outcome:"WIN",team:"C"},
    ],
  });
  assert.equal(out.ok,false);
  assert.equal(out.status,"INVALID_REBOOT_SIDE");
});

test("settlement still fails closed for special-projection lineups without submitted payout", () => {
  const out=settlePrizePicksLineup({
    playType:"power",
    rows:[
      {outcome:"WIN",team:"A",odds_tier:"demon"},
      {outcome:"WIN",team:"B",odds_tier:"standard"},
    ],
  });
  assert.equal(out.ok,false);
  assert.equal(out.status,"ACTUAL_PAYOUT_REQUIRED_SPECIAL_PROJECTION");
});
