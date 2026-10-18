/**
 * Historical research cases from the Oct 11 board audit.
 * These are NOT executable betting opportunities.
 * Without frozen PIT feature inputs, cases are marked NOT_FULLY_RECONSTRUCTABLE.
 */

export const NFL_HISTORICAL_SCORE_CASES = Object.freeze([
  {
    id: "HOU@TEN-2026-10-11",
    matchup: "HOU@TEN",
    topic: "spread-compression",
    boardSnapshot: { fbisAway: 20.9, fbisHome: 20.4, fbisMargin: -0.5, marketHomeSpreadImplied: 7, disagreement: 6.5 },
    reconstructability: "NOT_FULLY_RECONSTRUCTABLE",
    missingRecords: [
      "immutable per-game nflFeatures.home/away at freeze time",
      "versioned publication hash for HOU@TEN",
      "component decomposition checksum at publication",
    ],
    note: "Do not substitute current team profiles or injury reports into this historical case.",
  },
  {
    id: "DET@ARI-2026-10-11",
    matchup: "DET@ARI",
    topic: "total-disagreement",
    boardSnapshot: { fbisTotal: 44.7, marketTotal: 54.5, disagreement: -9.8 },
    reconstructability: "NOT_FULLY_RECONSTRUCTABLE",
    missingRecords: ["frozen pace/possessions inputs", "immutable decomposition for DET@ARI"],
    note: "Historical research only.",
  },
  {
    id: "MIN@NO-2026-10-11",
    matchup: "MIN@NO",
    topic: "favorite-reversal",
    boardSnapshot: { fbisHomeMargin: 4.0, marketFavorite: "MIN -1.5", disagreement: 5.5 },
    reconstructability: "NOT_FULLY_RECONSTRUCTABLE",
    missingRecords: ["frozen QB/team EPA inputs", "immutable publication for MIN@NO"],
    note: "Historical research only.",
  },
  {
    id: "PHI@JAX-2026-10-11",
    matchup: "PHI@JAX",
    topic: "margin-difference-international",
    boardSnapshot: { fbisHomeMargin: 2.2, marketHomeSpread: -7.5, disagreement: -5.3, totalGap: 6.7 },
    reconstructability: "PARTIAL",
    missingRecords: [
      "full slate of frozen feature vectors for all 13 games that week",
    ],
    note: "D1 published_projections held one v1.2 record for event 401872981 (PHI@JAX) during the Oct 11 audit; treat as partial evidence only.",
    knownPublicationEventId: "401872981",
  },
  {
    id: "SF@SEA-2026-10-11",
    matchup: "SF@SEA",
    topic: "total-disagreement",
    boardSnapshot: { fbisTotal: 51.6, marketTotal: 46.5, disagreement: 5.1 },
    reconstructability: "NOT_FULLY_RECONSTRUCTABLE",
    missingRecords: ["frozen NGS + pass-EPA inputs", "ablation-ready PIT snapshot"],
    note: "Investigate QB vs team-offense double-counting only with frozen inputs.",
  },
]);

export function summarizeHistoricalScoreCases(cases = NFL_HISTORICAL_SCORE_CASES) {
  const by = {};
  for (const c of cases) {
    by[c.reconstructability] = (by[c.reconstructability] || 0) + 1;
  }
  return {
    schema: "nfl-historical-score-cases-v1",
    n: cases.length,
    byReconstructability: by,
    executableBettingOpportunities: false,
    cases,
  };
}
