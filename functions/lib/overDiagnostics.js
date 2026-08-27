/**
 * MLB (and sport) over/under disagreement diagnostics.
 * Measure first. Do not lower totals from this file.
 */

import { mean, mae, rmse, bias, withinShare } from "./metrics.js";
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

function bucketOf(e) {
  if (e == null) return null;
  if (e > 2) return BUCKETS[5];
  if (e > 1) return BUCKETS[4];
  if (e >= 0) return BUCKETS[3];
  if (e >= -1) return BUCKETS[2];
  if (e >= -2) return BUCKETS[1];
  return BUCKETS[0];
}

function summarize(rows, getVal) {
  const xs = rows.map(getVal).filter((v) => v != null && Number.isFinite(v));
  return xs.length ? mean(xs) : null;
}

function resultSide(row) {
  const a = actualTotal(row);
  const m = marketTotal(row);
  if (a == null || m == null) return null;
  if (a > m) return "OVER";
  if (a < m) return "UNDER";
  return "PUSH";
}

export function overDiagnostics(rows, { minEdge = 0.35 } = {}) {
  const graded = (rows || []).filter((r) => actualTotal(r) != null);
  const withMkt = (rows || []).filter((r) => marketTotal(r) != null && modelTotal(r, "proprietary") != null);
  const candidates = withMkt.filter((r) => {
    const e = edge(r, "proprietary");
    return e != null && Math.abs(e) >= minEdge;
  });
  const overs = candidates.filter((r) => sideFromEdge(edge(r, "proprietary")) === "OVER");
  const unders = candidates.filter((r) => sideFromEdge(edge(r, "proprietary")) === "UNDER");
  const qualified = (rows || []).filter((r) => r.ticketQualified && r.ticketMarket === "TOTAL");
  const qOver = qualified.filter((r) => r.ticketSide === "OVER");
  const qUnder = qualified.filter((r) => r.ticketSide === "UNDER");

  const gradedOvers = overs.filter((r) => actualTotal(r) != null);
  const gradedUnders = unders.filter((r) => actualTotal(r) != null);

  const hitRate = (xs, want) => {
    const g = xs.filter((r) => resultSide(r) && resultSide(r) !== "PUSH");
    if (!g.length) return null;
    return g.filter((r) => resultSide(r) === want).length / g.length;
  };

  const buckets = BUCKETS.map((b) => {
    const xs = graded.filter((r) => {
      const e = edge(r, "proprietary");
      const bk = bucketOf(e);
      return bk?.key === b.key;
    });
    const totErrs = xs
      .map((r) => {
        const p = modelTotal(r, "proprietary");
        const a = actualTotal(r);
        return p != null && a != null ? p - a : null;
      })
      .filter((v) => v != null);
    const pRows = xs.filter((r) => r.pOver != null && resultSide(r) && resultSide(r) !== "PUSH");
    return {
      key: b.key,
      label: b.label,
      n: xs.length,
      actualAvg: summarize(xs, actualTotal),
      projectedAvg: summarize(xs, (r) => modelTotal(r, "proprietary")),
      mae: mae(totErrs),
      bias: bias(totErrs),
      overRate: hitRate(xs, "OVER"),
      brier: pRows.length
        ? mean(pRows.map((r) => brierScore(r.pOver, resultSide(r) === "OVER" ? 1 : 0)))
        : null,
      logLoss: pRows.length
        ? mean(pRows.map((r) => logLoss(r.pOver, resultSide(r) === "OVER" ? 1 : 0)))
        : null,
    };
  });

  const fbisBias = bias(
    graded
      .map((r) => {
        const p = modelTotal(r, "proprietary");
        const a = actualTotal(r);
        return p != null && a != null ? p - a : null;
      })
      .filter((v) => v != null)
  );
  const palBias = bias(
    graded
      .map((r) => {
        const p = modelTotal(r, "pal");
        const a = actualTotal(r);
        return p != null && a != null ? p - a : null;
      })
      .filter((v) => v != null)
  );
  const ensBias = bias(
    graded
      .map((r) => {
        const p = modelTotal(r, "ensemble");
        const a = actualTotal(r);
        return p != null && a != null ? p - a : null;
      })
      .filter((v) => v != null)
  );

  const clvOver = mean(qOver.map((r) => r.clv).filter((v) => v != null));
  const clvUnder = mean(qUnder.map((r) => r.clv).filter((v) => v != null));
  const roiOver = mean(qOver.filter((r) => r.profit != null).map((r) => r.profit));
  const roiUnder = mean(qUnder.filter((r) => r.profit != null).map((r) => r.profit));

  return {
    n: withMkt.length,
    graded: graded.length,
    candidates: { over: overs.length, under: unders.length },
    qualified: { over: qOver.length, under: qUnder.length },
    avgEdge: {
      over: summarize(overs, (r) => edge(r, "proprietary")),
      under: summarize(unders, (r) => edge(r, "proprietary")),
    },
    avgEv: {
      over: summarize(qOver, (r) => r.ticketEv ?? r.ev),
      under: summarize(qUnder, (r) => r.ticketEv ?? r.ev),
    },
    actualOu: {
      overHit: hitRate(gradedOvers, "OVER"),
      underHit: hitRate(gradedUnders, "UNDER"),
      overN: gradedOvers.length,
      underN: gradedUnders.length,
    },
    roi: { over: roiOver, under: roiUnder },
    clv: { over: clvOver, under: clvUnder },
    bias: { proprietary: fbisBias, pal: palBias, ensemble: ensBias },
    buckets,
    rmse: rmse(
      graded
        .map((r) => {
          const p = modelTotal(r, "proprietary");
          const a = actualTotal(r);
          return p != null && a != null ? p - a : null;
        })
        .filter((v) => v != null)
    ),
    within1: withinShare(
      graded
        .map((r) => {
          const p = modelTotal(r, "proprietary");
          const a = actualTotal(r);
          return p != null && a != null ? p - a : null;
        })
        .filter((v) => v != null),
      1
    ),
  };
}

export { BUCKETS as OVER_BUCKETS, edge as totalDisagreement };
