/**
 * Research-only CFB scoring challengers (Models B / C / D).
 *
 * Model A = production CFB-FBIS-v2 fitted A/A (repaired current-season inputs).
 * These challengers MUST NOT authorize wagers or mutate production coefficients.
 * Coefficients here are documented research hypotheses evaluated via walk-forward —
 * not Oct-17-tuned hacks.
 */

import { projectCfbFbisV2Production } from "./cfbFbisV2.js";
import { projectCfbCoreShadow, CFB_CORE_SHADOW_ID } from "./cfbCoreChallenger.js";
import { currentSeasonWeight, CFB_PRIOR_DECAY_DEFAULT_K } from "./cfbPriorDecay.js";

export const CFB_MODEL_A_ID = "CFB-FBIS-v2";
export const CFB_MODEL_B_ID = "CFB-CURRENT-SEASON-v1";
export const CFB_MODEL_C_ID = "CFB-CURRENT-CORE-v1";
export const CFB_MODEL_D_ID = "CFB-COMBINED-RESEARCH-v1";

const RESEARCH = Object.freeze({
  authority: "research_only",
  canQualify: false,
  canAuthorizeWager: false,
  canInfluenceProduction: false,
  marketInformed: false,
});

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/**
 * Model A — repaired champion (fitted A/A, production package).
 */
export function projectModelA(game = {}) {
  const proj = projectCfbFbisV2Production(game);
  return {
    ...proj,
    challengerId: "A",
    modelId: CFB_MODEL_A_ID,
    label: "Repaired Champion",
    ...RESEARCH,
    // Model A mirrors production projection authority flags from the package,
    // but challenger wrappers never authorize wagers.
    canAuthorizeWager: false,
    canQualify: false,
  };
}

/**
 * Model B — current-season dominant.
 *
 * Same fitted A/A ridge as production, but research shrinkK=3 (documented in
 * cfbPriorDecay candidate set) so that at n=6 current weight is 67% not 50%.
 * Does not invent success/PPO betas — those stay unused until a leakage-safe refit.
 */
export function projectModelB(game = {}, { shrinkK = 3 } = {}) {
  const primary = projectCfbFbisV2Production(game, { shrinkK });
  const homeGames =
    num(game?.cfbFbisV2Input?.home?.gamesPlayed ?? game?.cfbDeepInput?.home?.gamesPlayed) || 0;
  const awayGames =
    num(game?.cfbFbisV2Input?.away?.gamesPlayed ?? game?.cfbDeepInput?.away?.gamesPlayed) || 0;

  return {
    ...primary,
    ok: Boolean(primary?.ok),
    challengerId: "B",
    modelId: CFB_MODEL_B_ID,
    label: "Current-Season Performance",
    researchShrinkK: shrinkK,
    currentSeasonWeights: {
      home: currentSeasonWeight(homeGames, shrinkK),
      away: currentSeasonWeight(awayGames, shrinkK),
      productionDefaultK: CFB_PRIOR_DECAY_DEFAULT_K,
      productionHomeWeight: currentSeasonWeight(homeGames, CFB_PRIOR_DECAY_DEFAULT_K),
    },
    ...RESEARCH,
    home: round1(primary?.home),
    away: round1(primary?.away),
    margin: round1((primary?.home ?? 0) - (primary?.away ?? 0)),
    total: round1((primary?.home ?? 0) + (primary?.away ?? 0)),
  };
}

/**
 * Model C — Model B + CORE cross when a verified OOS CORE artifact exists.
 * Without artifact, returns ok:false with explicit reason (never fabricates CORE scores).
 */
export function projectModelC(game = {}, { coreArtifact = null, season = 2026, week = 8 } = {}) {
  const base = projectModelB(game);
  if (!base?.ok) {
    return { ...base, challengerId: "C", modelId: CFB_MODEL_C_ID, label: "Current-Season + CORE", ...RESEARCH };
  }
  if (!coreArtifact) {
    return {
      ok: false,
      challengerId: "C",
      modelId: CFB_MODEL_C_ID,
      label: "Current-Season + CORE",
      reason: "FITTED_CORE_ARTIFACT_UNAVAILABLE",
      baseline: base,
      ...RESEARCH,
      note: "CORE incremental value left unproven until a verified OOS artifact exists",
    };
  }
  const home = game?.cfbFbisV2Input?.home || game?.cfbDeepInput?.home || {};
  const away = game?.cfbFbisV2Input?.away || game?.cfbDeepInput?.away || {};
  const shadow = projectCfbCoreShadow(
    {
      home,
      away,
      season,
      week,
      kickoff: game.kickoff || game.start,
      baselineHome: base.home,
      baselineAway: base.away,
    },
    coreArtifact
  );
  if (!shadow?.ok) {
    return {
      ok: false,
      challengerId: "C",
      modelId: CFB_MODEL_C_ID,
      label: "Current-Season + CORE",
      reason: shadow?.reason || "CORE_SHADOW_FAILED",
      baseline: base,
      coreDiagnostics: shadow,
      ...RESEARCH,
    };
  }
  return {
    ...shadow,
    challengerId: "C",
    modelId: CFB_MODEL_C_ID,
    label: "Current-Season + CORE",
    baseline: base,
    ...RESEARCH,
  };
}

/**
 * Model D — simple research blend of A and B margins/totals (equal weight).
 * Not a fitted combined model; used only for comparative diagnostics until
 * leakage-safe combined training lands.
 */
export function projectModelD(game = {}) {
  const a = projectModelA(game);
  const b = projectModelB(game);
  if (!a?.ok || !b?.ok) {
    return {
      ok: false,
      challengerId: "D",
      modelId: CFB_MODEL_D_ID,
      label: "Optimized Combined (research blend)",
      reason: "missing-A-or-B",
      a,
      b,
      ...RESEARCH,
    };
  }
  const margin = (a.margin + b.margin) / 2;
  const total = (a.total + b.total) / 2;
  const home = round1((total + margin) / 2);
  const away = round1((total - margin) / 2);
  return {
    ok: true,
    challengerId: "D",
    modelId: CFB_MODEL_D_ID,
    label: "Optimized Combined (research blend)",
    home,
    away,
    margin: round1(home - away),
    total: round1(home + away),
    components: { A: { home: a.home, away: a.away }, B: { home: b.home, away: b.away } },
    blend: "equal-weight-margin-total",
    ...RESEARCH,
    note: "Equal-weight A/B blend is a diagnostic placeholder, not a trained ensemble",
  };
}

export function projectAllChallengers(game = {}, opts = {}) {
  return {
    A: projectModelA(game),
    B: projectModelB(game, opts),
    C: projectModelC(game, opts),
    D: projectModelD(game),
    coreShadowId: CFB_CORE_SHADOW_ID,
  };
}
