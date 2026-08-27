/**
 * Model-layer evaluation on frozen forecasts.
 * Leader is Brier / log loss / calibration — not closest-to-binary on a few games.
 */

import { brierScore, logLoss } from "./pricing.js";

function mean(xs) {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
}

const LAYERS = ["market", "espn", "score", "pal", "form"];

function pOf(row, layer) {
  const layers = row.layers || {};
  if (layer === "market") return layers.market ?? row.pMarket ?? row.impliedHome ?? null;
  if (layer === "espn") return layers.espn ?? row.pEspn ?? null;
  if (layer === "score") return layers.score ?? row.pScore ?? null;
  if (layer === "pal") return layers.pal ?? row.pPal ?? row.palPHome ?? null;
  if (layer === "form") return layers.form ?? row.pForm ?? null;
  return layers[layer] ?? null;
}

export function layerDiagnostics(rows) {
  const graded = (rows || []).filter(
    (r) => r.actualHome != null && r.actualAway != null && r.actualHome !== r.actualAway
  );
  const blocks = LAYERS.map((layer) => {
    const xs = graded.filter((r) => pOf(r, layer) != null);
    const n = xs.length;
    if (!n) {
      return {
        layer,
        n: 0,
        brier: null,
        logLoss: null,
        winnerHit: null,
        unavailable: true,
      };
    }
    const brier = mean(xs.map((r) => brierScore(pOf(r, layer), r.actualHome > r.actualAway ? 1 : 0)));
    const ll = mean(xs.map((r) => logLoss(pOf(r, layer), r.actualHome > r.actualAway ? 1 : 0)));
    const hit = xs.filter((r) => (pOf(r, layer) > 0.5) === (r.actualHome > r.actualAway)).length / n;
    return { layer, n, brier, logLoss: ll, winnerHit: hit, unavailable: false };
  });
  const scored = blocks.filter((b) => !b.unavailable && b.brier != null);
  const leader = scored.length
    ? [...scored].sort((a, b) => a.brier - b.brier || a.logLoss - b.logLoss)[0].layer
    : null;
  return {
    layers: blocks,
    leader,
    method: "brier-logloss",
    note: "Layer leader is lowest Brier on frozen forecasts. Closest-to-binary counts are not used.",
  };
}
