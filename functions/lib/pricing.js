/**
 * Market Engine — vig, fair price, EV.
 * Multiplicative de-vig. Never compare FBIS p to raw implied.
 */

export const MODEL_VERSION = "FBIS-v1.0";

export function americanToImplied(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

export function impliedToAmerican(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  if (n >= 0.5) return Math.round((-100 * n) / (1 - n));
  return Math.round((100 * (1 - n)) / n);
}

/** Multiplicative hold. vig is the extra probability (0.041 = 4.1% juice). */
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
      noVigA: rawA,
      noVigB: rawB,
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
  };
}

/** EV as ROI on 1u stake. +0.063 = +6.3% expectancy. */
export function expectedRoi(pWin, american) {
  const p = Number(pWin);
  const n = Number(american);
  if (!Number.isFinite(p) || p < 0 || p > 1) return null;
  if (!Number.isFinite(n) || n === 0) return null;
  const profit = n > 0 ? n / 100 : 100 / Math.abs(n);
  return p * profit - (1 - p);
}

export function priceSelection({ pWin, pinPrice, twoWay, side = "A" }) {
  const noVig = side === "B" ? twoWay?.noVigB : twoWay?.noVigA;
  const price = pinPrice ?? (side === "B" ? twoWay?.priceB : twoWay?.priceA);
  const ev = expectedRoi(pWin, price);
  const probEdge = pWin != null && noVig != null ? pWin - noVig : null;
  return {
    fair: pWin ?? null,
    fairAmerican: impliedToAmerican(pWin),
    pinPrice: price ?? null,
    pinVig: twoWay?.vig ?? null,
    implied: noVig ?? null,
    probEdge: probEdge != null ? probEdge * 100 : null,
    ev,
    evPct: ev != null ? ev * 100 : null,
    sharp: "Pinnacle",
  };
}

export function pinMarkets(game) {
  const o = game?.odds || {};
  return {
    ml: twoWayMarket(o.pinHomeMl ?? o.fairHomeMl, o.pinAwayMl ?? o.fairAwayMl),
    spread: twoWayMarket(o.pinSpreadHomePrice, o.pinSpreadAwayPrice),
    total: twoWayMarket(o.pinOverPrice, o.pinUnderPrice),
    f5ml: twoWayMarket(o.f5?.homeMl, o.f5?.awayMl),
  };
}

export function tagFromEv(ev, probEdgePct) {
  if (ev != null) {
    if (ev >= 0.08) return "CONVICTION";
    if (ev >= 0.05) return "STRONG";
    if (ev >= 0.03) return "STANDARD";
    return "LEAN";
  }
  if (probEdgePct >= 6) return "CONVICTION";
  if (probEdgePct >= 4) return "STRONG";
  return "STANDARD";
}
