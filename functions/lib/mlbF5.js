/**
 * FBIS MLB First Five (F5) market math.
 *
 * Independent score means come from MLB-FBIS-v2. This module converts those
 * run expectations into discrete score probabilities and compares them with
 * F5 sportsbook quotes. Market quotes never feed back into score projection.
 */

export const MLB_F5_MARKET_VERSION = "research-v1-poisson-market";

export const MLB_F5_THRESHOLDS = Object.freeze({
  moneyline: 0.03,
  spread: 0.03,
  total: 0.035,
  minEv: 0.02,
});

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, digits = 4) {
  if (!Number.isFinite(Number(v))) return null;
  const p = 10 ** digits;
  return Math.round(Number(v) * p) / p;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v)));
}

export function americanImplied(price) {
  const n = finite(price);
  if (n == null || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

export function noVigPair(priceA, priceB) {
  const a = americanImplied(priceA);
  const b = americanImplied(priceB);
  if (a == null || b == null || a + b <= 0) return null;
  const sum = a + b;
  return { a: a / sum, b: b / sum, hold: sum - 1 };
}

function profitPerUnit(price) {
  const n = finite(price);
  if (n == null || n === 0) return null;
  return n > 0 ? n / 100 : 100 / Math.abs(n);
}

/** EV per 1u stake. Push returns stake and contributes zero profit/loss. */
export function americanEv({ pWin, pLoss, price }) {
  const win = finite(pWin);
  const loss = finite(pLoss);
  const profit = profitPerUnit(price);
  if (win == null || loss == null || profit == null) return null;
  return win * profit - loss;
}

export function poissonPmf(lambda, maxRuns = 20) {
  const l = clamp(finite(lambda) ?? 0, 0.05, 12);
  const max = Math.max(8, Math.min(30, Math.trunc(maxRuns)));
  const out = new Array(max + 1).fill(0);
  out[0] = Math.exp(-l);
  let sum = out[0];
  for (let k = 1; k <= max; k += 1) {
    out[k] = out[k - 1] * l / k;
    sum += out[k];
  }
  return out.map((p) => p / sum);
}

export function f5ScoreDistribution(homeMean, awayMean, maxRuns = 20) {
  const home = finite(homeMean);
  const away = finite(awayMean);
  if (home == null || away == null || home <= 0 || away <= 0) return null;
  const hp = poissonPmf(home, maxRuns);
  const ap = poissonPmf(away, maxRuns);
  const scores = [];
  for (let h = 0; h < hp.length; h += 1) {
    for (let a = 0; a < ap.length; a += 1) {
      scores.push({ home: h, away: a, p: hp[h] * ap[a] });
    }
  }
  return scores;
}

function settle(scores, predicate) {
  let win = 0;
  let loss = 0;
  let push = 0;
  for (const row of scores || []) {
    const result = predicate(row.home, row.away);
    if (result > 0) win += row.p;
    else if (result < 0) loss += row.p;
    else push += row.p;
  }
  const decision = win + loss;
  return {
    win: round(win, 6),
    loss: round(loss, 6),
    push: round(push, 6),
    conditionalWin: decision > 0 ? round(win / decision, 6) : null,
  };
}

export function f5MoneylineProbabilities(homeMean, awayMean) {
  const scores = f5ScoreDistribution(homeMean, awayMean);
  if (!scores) return null;
  const home = settle(scores, (h, a) => h > a ? 1 : h < a ? -1 : 0);
  const away = settle(scores, (h, a) => a > h ? 1 : a < h ? -1 : 0);
  return { home, away };
}

export function f5TotalProbabilities(homeMean, awayMean, line) {
  const scores = f5ScoreDistribution(homeMean, awayMean);
  const n = finite(line);
  if (!scores || n == null) return null;
  const over = settle(scores, (h, a) => h + a > n ? 1 : h + a < n ? -1 : 0);
  const under = settle(scores, (h, a) => h + a < n ? 1 : h + a > n ? -1 : 0);
  return { over, under };
}

export function f5SpreadProbabilities(homeMean, awayMean, homeLine) {
  const scores = f5ScoreDistribution(homeMean, awayMean);
  const n = finite(homeLine);
  if (!scores || n == null) return null;
  const home = settle(scores, (h, a) => h + n > a ? 1 : h + n < a ? -1 : 0);
  const awayLine = -n;
  const away = settle(scores, (h, a) => a + awayLine > h ? 1 : a + awayLine < h ? -1 : 0);
  return { home, away };
}

function sideRow({ market, side, line, price, probs, fair, threshold, book }) {
  if (!probs || price == null || fair == null) return null;
  const modelConditional = finite(probs.conditionalWin);
  if (modelConditional == null) return null;
  const edge = modelConditional - fair;
  const ev = americanEv({ pWin: probs.win, pLoss: probs.loss, price });
  const qualifiesResearch = edge >= threshold && ev != null && ev >= MLB_F5_THRESHOLDS.minEv;
  return {
    market,
    side,
    line: line == null ? null : Number(line),
    price: Number(price),
    book: book || null,
    modelProbability: round(modelConditional),
    modelWinProbability: round(probs.win),
    pushProbability: round(probs.push),
    marketNoVigProbability: round(fair),
    modelEdge: round(edge),
    expectedRoi: round(ev),
    researchQualified: Boolean(qualifiesResearch),
  };
}

/** Compare independent FBIS F5 expected runs with game.odds.f5. */
export function evaluateMlbF5Market({ projection, market, lineupsOfficial = null } = {}) {
  const homeMean = finite(projection?.home);
  const awayMean = finite(projection?.away);
  if (homeMean == null || awayMean == null) {
    return { available: false, reason: "F5_PROJECTION_UNAVAILABLE", canQualify: false };
  }
  const base = {
    available: Boolean(market),
    modelVersion: MLB_F5_MARKET_VERSION,
    canQualify: false,
    canAuthorize: false,
    qualificationState: "RESEARCH_ONLY",
    homeMean: round(homeMean, 3),
    awayMean: round(awayMean, 3),
    totalMean: round(homeMean + awayMean, 3),
    marginMean: round(homeMean - awayMean, 3),
    lineupsOfficial: lineupsOfficial == null ? null : Boolean(lineupsOfficial),
    riskFlags: lineupsOfficial === false ? ["LINEUPS_NOT_OFFICIAL"] : [],
    markets: [],
    bestResearchSignal: null,
  };
  if (!market) return { ...base, reason: "F5_MARKET_UNAVAILABLE" };
  const book = market.book || market.sharp || null;
  const rows = [];
  if (market.homeMl != null && market.awayMl != null) {
    const noVig = noVigPair(market.homeMl, market.awayMl);
    const p = f5MoneylineProbabilities(homeMean, awayMean);
    if (noVig && p) {
      rows.push(sideRow({ market: "moneyline", side: "home", line: null, price: market.homeMl, probs: p.home, fair: noVig.a, threshold: MLB_F5_THRESHOLDS.moneyline, book }));
      rows.push(sideRow({ market: "moneyline", side: "away", line: null, price: market.awayMl, probs: p.away, fair: noVig.b, threshold: MLB_F5_THRESHOLDS.moneyline, book }));
    }
  }
  if (market.spread != null && market.spreadHomePrice != null && market.spreadAwayPrice != null) {
    const noVig = noVigPair(market.spreadHomePrice, market.spreadAwayPrice);
    const p = f5SpreadProbabilities(homeMean, awayMean, market.spread);
    if (noVig && p) {
      rows.push(sideRow({ market: "spread", side: "home", line: market.spread, price: market.spreadHomePrice, probs: p.home, fair: noVig.a, threshold: MLB_F5_THRESHOLDS.spread, book }));
      rows.push(sideRow({ market: "spread", side: "away", line: -Number(market.spread), price: market.spreadAwayPrice, probs: p.away, fair: noVig.b, threshold: MLB_F5_THRESHOLDS.spread, book }));
    }
  }
  if (market.total != null && market.overPrice != null && market.underPrice != null) {
    const noVig = noVigPair(market.overPrice, market.underPrice);
    const p = f5TotalProbabilities(homeMean, awayMean, market.total);
    if (noVig && p) {
      rows.push(sideRow({ market: "total", side: "over", line: market.total, price: market.overPrice, probs: p.over, fair: noVig.a, threshold: MLB_F5_THRESHOLDS.total, book }));
      rows.push(sideRow({ market: "total", side: "under", line: market.total, price: market.underPrice, probs: p.under, fair: noVig.b, threshold: MLB_F5_THRESHOLDS.total, book }));
    }
  }
  const usable = rows.filter(Boolean);
  const ranked = usable.filter((r) => r.researchQualified)
    .sort((a, b) => (b.expectedRoi ?? -99) - (a.expectedRoi ?? -99) || (b.modelEdge ?? -99) - (a.modelEdge ?? -99));
  return {
    ...base,
    available: usable.length > 0,
    reason: usable.length ? null : "F5_PAIRED_PRICE_UNAVAILABLE",
    markets: usable,
    bestResearchSignal: ranked[0] || null,
  };
}
