/**
 * Research summary after harvest. Forecast metrics, not ticket W/L, decide model health.
 */

import { overDiagnostics } from "./overDiagnostics.js";

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "n/a";
  return Number(n).toFixed(d);
}

function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return "n/a";
  return `${(Number(n) * 100).toFixed(1)}%`;
}

export function buildDailyReport(sport, rows, extra = {}) {
  const acc = extra.accuracy || { n: 0 };
  const over = sport === "mlb" || sport === "cfb" ? overDiagnostics(rows || []) : null;
  const n = acc.n || 0;
  const lines = [
    `${String(sport).toUpperCase()} — ${extra.title || extra.date || "daily"}`,
    "",
    `Games projected: ${(rows || []).length}`,
    `Games graded: ${n}`,
    "",
    `Team score MAE: ${fmt(acc.maeTeam)}`,
    `Home MAE: ${fmt(acc.maeHome)}  Away MAE: ${fmt(acc.maeAway)}`,
    `Total MAE: ${fmt(acc.maeTotal)}  RMSE: ${fmt(acc.rmseTotal)}  bias: ${fmt(acc.biasTotal)}`,
    `Margin MAE: ${fmt(acc.maeMargin)}  RMSE: ${fmt(acc.rmseMargin)}`,
    `Median error: ${fmt(acc.medianError)}  Median abs: ${fmt(acc.medianAbs)}`,
    "",
    `Winner (score): ${pct(acc.winnerHitScore)}`,
    `Winner (prob): ${pct(acc.winnerHitProb)}`,
    `Brier FBIS: ${fmt(acc.brierModel, 3)}  Pinnacle: ${fmt(acc.brierMarket, 3)}`,
    `Log loss FBIS: ${fmt(acc.logLossModel, 3)}  Pinnacle: ${fmt(acc.logLossMarket, 3)}`,
    `Brier improvement vs market: ${fmt(acc.brierImprovement, 3)}`,
    "",
  ];
  if (over) {
    lines.push(
      `OVER candidates: ${over.candidates.over}  UNDER candidates: ${over.candidates.under}`,
      `Qualified OVER: ${over.qualified.over}  UNDER: ${over.qualified.under}`,
      `Proprietary total bias: ${fmt(over.bias.proprietary)}  Pal bias: ${fmt(over.bias.pal)}`,
      ""
    );
  }
  lines.push(
    "MODEL ASSESSMENT:",
    n < 20
      ? `Sample is ${n}. Do not infer degradation from this window.`
      : `Graded N=${n}. Use MAE/Brier/log loss/calibration, not last night's W/L.`
  );
  return {
    sport,
    date: extra.date || null,
    title: extra.title || null,
    body: lines.join("\n"),
    n,
    accuracy: acc,
    over,
    generatedAt: new Date().toISOString(),
  };
}
