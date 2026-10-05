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
