/**
 * PrizePicks standard lineup payout / EV math.
 *
 * Source of truth for standard Player Pick payouts:
 * PrizePicks Help Center, updated 2026-09-09.
 *
 * Adjusted contests (Demon/Goblin, same-game reductions, promos, combined
 * Player + Team Picks, fees, etc.) MUST provide the actual quoted payout
 * schedule/multiplier from the user's details screen. We do not infer it.
 */

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export const PRIZEPICKS_PLATFORM_RULES = Object.freeze({
  scope:"ALL_PLAYER_PICK_SPORTS",
  payoutRulesUpdated:"2026-09-09",
  dnpRebootTieRulesUpdated:"2026-08-11",
  platformWide:["power-flex-payouts","dnp-reversion","tie-reversion","same-team-refund-after-dnp-reboot","special-projection-payout-adjustment"],
  sportSpecific:["dnp-activity-threshold","reboot-eligibility","official-scoring"],
});

export const PRIZEPICKS_STANDARD_POWER = Object.freeze({
  2: 3,
  3: 6,
  4: 10,
  5: 20,
  6: 37.5,
});

export const PRIZEPICKS_STANDARD_FLEX = Object.freeze({
  2: Object.freeze({ 2: 2, 1: 0.5 }),
  3: Object.freeze({ 3: 3, 2: 1 }),
  4: Object.freeze({ 4: 6, 3: 1.5 }),
  5: Object.freeze({ 5: 10, 4: 2, 3: 0.4 }),
  6: Object.freeze({ 6: 25, 5: 2, 4: 0.4 }),
});

function hasAdjustedProjection(rows = []) {
  return rows.some((r) => {
    const tier = String(r?.oddsTier ?? r?.odds_tier ?? "standard").toLowerCase();
    return tier !== "standard";
  });
}

function anySameGame(rows = []) {
  const seen = new Set();
  for (const row of rows) {
    const id = String(row?.eventId ?? row?.fbisEventId ?? row?.gameId ?? row?.game_id ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

export function standardPowerBreakEvenPerLeg(pickCount) {
  const n = Number(pickCount);
  const multiplier = PRIZEPICKS_STANDARD_POWER[n];
  if (!multiplier) return null;
  return (1 / multiplier) ** (1 / n);
}

function binomialProbability(n, k, p) {
  let choose = 1;
  for (let i = 1; i <= k; i++) choose = choose * (n - k + i) / i;
  return choose * (p ** k) * ((1 - p) ** (n - k));
}

export function standardFlexExpectedReturnAtEqualLegProbability(pickCount, p) {
  const n = Number(pickCount);
  const prob = finite(p);
  const payouts = PRIZEPICKS_STANDARD_FLEX[n];
  if (!payouts || prob == null || prob < 0 || prob > 1) return null;
  let expectedReturn = 0;
  for (const [correctRaw, multiplier] of Object.entries(payouts)) {
    const correct = Number(correctRaw);
    expectedReturn += binomialProbability(n, correct, prob) * Number(multiplier);
  }
  return expectedReturn;
}

export function standardFlexBreakEvenPerLeg(pickCount) {
  const n = Number(pickCount);
  if (!PRIZEPICKS_STANDARD_FLEX[n]) return null;
  let lo = 0.5, hi = 0.999999;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const er = standardFlexExpectedReturnAtEqualLegProbability(n, mid);
    if (er == null) return null;
    if (er >= 1) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function enumerateOutcomes(probabilities, idx, correct, probability, payouts, acc) {
  if (idx >= probabilities.length) {
    const multiplier = Number(payouts?.[correct] ?? 0);
    acc.expectedReturn += probability * multiplier;
    if (multiplier > 0) acc.payoutProbability += probability;
    acc.outcomes.push({ correct, probability, multiplier });
    return;
  }
  const p = probabilities[idx];
  enumerateOutcomes(probabilities, idx + 1, correct + 1, probability * p, payouts, acc);
  enumerateOutcomes(probabilities, idx + 1, correct, probability * (1 - p), payouts, acc);
}

export function evaluatePrizePicksLineup({
  rows = [],
  playType = "power",
  quotedMultiplier = null,
  quotedPayoutSchedule = null,
  allowSameGameStandard = false,
} = {}) {
  const type = String(playType || "power").trim().toLowerCase();
  const pickCount = rows.length;
  const probabilities = rows.map((r) => finite(
    r?.estimatedHitProbability ??
    r?.hitProbability ??
    r?.probability ??
    r?.leanProbability
  ));

  if (pickCount < 2 || pickCount > 6) {
    return { ok:false, status:"INVALID_PICK_COUNT", pickCount, expectedReturn:null, evPerUnit:null };
  }
  if (probabilities.some((p) => p == null || p < 0 || p > 1)) {
    return { ok:false, status:"MISSING_LEG_PROBABILITY", pickCount, expectedReturn:null, evPerUnit:null };
  }

  const adjustedTier = hasAdjustedProjection(rows);
  const sameGame = anySameGame(rows);

  // PrizePicks states that Demon/Goblin and some same-game combinations can
  // alter standard payouts. Fail closed unless the actual quote is supplied.
  if ((adjustedTier || (sameGame && !allowSameGameStandard)) && quotedMultiplier == null && !quotedPayoutSchedule) {
    return {
      ok:false,
      status: adjustedTier ? "ACTUAL_PAYOUT_REQUIRED_SPECIAL_PROJECTION" : "ACTUAL_PAYOUT_REQUIRED_SAME_GAME",
      pickCount,
      playType:type,
      expectedReturn:null,
      evPerUnit:null,
      payoutAdjusted:true,
      reason:"use-details-screen-payout-before-authorizing-lineup",
    };
  }

  if (type === "power") {
    const multiplier = finite(quotedMultiplier) ?? PRIZEPICKS_STANDARD_POWER[pickCount] ?? null;
    if (multiplier == null || multiplier <= 0) {
      return { ok:false, status:"PAYOUT_UNAVAILABLE", pickCount, playType:type, expectedReturn:null, evPerUnit:null };
    }
    const winProbability = probabilities.reduce((a, p) => a * p, 1);
    const expectedReturn = winProbability * multiplier;
    return {
      ok:true,
      status: quotedMultiplier == null ? "STANDARD_PAYOUT" : "QUOTED_PAYOUT",
      playType:type,
      pickCount,
      probabilities,
      payoutMultiplier:multiplier,
      winProbability,
      expectedReturn,
      evPerUnit:expectedReturn - 1,
      payoutAdjusted:quotedMultiplier != null || adjustedTier || sameGame,
    };
  }

  if (type === "flex") {
    const payouts = quotedPayoutSchedule || PRIZEPICKS_STANDARD_FLEX[pickCount] || null;
    if (!payouts) {
      return { ok:false, status:"PAYOUT_UNAVAILABLE", pickCount, playType:type, expectedReturn:null, evPerUnit:null };
    }
    const acc = { expectedReturn:0, payoutProbability:0, outcomes:[] };
    enumerateOutcomes(probabilities, 0, 0, 1, payouts, acc);
    return {
      ok:true,
      status: quotedPayoutSchedule ? "QUOTED_PAYOUT" : "STANDARD_PAYOUT",
      playType:type,
      pickCount,
      probabilities,
      payoutSchedule:payouts,
      payoutProbability:clamp(acc.payoutProbability,0,1),
      expectedReturn:acc.expectedReturn,
      evPerUnit:acc.expectedReturn - 1,
      payoutAdjusted:Boolean(quotedPayoutSchedule) || adjustedTier || sameGame,
      outcomeDistribution:acc.outcomes.sort((a,b)=>b.correct-a.correct),
    };
  }

  return { ok:false, status:"UNSUPPORTED_PLAY_TYPE", pickCount, playType:type, expectedReturn:null, evPerUnit:null };
}


function normalizedOutcome(row = {}) {
  return String(row.outcome ?? row.result ?? row.settlement ?? "").trim().toUpperCase();
}
function normalizedTeam(row = {}) {
  return String(row.team ?? row.teamAbbr ?? row.team_abbr ?? "").trim().toUpperCase() || null;
}
function normalizedSide(row = {}) {
  return String(row.side ?? row.candidateSide ?? row.selection ?? "").trim().toUpperCase() || null;
}

export const PRIZEPICKS_REVERSION = Object.freeze({
  power: Object.freeze({
    6:{playType:"power",pickCount:5},
    5:{playType:"power",pickCount:4},
    4:{playType:"power",pickCount:3},
    3:{playType:"power",pickCount:2},
    2:{refund:true},
  }),
  flex: Object.freeze({
    6:{playType:"flex",pickCount:5},
    5:{playType:"flex",pickCount:4},
    4:{playType:"flex",pickCount:3},
    3:{playType:"power",pickCount:2},
    2:{refund:true},
  }),
});

export function revertPrizePicksTier(playType, pickCount, steps = 1) {
  let type=String(playType||"").toLowerCase();
  let count=Number(pickCount);
  const n=Math.max(0,Math.floor(Number(steps)||0));
  for(let i=0;i<n;i++){
    const next=PRIZEPICKS_REVERSION?.[type]?.[count];
    if(!next) return {ok:false,status:"REVERSION_RULE_UNAVAILABLE",playType:type,pickCount:count};
    if(next.refund) return {ok:true,status:"REFUND",refund:true,playType:type,pickCount:count};
    type=next.playType;
    count=next.pickCount;
  }
  return {ok:true,status:"REVERTED",refund:false,playType:type,pickCount:count};
}

function payoutForSettledTier(playType,pickCount,correct){
  if(playType==="power"){
    return correct===pickCount ? (PRIZEPICKS_STANDARD_POWER[pickCount] ?? 0) : 0;
  }
  if(playType==="flex"){
    return Number(PRIZEPICKS_STANDARD_FLEX?.[pickCount]?.[correct] ?? 0);
  }
  return 0;
}

/**
 * Settle a standard Player Picks lineup under published DNP/Reboot/Tie rules.
 *
 * Supported outcomes per row:
 * WIN | LOSS | DNP | REBOOT | TIE
 *
 * For adjusted-payout lineups, pass quotedMultiplier/quotedPayoutSchedule from
 * the submitted details screen; otherwise settlement fails closed.
 */
export function settlePrizePicksLineup({
  rows = [],
  playType = "power",
  quotedMultiplier = null,
  quotedPayoutSchedule = null,
  allowSameGameStandard = false,
} = {}) {
  const originalType=String(playType||"power").trim().toLowerCase();
  const originalPickCount=rows.length;
  if(originalPickCount<2||originalPickCount>6){
    return {ok:false,status:"INVALID_PICK_COUNT",payoutMultiplier:null};
  }

  const adjustedTier=hasAdjustedProjection(rows);
  const sameGame=anySameGame(rows);
  if((adjustedTier || (sameGame&&!allowSameGameStandard)) && quotedMultiplier==null && !quotedPayoutSchedule){
    return {
      ok:false,
      status:adjustedTier?"ACTUAL_PAYOUT_REQUIRED_SPECIAL_PROJECTION":"ACTUAL_PAYOUT_REQUIRED_SAME_GAME",
      payoutMultiplier:null,
      reason:"use-details-screen-payout-before-settlement",
    };
  }

  const outcomes=rows.map(normalizedOutcome);
  if(outcomes.some((x)=>!["WIN","LOSS","DNP","REBOOT","TIE"].includes(x))){
    return {ok:false,status:"UNRESOLVED_OUTCOME",payoutMultiplier:null};
  }

  // Reboots are only valid on MORE selections under the published policy.
  for(let i=0;i<rows.length;i++){
    if(outcomes[i]==="REBOOT" && normalizedSide(rows[i])!=="MORE"){
      return {ok:false,status:"INVALID_REBOOT_SIDE",payoutMultiplier:null,index:i};
    }
  }

  const removedIndexes=new Set();
  outcomes.forEach((x,i)=>{if(x==="DNP"||x==="REBOOT")removedIndexes.add(i);});

  // DNP/Reboot can make the remaining lineup same-team and therefore refundable.
  // Ties remain part of the lineup for this eligibility check.
  if(removedIndexes.size){
    const remaining=rows.filter((_,i)=>!removedIndexes.has(i));
    const teams=[...new Set(remaining.map(normalizedTeam).filter(Boolean))];
    if(remaining.length>0 && teams.length===1){
      return {
        ok:true,status:"REFUND_SAME_TEAM_AFTER_DNP_REBOOT",refund:true,
        payoutMultiplier:1,originalPlayType:originalType,originalPickCount,
      };
    }
  }

  const neutralCount=outcomes.filter((x)=>x==="DNP"||x==="REBOOT"||x==="TIE").length;
  const tieCount=outcomes.filter((x)=>x==="TIE").length;
  const activeWins=outcomes.filter((x)=>x==="WIN").length;
  const activeLosses=outcomes.filter((x)=>x==="LOSS").length;

  if(neutralCount===0){
    const payout = originalType==="power"
      ? (finite(quotedMultiplier) ?? payoutForSettledTier("power",originalPickCount,activeWins))
      : quotedPayoutSchedule
        ? Number(quotedPayoutSchedule?.[activeWins] ?? 0)
        : payoutForSettledTier("flex",originalPickCount,activeWins);
    return {
      ok:true,status:payout>0?"SETTLED_WIN":"SETTLED_LOSS",refund:false,
      payoutMultiplier:payout,playType:originalType,pickCount:originalPickCount,
      correct:activeWins,incorrect:activeLosses,dnp:0,reboot:0,tie:0,
    };
  }

  const reverted=revertPrizePicksTier(originalType,originalPickCount,neutralCount);
  if(!reverted.ok) return {...reverted,payoutMultiplier:null};

  // Published 2-pick tie exception: one correct + one tie pays 1.5x;
  // one loss + one tie loses. This applies to both original Power and Flex.
  if(originalPickCount===2 && tieCount===1 && neutralCount===1){
    const payout=activeWins===1?1.5:0;
    return {
      ok:true,status:payout>0?"SETTLED_TIE_SPECIAL":"SETTLED_LOSS",
      refund:false,payoutMultiplier:payout,playType:originalType,pickCount:2,
      correct:activeWins,incorrect:activeLosses,
      dnp:outcomes.filter(x=>x==="DNP").length,
      reboot:outcomes.filter(x=>x==="REBOOT").length,
      tie:1,
    };
  }

  // A 2-pick Power/Flex with DNP/Reboot is a refund.
  if(reverted.refund){
    return {
      ok:true,status:"REFUND_REVERTED_BELOW_MINIMUM",refund:true,payoutMultiplier:1,
      originalPlayType:originalType,originalPickCount,
      dnp:outcomes.filter(x=>x==="DNP").length,
      reboot:outcomes.filter(x=>x==="REBOOT").length,
      tie:tieCount,
    };
  }

  // PrizePicks publishes the tier transition for ties, but not every possible
  // multi-neutral combination at the 2-pick boundary. Fail closed rather than
  // infer a payout not explicitly described.
  if(reverted.pickCount===2 && tieCount>0 && neutralCount>1){
    return {
      ok:false,status:"COMBINED_NEUTRAL_SETTLEMENT_REQUIRES_DETAILS_SCREEN",
      payoutMultiplier:null,playType:reverted.playType,pickCount:reverted.pickCount,
    };
  }

  let payout;
  if(reverted.playType==="power"){
    // Once a lineup reverts, active losses still lose a Power lineup.
    if(activeLosses>0) payout=0;
    else if(quotedMultiplier!=null && neutralCount===0) payout=finite(quotedMultiplier);
    else payout=PRIZEPICKS_STANDARD_POWER[reverted.pickCount] ?? 0;
  }else{
    payout=quotedPayoutSchedule
      ? Number(quotedPayoutSchedule?.[activeWins] ?? 0)
      : payoutForSettledTier("flex",reverted.pickCount,activeWins);
  }

  return {
    ok:true,
    status:payout>0?"SETTLED_REVERTED":"SETTLED_LOSS",
    refund:false,
    payoutMultiplier:payout,
    originalPlayType:originalType,
    originalPickCount,
    playType:reverted.playType,
    pickCount:reverted.pickCount,
    correct:activeWins,
    incorrect:activeLosses,
    dnp:outcomes.filter(x=>x==="DNP").length,
    reboot:outcomes.filter(x=>x==="REBOOT").length,
    tie:tieCount,
  };
}
