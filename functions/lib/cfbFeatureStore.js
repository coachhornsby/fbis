/**
 * Temporal pregame feature store helpers for CFB-FBIS-v2.
 * Absolute rule: no data generated after kickoff may enter a game's pregame vector.
 */

import { featureCutoffIso, cutoffViolated, hashPayload } from "./collegeIdentity.js";
import { insertGameFeatureSnapshot, insertCfbPregameFeatureVector } from "./collegeStore.js";

export const FEATURE_STORE_VERSION = "cfb-pregame-features-v2";
export const SOURCE_VERSION = "cfbd-feature-pipeline-v2";

export function assertPregameTemporalIntegrity({
  kickoffTimestamp,
  featureAsOfTimestamp,
  featureCutoffTimestamp,
  collectionTimestamp,
} = {}) {
  const errors = [];
  const kick = Date.parse(kickoffTimestamp || "");
  const asOf = Date.parse(featureAsOfTimestamp || "");
  const cutoff = Date.parse(featureCutoffTimestamp || "");
  const collected = Date.parse(collectionTimestamp || "");

  if (!Number.isFinite(kick)) errors.push("kickoff-missing");
  if (!Number.isFinite(asOf)) errors.push("feature-as-of-missing");
  if (!Number.isFinite(cutoff)) errors.push("feature-cutoff-missing");
  if (!Number.isFinite(collected)) errors.push("collection-timestamp-missing");

  if (Number.isFinite(asOf) && Number.isFinite(kick) && asOf > kick) {
    errors.push("feature-as-of-after-kickoff");
  }
  if (Number.isFinite(cutoff) && Number.isFinite(kick) && cutoff > kick) {
    errors.push("feature-cutoff-after-kickoff");
  }
  if (Number.isFinite(collected) && Number.isFinite(kick) && collected > kick) {
    errors.push("collection-after-kickoff");
  }
  if (Number.isFinite(asOf) && Number.isFinite(cutoff) && asOf > cutoff) {
    errors.push("feature-as-of-after-cutoff");
  }
  if (cutoffViolated(featureCutoffTimestamp, kickoffTimestamp)) {
    errors.push("cutoff-violated");
  }
  return { ok: errors.length === 0, errors };
}

/** Reject any game-level observation whose start is on/after the target kickoff. */
export function filterGamesBeforeKickoff(games = [], kickoffTimestamp) {
  const kick = Date.parse(kickoffTimestamp || "");
  if (!Number.isFinite(kick)) return [];
  return (games || []).filter((g) => {
    const start = Date.parse(g.startDate || g.start_date || g.start || g.kickoff || "");
    return Number.isFinite(start) && start < kick;
  });
}

/** Reject season aggregates that are not week-bounded when reconstructing history. */
export function markLeakageRisk(featureMeta = {}, { weekBounded = false, reconstructedFromGames = false } = {}) {
  if (reconstructedFromGames || weekBounded) {
    return { ...featureMeta, leakageRisk: "none", pregameSafe: true, excludedFromTemporal: false };
  }
  if (featureMeta.grain === "season" && featureMeta.leakageRisk === "high") {
    return { ...featureMeta, excludedFromTemporal: true, reason: "full-season-aggregate-without-as-of" };
  }
  return { ...featureMeta, excludedFromTemporal: false };
}

/**
 * Shrinkage weight for in-season evidence: n/(n+k). Default k=6 matches production benchmark.
 */
export function shrinkageWeight(gamesPlayed, k = 6) {
  const n = Math.max(0, Number(gamesPlayed) || 0);
  const kk = Math.max(0.1, Number(k) || 6);
  return n / (n + kk);
}

export function blendPriorCurrent(prior, current, gamesPlayed, k = 6) {
  const w = shrinkageWeight(gamesPlayed, k);
  if (!Number.isFinite(Number(current))) return { value: Number(prior), weight: 0, k };
  if (!Number.isFinite(Number(prior))) return { value: Number(current), weight: 1, k };
  return { value: (1 - w) * Number(prior) + w * Number(current), weight: w, k };
}

export function buildPregameFeatureRecord({
  gameId,
  season,
  week,
  kickoffTimestamp,
  homeTeam,
  awayTeam,
  features = {},
  sourceEndpoint = null,
  sourceVersion = SOURCE_VERSION,
  minutesBefore = 1,
  collectionTimestamp = null,
  featureAsOfTimestamp = null,
} = {}) {
  const collected = collectionTimestamp || new Date().toISOString();
  const cutoff = featureCutoffIso(kickoffTimestamp, { minutesBefore }) || kickoffTimestamp;
  const asOf = featureAsOfTimestamp || collected;
  const integrity = assertPregameTemporalIntegrity({
    kickoffTimestamp,
    featureAsOfTimestamp: asOf,
    featureCutoffTimestamp: cutoff,
    collectionTimestamp: collected,
  });
  return {
    game_id: String(gameId),
    season: season ?? null,
    week: week ?? null,
    kickoff_timestamp: kickoffTimestamp,
    home_team: homeTeam,
    away_team: awayTeam,
    feature_as_of_timestamp: asOf,
    feature_cutoff_timestamp: cutoff,
    source_version: sourceVersion,
    source_endpoint: sourceEndpoint,
    collection_timestamp: collected,
    features,
    temporalOk: integrity.ok,
    temporalErrors: integrity.errors,
    feature_schema_version: FEATURE_STORE_VERSION,
  };
}

export async function persistPregameFeatureVector(env, record, { sport = "cfb", jobRunId = null, modelVersion = "CFB-FBIS-v2" } = {}) {
  if (!record?.temporalOk) {
    return { ok: false, reason: "temporal-integrity-failed", errors: record?.temporalErrors || [] };
  }
  const hash = await hashPayload({
    gameId: record.game_id,
    cutoff: record.feature_cutoff_timestamp,
    features: record.features,
    sourceVersion: record.source_version,
  });
  const id = `${sport}:${record.game_id}:${FEATURE_STORE_VERSION}:${hash.slice(0, 12)}`;
  const featuresPayload = {
    ...record.features,
    feature_as_of_timestamp: record.feature_as_of_timestamp,
    collection_timestamp: record.collection_timestamp,
    week: record.week,
    season: record.season,
  };
  const res = await insertGameFeatureSnapshot(env, {
    id,
    sport,
    gameId: record.game_id,
    homeTeamId: record.home_team,
    awayTeamId: record.away_team,
    scheduledStart: record.kickoff_timestamp,
    featureCutoff: record.feature_cutoff_timestamp,
    sourceObs: { endpoints: record.source_endpoint ? [record.source_endpoint] : [] },
    sourceVersions: { pipeline: record.source_version, schema: FEATURE_STORE_VERSION },
    featureSchemaVersion: FEATURE_STORE_VERSION,
    modelVersion,
    neutral: Boolean(record.features?.neutralSite),
    missingness: record.features?.missingness || {},
    dataQuality: record.features?.dataCompleteness ?? null,
    contentHash: hash,
    jobRunId,
    features: featuresPayload,
  });
  const dedicated = await insertCfbPregameFeatureVector(env, {
    id: `cfbvec:${hash.slice(0, 16)}`,
    gameId: record.game_id,
    season: record.season,
    week: record.week,
    kickoffTimestamp: record.kickoff_timestamp,
    homeTeam: record.home_team,
    awayTeam: record.away_team,
    featureAsOfTimestamp: record.feature_as_of_timestamp,
    featureCutoffTimestamp: record.feature_cutoff_timestamp,
    sourceVersion: record.source_version,
    sourceEndpoint: record.source_endpoint,
    collectionTimestamp: record.collection_timestamp,
    features: featuresPayload,
    decomposition: record.decomposition || null,
    uncertainty: record.uncertainty || null,
    modelId: modelVersion,
    contentHash: hash,
    jobRunId,
  });
  return { ...res, id, contentHash: hash, dedicated };
}

/**
 * Rolling opponent-adjusted efficiency from game rows before kickoff.
 * Simple mean of team offense PPA and opponent-facing defense PPA allowed.
 */
export function rollingTeamStrengthFromGames(gameRows = [], teamName, { kickoffTimestamp = null } = {}) {
  const priorGames = kickoffTimestamp
    ? filterGamesBeforeKickoff(gameRows, kickoffTimestamp)
    : gameRows;
  const team = String(teamName || "").toLowerCase();
  const off = [];
  const def = [];
  const passOff = [];
  const rushOff = [];
  const passDef = [];
  const rushDef = [];
  for (const g of priorGames) {
    const name = String(g.team || g.school || "").toLowerCase();
    if (name !== team) continue;
    const o = Number(g.offense?.overall ?? g.offense?.ppa ?? g.offensePpa);
    const d = Number(g.defense?.overall ?? g.defense?.ppa ?? g.defensePpa);
    if (Number.isFinite(o)) off.push(o);
    if (Number.isFinite(d)) def.push(d);
    const po = Number(g.offense?.passing);
    const ro = Number(g.offense?.rushing);
    const pd = Number(g.defense?.passing);
    const rd = Number(g.defense?.rushing);
    if (Number.isFinite(po)) passOff.push(po);
    if (Number.isFinite(ro)) rushOff.push(ro);
    if (Number.isFinite(pd)) passDef.push(pd);
    if (Number.isFinite(rd)) rushDef.push(rd);
  }
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    gamesPlayed: Math.max(off.length, def.length),
    offensePpa: avg(off),
    defensePpa: avg(def),
    passOffensePpa: avg(passOff),
    rushOffensePpa: avg(rushOff),
    passDefensePpa: avg(passDef),
    rushDefensePpa: avg(rushDef),
    reconstructedFromGames: true,
    leakageRisk: "none",
  };
}
