/**
 * MLB (and sport) over/under disagreement diagnostics.
 * Measure first. Do not lower totals from this file.
 * Forecast rows stay separate from strategy tickets; this report joins them on purpose.
 */

import { mean, mae, rmse, bias, withinShare, median } from "./metrics.js";
import { brierScore, logLoss } from "./pricing.js";

const BUCKETS = [
  { key: "lt-2", label: "< -2", lo: -Infinity, hi: -2 },
  { key: "n2-n1", label: "-2 to -1", lo: -2, hi: -1 },
  { key: "n1-0", label: "-1 to 0", lo: -1, hi: 0 },
  { key: "0-1", label: "0 to +1", lo: 0, hi: 1 },
  { key: "1-2", label: "+1 to +2", lo: 1, hi: 2 },
  { key: "gt2", label: "> +2", lo: 2, hi: Infinity },
];

function modelTotal(row, which) {
  if (which === "pal") return row.palHome != null && row.palAway != null ? row.palHome + row.palAway : null;
  if (which === "proprietary" || which === "savant") {
    return row.projHome != null && row.projAway != null ? row.projHome + row.projAway : null;
  }
  if (which === "market") return marketTotal(row);
  if (row.projHome != null && row.palHome != null) return (row.projHome + row.palHome + row.projAway + row.palAway) / 2;
  return row.projTotal ?? (row.projHome != null && row.projAway != null ? row.projHome + row.projAway : null);
}

function actualTotal(row) {
  if (row.actualTotal != null) return row.actualTotal;
  if (row.actualHome != null && row.actualAway != null) return row.actualHome + row.actualAway;
  return null;
}

function marketTotal(row) {
  return row.pinTotal ?? row.marketTotal ?? row.lineTotal ?? null;
}

function edge(row, which = "ensemble") {
  const proj = modelTotal(row, which);
  const mkt = marketTotal(row);
  if (proj == null || mkt == null) return null;
  return proj - mkt;
}

function sideFromEdge(e) {
  if (e == null) return null;
  if (e > 0) return "OVER";
  if (e < 0) return "UNDER";
  return "PUSH";
}

/** Inclusive left / exclusive right except outer buckets. Exact -2,-1,0,+1,+2 land on labeled inner edges. */
function bucketOf(e) {
  if (e == null || !Number.isFinite(e)) return null;
  if (e < -2) return BUCKETS[0];
  if (e < -1) return BUCKETS[1];
  if (e < 0) return BUCKETS[2];
  if (e < 1) return BUCKETS[3];
  if (e <= 2) return BUCKETS[4];
  return BUCKETS[5];
}

function withN(value, n) {
  return { value: n ? value : null, n };
}

function ticketKey(t) {
  return `${t.sport || ""}:${t.date}:${t.gameId || t.game_id}:${t.market}`;
}

function joinTickets(rows, tickets) {
  const byGame = new Map();
  for (const t of tickets || []) {
    if (String(t.market || "").toUpperCase() !== "TOTAL") continue;
    const gid = String(t.gameId || t.game_id || "");
    const keys = [
      `${t.date}:${gid}`,
      gid,
      ticketKey(t),
    ];
    for (const k of keys) {
      if (!byGame.has(k)) byGame.set(k, t);
    }
  }
  return (rows || []).map((r) => {
    const t =
      byGame.get(`${r.date}:${r.id}`) ||
      byGame.get(String(r.id)) ||
      byGame.get(`${r.sport || ""}:${r.date}:${r.id}:TOTAL`);
    if (!t) return r;
    return {
      ...r,
      ticketQualified: true,
      ticketMarket: t.market,
      ticketSide: t.side,
      ticketEv: t.ev,
      profit: t.profit,
      clv: t.clv,
      ticketId: t.id,
      executionPrice: t.executionPrice ?? t.execution_price ?? null,
    };
  });
}

export function overDiagnostics(rows, { minEdge = 0.35, tickets = [] } = {}) {
  const joined = joinTickets(rows, tickets);
  const graded = joined.filter((r) => actualTotal(r) != null);
  const withMkt = joined.filter((r) => marketTotal(r) != null && modelTotal(r, "proprietary") != null);
  const missingMkt = joined.filter((r) => modelTotal(r, "proprietary") != null && marketTotal(r) == null);
  const palRows = joined.filter((r) => modelTotal(r, "pal") != null);
  const candidates = withMkt.filter((r) => {
    const e = edge(r, "proprietary");
    return e != null && Math.abs(e) >= minEdge;
  });
  const overs = candidates.filter((r) => sideFromEdge(edge(r, "proprietary")) === "OVER");
  const unders = candidates.filter((r) => sideFromEdge(edge(r, "proprietary")) === "UNDER");
  const qualified = joined.filter((r) => r.ticketQualified && String(r.ticketMarket || "").toUpperCase() === "TOTAL");
  const qOver = qualified.filter((r) => r.ticketSide === "OVER");
  const qUnder = qualified.filter((r) => r.ticketSide === "UNDER");
  const qSettled = qualified.filter((r) => r.actualTotal != null || actualTotal(r) != null);

  const gradedOvers = overs.filter((r) => actualTotal(r) != null);
  const gradedUnders = unders.filter((r) => actualTotal(r) != null);

  const hitRate = (xs, want) => {
    const g = xs.filter((r) => resultSide(r) && resultSide(r) !== "PUSH");
    if (!g.length) return { value: null, n: 0 };
    return { value: g.filter((r) => resultSide(r) === want).length / g.length, n: g.length };
  };

  const metricMean = (xs, get) => {
    const vals = xs.map(get).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
    return { value: vals.length ? mean(vals) : null, n: vals.length };
  };

  const buckets = BUCKETS.map((b) => {
    const xs = graded.filter((r) => bucketOf(edge(r, "proprietary"))?.key === b.key);
    const totErrs = xs
      .map((r) => {
        const p = modelTotal(r, "proprietary");
        const a = actualTotal(r);
        return p != null && a != null ? p - a : null;
      })
      .filter((v) => v != null);
    const pRows = xs.filter((r) => r.pOver != null && resultSide(r) && resultSide(r) !== "PUSH");
    const overHit = hitRate(xs, "OVER");
    return {
      key: b.key,
      label: b.label,
      n: xs.length,
      actualAvg: xs.length ? mean(xs.map(actualTotal).filter((v) => v != null)) : null,
      projectedAvg: xs.length ? mean(xs.map((r) => modelTotal(r, "proprietary")).filter((v) => v != null)) : null,
      mae: totErrs.length ? mae(totErrs) : null,
      bias: totErrs.length ? bias(totErrs) : null,
      overRate: overHit.value,
      overRateN: overHit.n,
      brier: pRows.length ? mean(pRows.map((r) => brierScore(r.pOver, resultSide(r) === "OVER" ? 1 : 0))) : null,
      brierN: pRows.length,
      logLoss: pRows.length ? mean(pRows.map((r) => logLoss(r.pOver, resultSide(r) === "OVER" ? 1 : 0))) : null,
      logLossN: pRows.length,
    };
  });

  const fbisErrs = graded
    .map((r) => {
      const p = modelTotal(r, "proprietary");
      const a = actualTotal(r);
      return p != null && a != null ? p - a : null;
    })
    .filter((v) => v != null);
  const palErrs = graded
    .map((r) => {
      const p = modelTotal(r, "pal");
      const a = actualTotal(r);
      return p != null && a != null ? p - a : null;
    })
    .filter((v) => v != null);
  const ensErrs = graded
    .map((r) => {
      const p = modelTotal(r, "ensemble");
      const a = actualTotal(r);
      return p != null && a != null ? p - a : null;
    })
    .filter((v) => v != null);

  const palN = palRows.length;
  const palUnavailable = palN === 0;

  const settledOver = qOver.filter((r) => actualTotal(r) != null);
  const settledUnder = qUnder.filter((r) => actualTotal(r) != null);
  const clvOver = metricMean(qOver, (r) => r.clv);
  const clvUnder = metricMean(qUnder, (r) => r.clv);
  const roiOver = metricMean(qOver, (r) => r.profit);
  const roiUnder = metricMean(qUnder, (r) => r.profit);
  const unitsOver = qOver.map((r) => r.profit).filter((v) => v != null && Number.isFinite(Number(v)));
  const unitsUnder = qUnder.map((r) => r.profit).filter((v) => v != null && Number.isFinite(Number(v)));
  const posClv = qualified.filter((r) => r.clv != null && Number.isFinite(Number(r.clv)));
  const posClvPct = posClv.length ? { value: posClv.filter((r) => r.clv > 0).length / posClv.length, n: posClv.length } : { value: null, n: 0 };

  const pRows = graded.filter((r) => r.pOver != null && resultSide(r) && resultSide(r) !== "PUSH");
  const overHit = hitRate(qSettled.filter((r) => r.ticketSide === "OVER"), "OVER");
  const underHit = hitRate(qSettled.filter((r) => r.ticketSide === "UNDER"), "UNDER");

  return {
    n: withMkt.length,
    nWithPinTotal: withMkt.length,
    nMissingPinTotal: missingMkt.length,
    graded: graded.length,
    candidates: { over: overs.length, under: unders.length },
    qualified: { over: qOver.length, under: qUnder.length, n: qualified.length },
    settled: { n: qSettled.length, over: settledOver.length, under: settledUnder.length },
    results: {
      wins: qSettled.filter((r) => r.profit != null && Number(r.profit) > 0).length,
      losses: qSettled.filter((r) => r.profit != null && Number(r.profit) < 0).length,
      pushes: qSettled.filter((r) => r.profit === 0 || resultSide(r) === "PUSH").length,
      n: qSettled.length,
    },
    executed: {
      over: qOver.filter((r) => r.executionPrice != null || r.profit != null).length,
      under: qUnder.filter((r) => r.executionPrice != null || r.profit != null).length,
    },
    avgEdge: {
      over: metricMean(overs, (r) => edge(r, "proprietary")),
      under: metricMean(unders, (r) => edge(r, "proprietary")),
    },
    avgEv: {
      over: metricMean(qOver, (r) => r.ticketEv ?? r.ev),
      under: metricMean(qUnder, (r) => r.ticketEv ?? r.ev),
    },
    actualOu: {
      overHit: hitRate(gradedOvers, "OVER").value,
      underHit: hitRate(gradedUnders, "UNDER").value,
      overN: gradedOvers.length,
      underN: gradedUnders.length,
    },
    hitRate: { over: overHit, under: underHit },
    units: {
      over: { value: unitsOver.length ? unitsOver.reduce((s, v) => s + Number(v), 0) : null, n: unitsOver.length },
      under: { value: unitsUnder.length ? unitsUnder.reduce((s, v) => s + Number(v), 0) : null, n: unitsUnder.length },
    },
    roi: { over: roiOver, under: roiUnder },
    clv: { over: clvOver, under: clvUnder, positiveShare: posClvPct },
    bias: {
      proprietary: withN(fbisErrs.length ? bias(fbisErrs) : null, fbisErrs.length),
      pal: { value: palUnavailable ? null : palErrs.length ? bias(palErrs) : null, n: palErrs.length, unavailable: palUnavailable },
      ensemble: withN(ensErrs.length ? bias(ensErrs) : null, ensErrs.length),
    },
    medianAbs: withN(fbisErrs.length ? median(fbisErrs.map(Math.abs)) : null, fbisErrs.length),
    rmse: withN(fbisErrs.length ? rmse(fbisErrs) : null, fbisErrs.length),
    brier: withN(pRows.length ? mean(pRows.map((r) => brierScore(r.pOver, resultSide(r) === "OVER" ? 1 : 0))) : null, pRows.length),
    logLoss: withN(pRows.length ? mean(pRows.map((r) => logLoss(r.pOver, resultSide(r) === "OVER" ? 1 : 0))) : null, pRows.length),
    pal: { n: palN, unavailable: palUnavailable },
    buckets,
    within1: withN(fbisErrs.length ? withinShare(fbisErrs, 1) : null, fbisErrs.length),
  };
}

function resultSide(row) {
  const a = actualTotal(row);
  const m = marketTotal(row);
  if (a == null || m == null) return null;
  if (a > m) return "OVER";
  if (a < m) return "UNDER";
  return "PUSH";
}

export { BUCKETS as OVER_BUCKETS, edge as totalDisagreement, bucketOf };
