/**
 * Market Engine — vig, fair price, EV, CLV.
 * Multiplicative de-vig. Never compare FBIS p to raw implied.
 * Incomplete two-way markets are not priced.
 */

import { MODEL_VERSION } from "./weights.js";
import { validateCanonicalProbability } from "./probability.js";

export { MODEL_VERSION };

export function validAmericanOdds(american) {
  const n = Number(american);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) >= 100;
}

export function americanToImplied(american) {
  const n = Number(american);
  if (!validAmericanOdds(n)) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

export function impliedToAmerican(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  if (n >= 0.5) return Math.round((-100 * n) / (1 - n));
  return Math.round((100 * (1 - n)) / n);
}

export function americanProfit(odds, stake = 1) {
  const n = Number(odds);
  if (!validAmericanOdds(n)) return null;
  if (n > 0) return (n / 100) * stake;
  return (100 / Math.abs(n)) * stake;
}

/** Multiplicative hold. Incomplete pairs are not a market. */
export function twoWayMarket(priceA, priceB) {
  const rawA = americanToImplied(priceA);
  const rawB = americanToImplied(priceB);
  if (rawA == null || rawB == null) {
    return {
      priceA: priceA ?? null,
      priceB: priceB ?? null,
      rawA,
      rawB,
      vig: null,
      noVigA: null,
      noVigB: null,
      complete: false,
    };
  }
  const s = rawA + rawB;
  return {
    priceA: Number(priceA),
    priceB: Number(priceB),
    rawA,
    rawB,
    vig: s - 1,
    noVigA: rawA / s,
    noVigB: rawB / s,
    complete: true,
  };
}

/** EV as ROI on 1u stake. +0.063 = +6.3% expectancy. Decimal p only — never a percentage such as 57.2. */
export function expectedRoi(pWin, american) {
  const validated = validateCanonicalProbability(pWin);
  if (!validated.ok) return null;
  const n = Number(american);
  if (!validAmericanOdds(n)) return null;
  const profit = n > 0 ? n / 100 : 100 / Math.abs(n);
  return validated.modelProbability * profit - (1 - validated.modelProbability);
}

export function evAnomaly({ fair, pinPrice, ev, marketComplete }) {
  if (!marketComplete) return { quarantined: true, reason: "incomplete-market" };
  if (!validateCanonicalProbability(fair).ok) {
    return { quarantined: true, reason: "invalid-model-probability" };
  }
  if (!validAmericanOdds(pinPrice)) return { quarantined: true, reason: "invalid-american-odds" };
  if (!Number.isFinite(Number(ev))) return { quarantined: true, reason: "invalid-ev" };
  const price = Number(pinPrice);
  const roi = Number(ev);
  if (price < 0 && roi > 1) return { quarantined: true, reason: "favorite-ev-over-100pct-impossible" };
  if (roi < -1) return { quarantined: true, reason: "ev-below-minus-100pct-impossible" };
  if (roi > 1) return { quarantined: false, warning: "ev-over-100pct-verify-long-odds" };
  return { quarantined: false, warning: null };
}

/**
 * Probability CLV in percentage points for the side you bet.
 * closeNoVig − entryNoVig. Positive = the market moved toward your side after you bet.
 */
export function probabilityClv(entryNoVigSide, closeNoVigSide) {
  if (entryNoVigSide == null || closeNoVigSide == null) return null;
  const a = Number(entryNoVigSide);
  const b = Number(closeNoVigSide);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) * 100;
}

export function priceSelection({ pWin, pinPrice, twoWay, side = "A" }) {
  const complete = twoWay?.complete === true;
  const noVig = complete ? (side === "B" ? twoWay.noVigB : twoWay.noVigA) : null;
  const price = pinPrice ?? (side === "B" ? twoWay?.priceB : twoWay?.priceA);
  const ev = complete ? expectedRoi(pWin, price) : null;
  const probEdge = pWin != null && noVig != null ? pWin - noVig : null;
  const anomaly = evAnomaly({ fair: pWin, pinPrice: price, ev, marketComplete: complete });
  return {
    fair: pWin ?? null,
    fairAmerican: impliedToAmerican(pWin),
    pinPrice: price ?? null,
    pinVig: complete ? twoWay.vig : null,
    implied: noVig,
    probEdge: probEdge != null ? probEdge * 100 : null,
    ev,
    evPct: ev != null ? ev * 100 : null,
    expectedRoiLabel: ev == null ? null : `Expected ROI ${ev >= 0 ? "+" : ""}${(ev * 100).toFixed(1)}%`,
    sharp: "Pinnacle",
    marketComplete: complete,
    evWarning: anomaly.warning || null,
    quarantined: Boolean(anomaly.quarantined),
    quarantineReason: anomaly.reason || null,
  };
}

export function pinMarkets(game) {
  const o = game?.odds || {};
  return {
    ml: twoWayMarket(o.pinHomeMl ?? o.fairHomeMl, o.pinAwayMl ?? o.fairAwayMl),
    spread: twoWayMarket(o.pinSpreadHomePrice, o.pinSpreadAwayPrice),
    total: twoWayMarket(o.pinOverPrice, o.pinUnderPrice),
    f5ml: twoWayMarket(o.f5?.homeMl, o.f5?.awayMl),
    f5total: twoWayMarket(o.f5?.overPrice, o.f5?.underPrice),
  };
}

/** Soft-book display label. Never writes into pin* fields. */
export function softBookLabel(odds = {}) {
  const soft = String(odds.softSource || "").toLowerCase();
  if (soft.includes("sharp")) return "DK/FD";
  if (soft.includes("rundown") || soft.includes("therundown")) return "Soft";
  if (soft.includes("espn")) return "ESPN";
  if (soft) return soft;
  if (odds.softPresent) return "Soft";
  return "Soft";
}

/**
 * Prefer complete Pinnacle two-ways. When Pin is credit-exhausted / absent,
 * fall back to soft DK/FD (or other soft) two-ways for lean/qualified EV.
 * Soft prices never populate odds.pin*.
 */
export function benchmarkMarkets(game) {
  const o = game?.odds || {};
  const pin = pinMarkets(game);
  const pinComplete = Boolean(pin.ml.complete || pin.spread.complete || pin.total.complete || o.pinPresent);
  if (pinComplete) {
    return { ...pin, source: "Pinnacle", softFallback: false };
  }
  return {
    ml: twoWayMarket(o.homeMl, o.awayMl),
    spread: twoWayMarket(
      o.softSpreadHomePrice ?? o.spreadPrice,
      o.softSpreadAwayPrice ?? o.spreadPrice
    ),
    total: twoWayMarket(
      o.softOverPrice ?? o.totalPrice,
      o.softUnderPrice ?? o.totalPrice
    ),
    f5ml: pin.f5ml,
    f5total: pin.f5total,
    source: softBookLabel(o),
    softFallback: true,
  };
}

export function benchmarkSpreadPrice(game, side, softFallback) {
  const o = game?.odds || {};
  if (!softFallback) {
    return side === "HOME" ? o.pinSpreadHomePrice ?? null : o.pinSpreadAwayPrice ?? null;
  }
  return side === "HOME"
    ? o.softSpreadHomePrice ?? o.spreadPrice ?? null
    : o.softSpreadAwayPrice ?? o.spreadPrice ?? null;
}

export function benchmarkTotalPrice(game, over, softFallback) {
  const o = game?.odds || {};
  if (!softFallback) {
    return over ? o.pinOverPrice ?? null : o.pinUnderPrice ?? null;
  }
  return over
    ? o.softOverPrice ?? o.totalPrice ?? null
    : o.softUnderPrice ?? o.totalPrice ?? null;
}

export function tagFromEv(ev) {
  if (ev == null) return "LEAN";
  if (ev >= 0.08) return "CONVICTION";
  if (ev >= 0.05) return "STRONG";
  if (ev >= 0.03) return "STANDARD";
  return "LEAN";
}

export function brierScore(p, y) {
  if (p == null || y == null) return null;
  return (Number(p) - Number(y)) ** 2;
}

export function logLoss(p, y) {
  if (p == null || y == null) return null;
  const pp = Math.min(1 - 1e-9, Math.max(1e-9, Number(p)));
  return y ? -Math.log(pp) : -Math.log(1 - pp);
}
