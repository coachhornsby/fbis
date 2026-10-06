/**
 * MLB-PITCHER-K-v1
 * Research-only pitcher strikeout model.
 *
 * Independent baseline: season K/9.
 * Opportunity: expected innings (Pal may supply this as an external feature).
 * Opponent interaction: Ballpark Pal lineup-vs-pitcher kVs, bounded.
 * Pal's final pitcher-K projection is NEVER used as the FBIS projection.
 */

export const MLB_PITCHER_K_ID = "MLB-PITCHER-K-v1";

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round2(v) { return Math.round(v * 100) / 100; }

export function palLineupKFactor(kVs, n) {
  const k = finite(kVs);
  const sample = finite(n);
  if (k == null || sample == null || sample < 3) return 1;
  // Conservative research coefficient pending PIT calibration:
  // ±100 Pal vs-typical maps to ±20% K expectation, bounded ±15%.
  return clamp(1 + (k / 100) * 0.20, 0.85, 1.15);
}

function poissonCdf(k, lambda) {
  if (!(lambda >= 0)) return null;
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i;
    sum += term;
  }
  return Math.min(1, sum);
}

export function overProbability(lambda, line) {
  const lam = finite(lambda);
  const ln = finite(line);
  if (lam == null || ln == null || lam < 0) return null;
  // Half-lines only for binary over/under probability. Whole-number lines have push mass.
  if (Math.abs(ln - (Math.floor(ln) + 0.5)) > 1e-9) return null;
  const maxUnder = Math.floor(ln);
  return 1 - poissonCdf(maxUnder, lam);
}

export function projectPitcherK(input = {}) {
  const seasonK9 = finite(input.seasonK9);
  const seasonIp = finite(input.seasonIp);
  const expectedInnings = finite(input.expectedInnings);
  if (seasonK9 == null || expectedInnings == null || seasonK9 <= 0 || expectedInnings <= 0) {
    return { modelId: MLB_PITCHER_K_ID, ok: false, reason: "season-k9-or-expected-innings-missing", canQualify: false };
  }
  const lineupFactor = palLineupKFactor(input.palKVs, input.palMatchupN);
  const projectedKs = clamp((seasonK9 / 9) * expectedInnings * lineupFactor, 0.25, 14);
  const thresholds = {};
  for (let line = 3.5; line <= 10.5; line += 1) thresholds[line.toFixed(1)] = round2(overProbability(projectedKs, line));
  return {
    modelId: MLB_PITCHER_K_ID,
    version: "research-v1",
    role: "shadow",
    family: "pitcher-strikeouts",
    ok: true,
    pitcherId: input.pitcherId ?? null,
    pitcherName: input.pitcherName ?? null,
    team: input.team ?? null,
    opponent: input.opponent ?? null,
    projectedKs: round2(projectedKs),
    thresholds,
    coverage: {
      seasonK9: true,
      seasonIp: seasonIp != null,
      expectedInnings: true,
      palLineupMatchup: finite(input.palKVs) != null && finite(input.palMatchupN) >= 3,
      officialLineup: input.lineupsOfficial === true,
    },
    decomposition: {
      seasonK9: round2(seasonK9),
      seasonIp,
      expectedInnings: round2(expectedInnings),
      palKVs: finite(input.palKVs),
      palMatchupN: finite(input.palMatchupN),
      palLineupKFactor: round2(lineupFactor),
    },
    independent: true,
    marketInformed: false,
    canQualify: false,
    provenance: {
      ballparkPalRole: "opportunity-and-lineup-feature-provider-plus-external-challenger",
      palExpectedInningsUsed: input.expectedInningsSource === "ballpark-pal",
      palLineupKVsUsed: finite(input.palKVs) != null,
      palFinalKProjectionUsed: false,
      palPropProbabilityUsed: false,
      marketUsed: false,
      coefficientStatus: "research-uncalibrated-pending-PIT-validation",
    },
  };
}
