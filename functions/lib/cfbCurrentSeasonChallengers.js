/**
 * Research-only CFB scoring challengers (Models B / C / D / E).
 *
 * Model A = production CFB-FBIS-v2 fitted A/A (repaired current-season inputs).
 * These challengers MUST NOT authorize wagers or mutate production coefficients.
 * Fitted advanced packages come from fold3 walk-forward research artifacts —
 * not Oct-17-tuned hacks.
 */

import { projectCfbFbisV2Production } from "./cfbFbisV2.js";
import { projectCfbCoreShadow, CFB_CORE_SHADOW_ID } from "./cfbCoreChallenger.js";
import { currentSeasonWeight, CFB_PRIOR_DECAY_DEFAULT_K } from "./cfbPriorDecay.js";
import { getResearchFittedArtifact } from "./cfbResearchModelFamilies.js";

export const CFB_MODEL_A_ID = "CFB-FBIS-v2";
export const CFB_MODEL_B_ID = "CFB-RESEARCH-B";
export const CFB_MODEL_C_ID = "CFB-RESEARCH-C";
export const CFB_MODEL_D_ID = "CFB-RESEARCH-D";
export const CFB_MODEL_E_ID = "CFB-RESEARCH-E";

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
    canAuthorizeWager: false,
    canQualify: false,
  };
}

/**
 * Model B — fitted advanced pass/rush ridge (research package).
 * Falls back to shrinkK sensitivity only when the fitted artifact is missing.
 */
export function projectModelB(game = {}, { shrinkK = 3, fitted = null } = {}) {
  const artifact = fitted || getResearchFittedArtifact("B");
  if (artifact?.margin?.beta?.length) {
    const primary = projectCfbFbisV2Production(game, { fitted: artifact });
    return {
      ...primary,
      ok: Boolean(primary?.ok),
      challengerId: "B",
      modelId: CFB_MODEL_B_ID,
      label: "Advanced Pass/Rush (fitted research)",
      fittedArtifactId: artifact.id,
      oosDecision: artifact.oosValidation?.decision || null,
      improvesOverChampion: artifact.oosValidation?.improvesOverChampion === true,
      ...RESEARCH,
      home: round1(primary?.home),
      away: round1(primary?.away),
      margin: round1((primary?.home ?? 0) - (primary?.away ?? 0)),
      total: round1((primary?.home ?? 0) + (primary?.away ?? 0)),
      projectionEnabled: false,
      canPublishForecasts: false,
    };
  }
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
    label: "Current-Season Performance (shrink scaffold)",
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
    note: "Fitted B artifact unavailable — shrinkK scaffold only",
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
 * Model D — SDV challenger. Fails closed until a validated SDV fitted artifact exists.
 */
export function projectModelD(game = {}, { sdvArtifact = null } = {}) {
  void game;
  if (!sdvArtifact) {
    return {
      ok: false,
      challengerId: "D",
      modelId: CFB_MODEL_D_ID,
      label: "Advanced CFBD + SDV",
      reason: "FITTED_SDV_ARTIFACT_UNAVAILABLE",
      ...RESEARCH,
      note: "SDV never enters fitted champion; no validated SDV challenger artifact",
    };
  }
  return {
    ok: false,
    challengerId: "D",
    modelId: CFB_MODEL_D_ID,
    label: "Advanced CFBD + SDV",
    reason: "SDV_ARTIFACT_NOT_WIRED",
    ...RESEARCH,
  };
}

/**
 * Model E — fitted combined advanced CFBD (pass/rush + drive + situational).
 */
export function projectModelE(game = {}, { fitted = null } = {}) {
  const artifact = fitted || getResearchFittedArtifact("E");
  if (!artifact?.margin?.beta?.length) {
    return {
      ok: false,
      challengerId: "E",
      modelId: CFB_MODEL_E_ID,
      label: "Optimized Combined Advanced",
      reason: "FITTED_COMBINED_ARTIFACT_UNAVAILABLE",
      ...RESEARCH,
    };
  }
  const primary = projectCfbFbisV2Production(game, { fitted: artifact });
  return {
    ...primary,
    ok: Boolean(primary?.ok),
    challengerId: "E",
    modelId: CFB_MODEL_E_ID,
    label: "Optimized Combined Advanced (fitted research)",
    fittedArtifactId: artifact.id,
    oosDecision: artifact.oosValidation?.decision || null,
    improvesOverChampion: artifact.oosValidation?.improvesOverChampion === true,
    ...RESEARCH,
    home: round1(primary?.home),
    away: round1(primary?.away),
    margin: round1((primary?.home ?? 0) - (primary?.away ?? 0)),
    total: round1((primary?.home ?? 0) + (primary?.away ?? 0)),
    projectionEnabled: false,
    canPublishForecasts: false,
  };
}

export function projectAllChallengers(game = {}, opts = {}) {
  return {
    A: projectModelA(game),
    B: projectModelB(game, opts),
    C: projectModelC(game, opts),
    D: projectModelD(game, opts),
    E: projectModelE(game, opts),
    coreShadowId: CFB_CORE_SHADOW_ID,
  };
}
