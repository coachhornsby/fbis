/**
 * Tuesday (and general slate) CFB production readiness gate.
 * Ready | Provisional | Blocked — never quietly show blocked as validated.
 */

import { resolveGamesPlayedWithSource, GAMES_PLAYED_SOURCES } from "./cfbGamesPlayed.js";
import { auditTeamFeatureUsage } from "./cfbFeatureUsageAudit.js";
import { buildCfbProjectionReliability } from "./cfbProjectionReliability.js";
import { buildScoringProvenance } from "./cfbSourceModelMatrix.js";
import { projectCfbFbisV2Production } from "./cfbFbisV2.js";
import { instrumentProjectionContribution } from "./cfbFeatureContract.js";

export const READINESS_VERSION = "cfb-tuesday-readiness-v1";

export const READINESS = Object.freeze({
  READY: "Ready",
  PROVISIONAL: "Provisional",
  BLOCKED: "Blocked",
});

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sideFromFeatures(features = {}, prior = {}) {
  const gp = resolveGamesPlayedWithSource(features);
  return {
    priorOff: num(prior.priorOff ?? features.priorOff ?? features.off),
    priorDef: num(prior.priorDef ?? features.priorDef ?? features.def),
    offensePpa: num(features.ppaOff ?? features.offensePpa),
    defensePpa: num(features.ppaDef ?? features.defensePpa),
    gamesPlayed: gp.gamesPlayed ?? 0,
    gamesPlayedSource: gp.source,
    gamesPlayedUncertainty: gp.uncertainty === true,
    coreThroughWeek: num(features.coreThroughWeek),
    coreWeekBounded: features.coreWeekBounded === true,
    coreOffense: num(features.coreOffense),
    coreDefense: num(features.coreDefense),
    offensiveSuccessRate: num(features.offensiveSuccessRate),
    team: features.team || features.school || null,
    espnId: features.espnId || null,
    snapshotAsOf: features.snapshotAsOf || features.as_of || null,
  };
}

/**
 * Evaluate one upcoming matchup for production readiness.
 */
export function evaluateGameReadiness({
  game = {},
  homeFeatures = {},
  awayFeatures = {},
  homePrior = {},
  awayPrior = {},
  boardProjection = null,
  frozenVector = null,
  now = new Date(),
} = {}) {
  const checks = [];
  const home = sideFromFeatures(homeFeatures, homePrior);
  const away = sideFromFeatures(awayFeatures, awayPrior);
  const kickoff = game.start || game.kickoff || game.kickoff_timestamp || null;
  const kickMs = Date.parse(kickoff || "");

  // 1 identity
  const homeId = game.homeEspnId || home.espnId || homeFeatures.canonicalId || null;
  const awayId = game.awayEspnId || away.espnId || awayFeatures.canonicalId || null;
  const identityOk = Boolean(
    (game.home_name || game.home || home.team) &&
      (game.away_name || game.away || away.team) &&
      homeId &&
      awayId &&
      String(homeId) !== String(awayId)
  );
  checks.push({
    id: 1,
    name: "canonical_identity",
    ok: identityOk,
    critical: true,
    detail: identityOk ? `${awayId} @ ${homeId}` : "Missing or colliding team ids",
  });

  // 2 games played
  const gpOk =
    home.gamesPlayed > 0 &&
    away.gamesPlayed > 0 &&
    home.gamesPlayedSource !== GAMES_PLAYED_SOURCES.MISSING &&
    away.gamesPlayedSource !== GAMES_PLAYED_SOURCES.MISSING;
  const gpVerified =
    home.gamesPlayedSource === GAMES_PLAYED_SOURCES.SCHEDULE ||
    home.gamesPlayedSource === GAMES_PLAYED_SOURCES.EXPLICIT;
  checks.push({
    id: 2,
    name: "games_played",
    ok: gpOk,
    critical: true,
    detail: {
      home: { n: home.gamesPlayed, source: home.gamesPlayedSource },
      away: { n: away.gamesPlayed, source: away.gamesPlayedSource },
      verifiedSchedulePreferred: gpVerified,
    },
  });

  // 3 current-season offense/defense
  const currentOk =
    home.offensePpa != null &&
    home.defensePpa != null &&
    away.offensePpa != null &&
    away.defensePpa != null;
  checks.push({
    id: 3,
    name: "current_season_offense_defense",
    ok: currentOk,
    critical: true,
    detail: {
      home: { ppaOff: home.offensePpa, ppaDef: home.defensePpa },
      away: { ppaOff: away.offensePpa, ppaDef: away.defensePpa },
    },
  });

  // 4 through-week
  const throughWeek = home.coreThroughWeek ?? away.coreThroughWeek;
  checks.push({
    id: 4,
    name: "through_week",
    ok: throughWeek != null || gpOk,
    critical: false,
    detail: { throughWeek, note: "coreThroughWeek ≠ gamesPlayed" },
  });

  // 5 temporal cutoff
  const homeAsOf = Date.parse(home.snapshotAsOf || "");
  const awayAsOf = Date.parse(away.snapshotAsOf || "");
  const temporalOk =
    !Number.isFinite(kickMs) ||
    ((!Number.isFinite(homeAsOf) || homeAsOf <= kickMs) &&
      (!Number.isFinite(awayAsOf) || awayAsOf <= kickMs));
  checks.push({
    id: 5,
    name: "pregame_cutoff",
    ok: temporalOk,
    critical: true,
    detail: { kickoff, homeAsOf: home.snapshotAsOf, awayAsOf: away.snapshotAsOf },
  });

  // 6–7 normalization / model input reach
  const homeAudit = auditTeamFeatureUsage({
    ppaOff: home.offensePpa,
    ppaDef: home.defensePpa,
    gamesPlayed: home.gamesPlayed,
    gamesPlayedSource: home.gamesPlayedSource,
    offensiveSuccessRate: home.offensiveSuccessRate,
    coreOffense: home.coreOffense,
    coreDefense: home.coreDefense,
  });
  const awayAudit = auditTeamFeatureUsage({
    ppaOff: away.offensePpa,
    ppaDef: away.defensePpa,
    gamesPlayed: away.gamesPlayed,
    gamesPlayedSource: away.gamesPlayedSource,
    coreOffense: away.coreOffense,
    coreDefense: away.coreDefense,
  });
  const modelReachOk = homeAudit.missingCriticalForChampion.length === 0
    && awayAudit.missingCriticalForChampion.length === 0;
  checks.push({
    id: 7,
    name: "features_reach_model",
    ok: modelReachOk,
    critical: true,
    detail: {
      homeMissing: homeAudit.missingCriticalForChampion,
      awayMissing: awayAudit.missingCriticalForChampion,
      presentUnused: [
        ...homeAudit.presentButUnusedByChampion,
        ...awayAudit.presentButUnusedByChampion,
      ],
    },
  });

  // Project
  const envelope = {
    home: game.home_name || game.home || home.team,
    away: game.away_name || game.away || away.team,
    homeEspnId: homeId,
    awayEspnId: awayId,
    season: game.season || 2026,
    week: game.week || null,
    kickoff,
    neutralSite: Boolean(game.neutralSite || game.neutral),
    cfbFbisV2Input: { home, away },
  };
  let projection = null;
  let projectOk = false;
  try {
    projection = projectCfbFbisV2Production(envelope);
    projectOk = Boolean(projection?.ok);
  } catch (err) {
    projection = { ok: false, reason: String(err?.message || err) };
  }
  checks.push({
    id: 11,
    name: "reproducible_projection",
    ok: projectOk,
    critical: true,
    detail: projectOk
      ? { home: projection.home, away: projection.away, margin: projection.margin }
      : { reason: projection?.reason || "projection_failed" },
  });

  // 8 coefficients / usage reporting
  const contribution = instrumentProjectionContribution(projection || {}, envelope);
  const reliability = buildCfbProjectionReliability(envelope, projection);
  const provenance = buildScoringProvenance({
    homeFeatures: {
      ppaOff: home.offensePpa,
      ppaDef: home.defensePpa,
      gamesPlayed: home.gamesPlayed,
      gamesPlayedSource: home.gamesPlayedSource,
      priorOff: home.priorOff,
      priorDef: home.priorDef,
      coreOffense: home.coreOffense,
    },
    awayFeatures: {
      ppaOff: away.offensePpa,
      ppaDef: away.defensePpa,
      gamesPlayed: away.gamesPlayed,
      gamesPlayedSource: away.gamesPlayedSource,
      priorOff: away.priorOff,
      priorDef: away.priorDef,
      coreOffense: away.coreOffense,
    },
    homeTeamId: homeId,
    awayTeamId: awayId,
    season: envelope.season,
    throughWeek,
  });
  checks.push({
    id: 8,
    name: "feature_usage_reported",
    ok: Boolean(contribution?.actuallyConsumed?.length),
    critical: false,
    detail: {
      fittedNonzero: contribution.actuallyConsumed?.map((c) => c.feature),
      zeroInfluence: contribution.doNotRepresentAsInfluencing,
    },
  });

  // 9 venue / HFA
  checks.push({
    id: 9,
    name: "venue_hfa",
    ok: true,
    critical: false,
    detail: {
      neutral: Boolean(game.neutralSite || game.neutral),
      hfa: projection?.provenance?.hfa ?? null,
    },
  });

  // 10 kickoff present
  checks.push({
    id: 10,
    name: "kickoff_time",
    ok: Number.isFinite(kickMs),
    critical: true,
    detail: { kickoff },
  });

  // 12 market labeled (not required for projection ready)
  checks.push({
    id: 12,
    name: "market_labels",
    ok: true,
    critical: false,
    detail: "Market lines evaluation-only; never enter independent score",
  });

  // 13 no unsupported wager qualification
  const wagerSafe = projection?.canAuthorizeWager !== true && projection?.canQualify !== true;
  checks.push({
    id: 13,
    name: "no_wager_authority",
    ok: wagerSafe,
    critical: true,
    detail: { canQualify: projection?.canQualify, canAuthorizeWager: projection?.canAuthorizeWager },
  });

  // 14 board agreement
  let boardOk = true;
  let boardDetail = "no board projection supplied";
  if (boardProjection && projectOk) {
    const bh = num(boardProjection.home ?? boardProjection.proj_home ?? boardProjection.projHome);
    const ba = num(boardProjection.away ?? boardProjection.proj_away ?? boardProjection.projAway);
    boardOk =
      bh != null &&
      ba != null &&
      Math.abs(bh - projection.home) < 0.15 &&
      Math.abs(ba - projection.away) < 0.15;
    boardDetail = { boardHome: bh, boardAway: ba, modelHome: projection.home, modelAway: projection.away };
  }
  checks.push({
    id: 14,
    name: "board_agrees_model",
    ok: boardOk,
    critical: Boolean(boardProjection),
    detail: boardDetail,
  });

  // 15 research separated
  checks.push({
    id: 15,
    name: "research_separated",
    ok: true,
    critical: false,
    detail: "CORE/challengers remain research_only",
  });

  // frozen vector
  checks.push({
    id: 16,
    name: "frozen_vector",
    ok: frozenVector != null ? true : false,
    critical: false,
    detail: frozenVector ? "present" : "not yet frozen — required before kickoff",
  });

  const criticalFails = checks.filter((c) => c.critical && !c.ok);
  const softFails = checks.filter((c) => !c.critical && !c.ok);
  let status = READINESS.READY;
  if (criticalFails.length) status = READINESS.BLOCKED;
  else if (softFails.length || reliability.provisional || home.gamesPlayedUncertainty || away.gamesPlayedUncertainty) {
    status = READINESS.PROVISIONAL;
  }

  return {
    version: READINESS_VERSION,
    gameId: game.id || game.game_id || null,
    matchup: `${envelope.away} @ ${envelope.home}`,
    kickoff,
    status,
    checks,
    criticalFailures: criticalFails.map((c) => c.name),
    warnings: softFails.map((c) => c.name),
    projection: projectOk
      ? {
          home: projection.home,
          away: projection.away,
          margin: projection.margin,
          total: projection.total,
          modelId: projection.modelId,
          provisional: projection.provisional === true,
        }
      : null,
    reliability,
    contribution,
    provenanceOk: provenance.ok,
    provenanceDiagnostics: provenance.diagnostics,
    evaluatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
}

/**
 * Summarize a slate of readiness results.
 */
export function summarizeReadinessSlate(results = []) {
  const by = { Ready: 0, Provisional: 0, Blocked: 0 };
  for (const r of results) {
    by[r.status] = (by[r.status] || 0) + 1;
  }
  const blocked = results.filter((r) => r.status === READINESS.BLOCKED);
  return {
    version: READINESS_VERSION,
    total: results.length,
    counts: by,
    readyForLaunch: blocked.length === 0 && results.length > 0,
    blockedGames: blocked.map((r) => ({ gameId: r.gameId, matchup: r.matchup, criticalFailures: r.criticalFailures })),
    disposition:
      results.length === 0
        ? "Not ready — no scheduled games discovered"
        : blocked.length
          ? "Not ready"
          : by.Provisional
            ? "Ready with documented limitations"
            : "Ready",
  };
}
