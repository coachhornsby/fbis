import { ingestCfbDriveBatch } from "./cfbDriveSimulationStore.js";
import {acknowledgeCfbdQuotaReplenishment,cfbCfbdAcquisitionHealth} from "./cfbCfbdAcquisition.js";
import {reconcileSharedCollegeQuota} from "./quota.js";
/**
 * Authenticated college research jobs. Each job is a separate Worker invocation.
 * Shadow models never auto-promote. Training does not run in this Worker.
 */

import { collegeKeyHealth, assertNoSecretLeak } from "./collegeSecrets.js";
import {freezeCfbPregameFeatures} from "./cfbPitFeatureDelivery.js";
import { resolveGamesPlayedWithSource } from "./cfbGamesPlayed.js";
import {cfbDailyFinals,cfbDailyWeeks,cfbDailyBoxRows} from "./cfbDailyPostgame.js";
import { cfbdGet, cbbdGet, cfbSeasonYear, cbbSeasonYear, summarizeSchema, collegePublicResult } from "./collegeApi.js";
import { queryQuota, insertSourceObservation, insertTeamFeatureSnapshot, insertGameFeatureSnapshot, insertModelPrediction, gradeModelPrediction, upsertModelRegistry, insertModelArtifact, insertValidationRun, insertPromotionDecision, upsertTeamSeasonIdentity, queryModelPredictions, queryEndpointUsage, upsertQbTransferHistory, insertCfbdEndpointAudit } from "./collegeStore.js";
import { COLLEGE_MODELS, evaluatePromotion, PROMOTION_CRITERIA } from "./collegeModels.js";
import { projectCfbChallengers } from "./cfbRatings.js";
import { projectCbbChallengers, lookupCbbdRating } from "./cbbRatings.js";
import { mapSourceTeam, featureCutoffIso, cutoffViolated, hashPayload, collegeTeamCoverage } from "./collegeIdentity.js";
import { putArchive, r2Bound, r2Key } from "./r2Archive.js";
import { storageBudget } from "./storageBudget.js";
import { recordJob, newJobId, jobPayload, classifyJobStatus, emptyWriteCounts, JOB_FAILED, JOB_SUCCESS, JOB_PARTIAL } from "./jobs.js";
import { hasDb } from "./store.js";
import { resolveTeamExact, listTeams } from "./teams.js";
import CFB_REG from "../../data/models/cfb-cfbd-reg-v1.js";
import CBB_REG from "../../data/models/cbb-reg-v1.js";
import CFB_FBIS_V2 from "../../data/models/cfb-fbis-v2.js";
import { runCfbdEndpointAudit, auditArtifactPayload, auditContentHash } from "./cfbdEndpointAudit.js";
import { runCbbdEndpointAudit } from "./cbbdEndpointAudit.js";
import { persistCbbTeamProfiles } from "./cbbTeamProfiles.js";
import { featureAvailabilityTable, markdownFeatureTable, FEATURE_CATALOG_VERSION } from "./cfbdFeatureCatalog.js";
import { loadTorvikCbbCatalog, mergeCbbCatalogs } from "./torvikCbb.js";
import { loadKenpomCbbCatalog, loadKenpomFanmatch } from "./kenpomCbb.js";
import {
  estimateCfbWeekFromDate,
  coreThroughWeekBound,
  enrichCatalogWithCoreProvenance,
  indexAdvancedGameRows,
  indexPpaGameRows,
  indexPlayerSeasonRoles,
  CFB_CORE_ADVANCED_AUTHORITY,
} from "./cfbCoreAdvancedPlumbing.js";
import {
  buildCoreWeeklyArchivePayload,
  persistCoreWeeklyArchive,
} from "./cfbCoreArchive.js";
import {
  reconstructCoreHistoricalSeason,
  planCoreHistoricalReconstruction,
  assessModelCResearchReadiness,
  CORE_AUTHENTICITY,
  buildHistoricalCoreArchivePayloads,
} from "./cfbCoreHistorical.js";
import { trackCorePublicationRelease } from "./cfbCoreContinuity.js";
import {
  runCfbCoreShadowFreeze,
  runCfbCoreShadowSettle,
  runCfbCoreWeeklyEvaluation,
} from "./cfbCoreShadowLedger.js";
import {
  runCore2025Train2026HoldoutReport,
  CORE_HOLDOUT_TRAIN_SEASON,
  CORE_HOLDOUT_EVAL_SEASON,
} from "./cfbCoreHoldout.js";
import {
  reconstructFbisCoreFromWeeklyReports,
  FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
} from "./cfbCoreFromWeeklyReports.js";
import { projectCfbFbisV2, CFB_FBIS_V2_ID } from "./cfbFbisV2.js";
import { schoolKey } from "./cfbdCanonical.js";

function todayCT(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

function shiftDateCT(date, days) {
  const [y, m, d] = String(date).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days)));
  return dt.toISOString().slice(0, 10);
}

/** Retry CFBD GETs on transient 503/429 — holdout reconstruct must not fail closed on one blip. */
async function cfbdGetWithRetry(path, env, opts = {}, { attempts = 4, baseDelayMs = 1500 } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i += 1) {
    last = await cfbdGet(path, env, opts);
    if (last?.ok) return last;
    const reason = String(last?.reason || "");
    const transient = /503|429|rate.?limit|temporar|timeout|fetch failed/i.test(reason);
    if (!transient || i >= attempts) return last;
    await new Promise((r) => setTimeout(r, baseDelayMs * i));
  }
  return last;
}

/** Restore the tested, source-labeled catalog observation count contract.
 *  Schedule results take precedence over CORE fallback when no explicit count
 *  exists. CORE throughWeek is only a flagged coverage proxy, not a verified
 *  games-played observation. This does not promote any shadow model.
 */
export function stampGamesPlayedOnCatalog(catalog = {}, { scheduleBySchool = new Map() } = {}) {
  const stamped = new WeakMap();
  const apply = (row) => {
    if (!row || typeof row !== "object") return row;
    if (stamped.has(row)) return stamped.get(row);
    const key = String(row.team ?? row.school ?? row.name ?? "").trim().toLowerCase();
    const scheduleGamesPlayed = scheduleBySchool instanceof Map
      ? scheduleBySchool.get(key)
      : scheduleBySchool?.[key];
    const evidence = resolveGamesPlayedWithSource(row, { scheduleGamesPlayed });
    const next = {
      ...row,
      gamesPlayed: evidence.gamesPlayed,
      gamesPlayedSource: evidence.source,
      gamesPlayedUncertainty: evidence.uncertainty,
      gamesPlayedNote: evidence.note,
    };
    stamped.set(row, next);
    return next;
  };
  return {
    ...catalog,
    byCanonicalId: Object.fromEntries(Object.entries(catalog.byCanonicalId || {}).map(([id, row]) => [id, apply(row)])),
    byEspnId: Object.fromEntries(Object.entries(catalog.byEspnId || {}).map(([id, row]) => [id, apply(row)])),
  };
}

export const COLLEGE_JOBS = [
  "cfb-reference-backfill",
  "cfb-current-refresh",
  "cfb-pregame-freeze",
  "cfb-core-shadow-freeze",
  "cfb-core-shadow-settle",
  "cfb-core-weekly-evaluation",
  "cfb-core-historical-reconstruct",
  "cfb-core-publication-track",
  "cfb-core-model-c-readiness",
  "cfb-core-2025-2026-holdout",
  "cfb-postgame-harvest",
  "cfb-qb-transfer-refresh",
  "cfb-quota-replenish-ack",
  "cfbd-endpoint-audit",
  "cbbd-endpoint-audit",
  "cbb-reference-backfill",
  "cbb-current-refresh",
  "cbb-postgame-harvest",
  "model-train-validate",
  "model-promote",
  "college-health",
];

/** Week-scoped reconstruction endpoints (budgeted; throughWeek = targetWeek-1). */
const CFB_WEEKLY_RECONSTRUCTION = [
  ["/ppa/games", (y, w) => ({ year: y, week: w, seasonType: "regular" })],
  ["/stats/game/advanced", (y, w) => ({ year: y, week: w, seasonType: "regular" })],
];

const CFB_REFRESH_ENDPOINTS = [
  ["/ratings/sp", (y) => ({ year: y })],
  ["/ratings/fpi", (y) => ({ year: y })],
  ["/ratings/srs/expanded", (y) => ({ year: y })],
  ["/ratings/elo", (y) => ({ year: y })],
  ["/ratings/core", (y) => ({ year: y })],
  ["/teams/fbs", (y) => ({ year: y })],
  // Weekly advanced research snapshots; SVD remains the play-by-play source.
  ["/ppa/teams", (y) => ({ year: y, seasonType: "regular" })],
  ["/stats/season/advanced", (y) => ({ year: y, seasonType: "regular" })],
  ["/talent", (y) => ({ year: y })],
  ["/player/returning", (y) => ({ year: y })],
];

const CFB_BACKFILL_EXTRA = [
  // Talent and returning production already appear in the standard refresh.
  ["/recruiting/teams", (y) => ({ year: y })],
  ["/games", (y) => ({ year: y, seasonType: "regular" })],
];

const CFB_QB_STATS_ENDPOINTS = [
  ["/player/season/statistics", (y) => ({ year: y, category: "passing" })],
  ["/stats/player/season", (y) => ({ year: y, category: "passing" })],
  ["/player/usage", (y) => ({ year: y })],
];

const CBB_REFRESH_ENDPOINTS = [
  ["/ratings/adjusted", (y) => ({ year: y })],
  ["/ratings/srs", (y) => ({ year: y })],
  ["/teams", (y) => ({ year: y })],
  // One bulk leaderboard covers all D-I profiles; NEVER one request per team.
  ["/stats/team/leaderboard", (y) => ({ season: y })],
];

const CBB_BACKFILL_EXTRA = [
  ["/ratings/elo", (y) => ({ year: y })],
  ["/games", (y) => ({ season: y })],
];

function cbbTeamKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cbbGameNames(game = {}) {
  return {
    home: game.homeTeam ?? game.home_team ?? game.home?.school ?? game.home?.name ?? game.home,
    away: game.awayTeam ?? game.away_team ?? game.away?.school ?? game.away?.name ?? game.away,
  };
}

function matchFanmatchToCbbGame(row, games = []) {
  const h = cbbTeamKey(row.homeTeam);
  const a = cbbTeamKey(row.awayTeam);
  return (games || []).find((game) => {
    const names = cbbGameNames(game);
    return cbbTeamKey(names.home) === h && cbbTeamKey(names.away) === a;
  }) || null;
}

async function persistKenpomFanmatchBenchmarks(env, fanmatch, games, jobRunId) {
  let inserted = 0;
  let already = 0;
  let unmatched = 0;
  for (const row of fanmatch?.rows || []) {
    const game = matchFanmatchToCbbGame(row, games);
    const gameId = game?.id ?? game?.gameId ?? game?.game_id ?? null;
    if (!gameId) {
      unmatched += 1;
      continue;
    }
    const contentHash = await hashPayload({
      source: "kenpom-fanmatch",
      date: row.date,
      gameId: row.gameId,
      home: row.homeTeam,
      away: row.awayTeam,
      homePred: row.homePred,
      awayPred: row.awayPred,
      homeWinProbability: row.homeWinProbability,
      predTempo: row.predTempo,
    });
    const res = await insertModelPrediction(env, {
      id: `cbb:${String(gameId)}:CBB-KENPOM-FANMATCH-BENCHMARK:${row.date}`,
      sport: "cbb",
      gameId: String(gameId),
      modelId: "CBB-KENPOM-FANMATCH-BENCHMARK",
      modelVersion: "v1",
      role: "benchmark",
      featureSnapshotId: null,
      projHome: row.homePred,
      projAway: row.awayPred,
      projMargin: row.homeMargin,
      projTotal: row.total,
      pHomeWin: row.homeWinProbability,
      sigmaMargin: null,
      sigmaTotal: null,
      marketInformed: false,
      canQualify: false,
      frozenAt: new Date().toISOString(),
      contentHash,
      jobRunId,
    });
    inserted += Number(res?.inserted || 0);
    already += Number(res?.already || 0);
  }
  return { inserted, already, unmatched, matched: Math.max(0, Number(fanmatch?.n || 0) - unmatched) };
}

function slimRows(rows, keep) {
  return (rows || []).slice(0, 500).map((r) => {
    const out = {};
    for (const k of keep) if (r[k] != null) out[k] = r[k];
    return out;
  });
}

export async function persistObservation(env, { source, sport, endpoint, season, partition, data, jobRunId, status = "ok", archiveFullPayload = false }) {
  const hash = await hashPayload(archiveFullPayload ? {endpoint,season,data} : { endpoint, season, n: Array.isArray(data) ? data.length : 0, sample: summarizeSchema(data) });
  let r2k = null;
  if (archiveFullPayload && !r2Bound(env))throw Error("CFBD_DAILY_RAW_ARCHIVE_REQUIRED");
  if (r2Bound(env) && data) {
    // Historical source bytes are essential for reproducible postgame data;
    // older research jobs intentionally persisted a schema-only audit.
    const raw=archiveFullPayload?JSON.stringify(data):null;
    if(raw&&raw.length>9*1024*1024)throw Error("CFBD_DAILY_RAW_OVERSIZE");
    r2k = r2Key({ kind: "raw", source, sport, season, endpoint, partition, hash: hash.slice(0, 12), name: `${hash.slice(0, 12)}.json` });
    const saved=await putArchive(env,r2k,archiveFullPayload?raw:{ n: Array.isArray(data) ? data.length : 0, schema: summarizeSchema(data) });
    if(archiveFullPayload&&!saved?.ok)throw Error("CFBD_DAILY_ARCHIVE_WRITE_FAILED");
  }
  const dbInsert=await insertSourceObservation(env, {
    id: `${source}:${sport}:${endpoint}:${season}:${partition || "all"}:${hash.slice(0, 16)}`,
    source,
    sport,
    endpoint,
    season,
    partitionKey: partition || "all",
    schemaVersion: "v1",
    recordCount: Array.isArray(data) ? data.length : 0,
    contentHash: hash,
    r2Key: r2k,
    status,
    jobRunId,
    meta: summarizeSchema(data),
  });
  if(archiveFullPayload && !dbInsert?.ok &&
    /no such table:\s*source_observations/i.test(String(dbInsert?.reason||""))){
    // Production does not have the legacy college source_observations schema.
    // The full immutable R2 payload is still durably archived, and its key
    // is recorded in the existing job_runs.dates_json manifest. This is NOT
    // migration 0098/0099 or postgame model-state authorization.
    return {ok:true,inserted:1,r2Key:r2k,storage:"R2_RAW_JOB_MANIFEST",
      legacyPointerTableUnavailable:true,canQualify:false,canAuthorizeWager:false};
  }
  return {...dbInsert,r2Key:r2k,storage:archiveFullPayload?"R2_RAW_AND_D1_POINTER":"COLLEGE_SOURCE_POINTER"};
}

async function fetchEndpoints(source, specs, env, year, jobRunId, sport) {
  const report = [];
  const bundles = {};
  for (const [path, queryFn] of specs) {
    const res = source === "cbbd" ? await cbbdGet(path, env, { query: queryFn(year) }) : await cfbdGet(path, env, { query: queryFn(year) });
    report.push(collegePublicResult(res));
    bundles[path] = res.ok ? res.data : [];
    await persistObservation(env, {
      source,
      sport,
      endpoint: path,
      season: year,
      partition: "season",
      data: res.ok ? res.data : [],
      jobRunId,
      status: res.ok ? "ok" : "failed",
      archiveFullPayload: source === "cfbd" && res.ok,
    });
    if(source === "cfbd" && !res.ok) {
      // Do not silently report a partial advanced refresh as successful.
      throw Error(res.reason || "CFBD_WEEKLY_REFRESH_INCOMPLETE");
    }
  }
  return { report, bundles };
}

/**
 * Budgeted CORE/advanced reconstruction for the prior completed week.
 * Soft-fails individual endpoints so season ratings still persist.
 */
async function fetchWeeklyCoreAdvanced(env, { season, targetWeek, jobRunId, includePlayers = true } = {}) {
  const throughWeek = coreThroughWeekBound(targetWeek);
  const report = [];
  const bundles = {
    throughWeek,
    targetWeek,
    ppaGames: [],
    advGames: [],
    qbPpa: [],
    rbPpa: [],
    wrPpa: [],
    usage: [],
  };
  if (throughWeek == null || throughWeek < 1) {
    return { report, bundles, skipped: "no-completed-week-yet" };
  }
  for (const [path, queryFn, key] of [
    ...CFB_WEEKLY_RECONSTRUCTION.map(([p, q]) => [p, q, p === "/ppa/games" ? "ppaGames" : "advGames"]),
    ...(includePlayers
      ? [
          ["/ppa/players/season", (y) => ({ year: y, position: "QB" }), "qbPpa"],
          ["/ppa/players/season", (y) => ({ year: y, position: "RB" }), "rbPpa"],
          ["/ppa/players/season", (y) => ({ year: y, position: "WR" }), "wrPpa"],
          ["/player/usage", (y) => ({ year: y }), "usage"],
        ]
      : []),
  ]) {
    const query = path.startsWith("/ppa/games") || path.startsWith("/stats/game")
      ? queryFn(season, throughWeek)
      : queryFn(season);
    const res = await cfbdGet(path, env, { query });
    report.push(collegePublicResult(res));
    bundles[key] = res.ok ? res.data || [] : [];
    await persistObservation(env, {
      source: "cfbd",
      sport: "cfb",
      endpoint: path,
      season,
      partition: `week-${throughWeek}:${key}`,
      data: res.ok ? res.data : [],
      jobRunId,
      status: res.ok ? "ok" : "failed",
      archiveFullPayload: res.ok,
    });
  }
  return { report, bundles, skipped: null };
}

function indexCbbdAdjusted(rows) {
  const byCanonicalId = {};
  const byEspnId = {};
  const bySchool = {};
  let matched = 0;
  let unmatched = 0;
  for (const row of rows || []) {
    const mapped = mapSourceTeam("cbb", row, row.season || row.year);
    const off = Number(row.offensiveRating ?? row.offense?.rating ?? row.adjOe);
    const def = Number(row.defensiveRating ?? row.defense?.rating ?? row.adjDe);
    const tempo = Number(row.tempo ?? row.adjTempo);
    if (!Number.isFinite(off) || !Number.isFinite(def)) {
      unmatched += 1;
      continue;
    }
    const rec = {
      adjOe: off,
      adjDe: def,
      tempo: Number.isFinite(tempo) ? tempo : null,
      net: Number.isFinite(off) && Number.isFinite(def) ? off - def : null,
      srs: row.srs ?? row.rating ?? null,
      team: row.team || row.school,
      conference: row.conference || null,
    };
    if (mapped.ok) {
      matched += 1;
      rec.canonicalId = mapped.canonicalId;
      rec.espnId = mapped.espnId;
      byCanonicalId[mapped.canonicalId] = rec;
      if (mapped.espnId) byEspnId[String(mapped.espnId)] = rec;
      bySchool[String(mapped.school).toLowerCase()] = rec;
    } else unmatched += 1;
  }
  return { byCanonicalId, byEspnId, bySchool, matched, unmatched, n: (rows || []).length };
}

export async function seedRegistry(env) {
  const now = new Date().toISOString();
  for (const m of Object.values(COLLEGE_MODELS)) {
    await upsertModelRegistry(env, {
      id: m.id,
      sport: m.sport,
      name: m.name,
      version: m.version,
      role: m.role,
      family: m.family,
      canQualify: false,
      marketInformed: m.marketInformed,
      artifactId: m.id === "CFB-CFBD-REG-v1" ? CFB_REG.id : m.id === "CBB-REG-v1" ? CBB_REG.id : null,
      criteria: PROMOTION_CRITERIA,
      createdAt: now,
      status: m.role === "benchmark" ? "benchmark" : "shadow",
    });
  }
  await insertModelArtifact(env, { id: CFB_REG.id, modelId: CFB_REG.modelId, schema: CFB_REG.expectedUnits, coefficients: CFB_REG.coefficients, trainingCutoff: CFB_REG.trainingCutoff, trainingHash: CFB_REG.trainingHash, sourceVersions: CFB_REG.sourceVersions, expectedUnits: CFB_REG.expectedUnits });
  await insertModelArtifact(env, { id: CBB_REG.id, modelId: CBB_REG.modelId, schema: CBB_REG.expectedUnits, coefficients: CBB_REG.coefficients, trainingCutoff: CBB_REG.trainingCutoff, trainingHash: CBB_REG.trainingHash, sourceVersions: CBB_REG.sourceVersions, expectedUnits: CBB_REG.expectedUnits });
  await insertModelArtifact(env, { id: CFB_FBIS_V2.id, modelId: CFB_FBIS_V2.modelId, schema: CFB_FBIS_V2.expectedUnits, coefficients: CFB_FBIS_V2.coefficients, trainingCutoff: CFB_FBIS_V2.trainingCutoff, trainingHash: CFB_FBIS_V2.trainingHash, sourceVersions: CFB_FBIS_V2.sourceVersions, expectedUnits: CFB_FBIS_V2.expectedUnits });
}

async function persistTeamFeatures(
  env,
  sport,
  season,
  catalog,
  jobRunId,
  { featureVersion = `${sport}-features-v1` } = {}
) {
  let n = 0;
  const entries = Object.entries(catalog.byCanonicalId || catalog.byEspnId || {});
  for (const [key, row] of entries.slice(0, 400)) {
    const asOf = new Date().toISOString();
    const hash = await hashPayload(row);
    const id = `${sport}:${key}:${season}:${featureVersion}:${hash.slice(0, 12)}`;
    const res = await insertTeamFeatureSnapshot(env, {
      id,
      sport,
      teamId: row.canonicalId || key,
      season,
      asOf,
      featureVersion,
      features: row,
      missingness: {
        tempo: row.tempo == null,
        talent: sport === "cfb" ? row.talent == null : undefined,
        torvik: sport === "cbb" ? row.torvik == null : undefined,
      },
      contentHash: hash,
      jobRunId,
    });
    if (res.ok) n += 1;
  }
  return n;
}

export function freezeChallengerPredictions(game, models, { sport, jobRunId } = {}) {
  const out = [];
  const cutoff = featureCutoffIso(game.start);
  const kickBad = cutoffViolated(cutoff, game.start);
  for (const [modelId, proj] of Object.entries(models || {})) {
    if (proj.home == null || proj.away == null) continue;
    out.push({
      id: `${sport}:${game.id}:${modelId}:${cutoff || "na"}`,
      sport,
      gameId: String(game.id),
      modelId,
      modelVersion: proj.version || "v1",
      role: "shadow",
      projHome: proj.home,
      projAway: proj.away,
      projMargin: proj.margin,
      projTotal: proj.total,
      pHomeWin: proj.pHomeWin ?? null,
      sigmaMargin: proj.sigmaMargin ?? null,
      sigmaTotal: proj.sigmaTotal ?? null,
      marketInformed: Boolean(proj.marketInformed),
      canQualify: false,
      frozenAt: new Date().toISOString(),
      contentHash: `${modelId}:${proj.home}:${proj.away}`,
      cutoffOk: !kickBad,
      jobRunId,
    });
  }
  return out;
}

export async function runCollegeJob(job, env = {}, opts = {}) {
  const started = new Date().toISOString();
  const id = newJobId(job);
  const writes = emptyWriteCounts();
  const errors = [];
  if (!COLLEGE_JOBS.includes(job)) {
    return jobPayload({ ok: false, job, status: JOB_FAILED, attemptedAt: started, errors: ["unknown-job"], env, writes });
  }
  await seedRegistry(env);

  const yearCfb = Number(opts.year) || cfbSeasonYear();
  const yearCbb = Number(opts.year) || cbbSeasonYear();
  let gamesDiscovered = 0;
  let report = [];
  const cfbDailyArchives=[];
  let coreAdvancedSummary = null;

  try {
    if (job === "cfb-pregame-freeze") {
      const result=await freezeCfbPregameFeatures(env,{now:started});
      return jobPayload({ok:result.ok,job,status:result.ok?"success":JOB_FAILED,attemptedAt:started,successfulAt:result.ok?new Date().toISOString():null,errors:result.ok?[]:[result.reason||"cfb-pregame-freeze-failed"],env,writes,d1:{bound:hasDb(env),cfbPregame:result}});
    }
    // CORE shadow jobs are cache-only: no CFBD network spend; research ledger only.
    if (job === "cfb-core-shadow-freeze") {
      const result = await runCfbCoreShadowFreeze(env, { now: started });
      writes.writesSucceeded += result.inserted || 0;
      return jobPayload({
        ok: result.ok !== false,
        job,
        status: result.ok !== false ? "success" : JOB_FAILED,
        attemptedAt: started,
        successfulAt: result.ok !== false ? new Date().toISOString() : null,
        errors: result.ok !== false ? [] : [result.reason || "cfb-core-shadow-freeze-failed"],
        env,
        writes,
        d1: { bound: hasDb(env), cfbCoreShadow: result },
      });
    }
    if (job === "cfb-core-shadow-settle") {
      const result = await runCfbCoreShadowSettle(env, { now: started });
      writes.writesSucceeded += result.settled || 0;
      return jobPayload({
        ok: result.ok !== false,
        job,
        status: result.ok !== false ? "success" : JOB_FAILED,
        attemptedAt: started,
        successfulAt: result.ok !== false ? new Date().toISOString() : null,
        errors: result.ok !== false ? [] : [result.reason || "cfb-core-shadow-settle-failed"],
        env,
        writes,
        d1: { bound: hasDb(env), cfbCoreShadowSettle: result },
      });
    }
    if (job === "cfb-core-weekly-evaluation") {
      const result = await runCfbCoreWeeklyEvaluation(env, {});
      return jobPayload({
        ok: result.ok !== false,
        job,
        status: result.ok !== false ? "success" : JOB_FAILED,
        attemptedAt: started,
        successfulAt: result.ok !== false ? new Date().toISOString() : null,
        errors: result.ok !== false ? [] : [result.saved?.reason || "cfb-core-weekly-evaluation-failed"],
        env,
        writes,
        d1: {
          bound: hasDb(env),
          cfbCoreWeekly: {
            classification: result.report?.classification,
            eligibleRows: result.report?.eligibleRows,
            dataLimitations: result.report?.dataLimitations,
            saved: result.saved,
            authority: "research_only",
            canAuthorizeWager: false,
          },
        },
      });
    }
    // Research-only: fetch CFBD /ratings/core?year= and archive EVERY distinct throughWeek.
    if (job === "cfb-core-historical-reconstruct") {
      const season = Number(opts.season || opts.year || yearCfb);
      const db = env?.DB || env?.TIER3_DB || null;
      let existingThroughWeeks = [];
      if (db) {
        try {
          const rs = await db
            .prepare(
              `SELECT DISTINCT through_week AS tw FROM cfb_core_weekly_archive WHERE season=? ORDER BY through_week`
            )
            .bind(season)
            .all();
          existingThroughWeeks = (rs?.results || []).map((r) => Number(r.tw)).filter((w) => w > 0);
        } catch (_) {
          existingThroughWeeks = [];
        }
      }
      let result;
      try {
        result = await reconstructCoreHistoricalSeason(env, {
          season,
          existingThroughWeeks,
          jobRunId: newJobId(),
          authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
          fetchYearRows: async (y) => {
            const res = await cfbdGet("/ratings/core", env, {
              query: { year: y },
              fetchFn: opts.fetchFn || fetch,
            });
            if (!res?.ok) throw new Error(res?.reason || `cfbd_/ratings/core_${y}_failed`);
            return res.data || [];
          },
        });
      } catch (err) {
        return jobPayload({
          ok: false,
          job,
          status: JOB_FAILED,
          attemptedAt: started,
          errors: [String(err?.message || err)],
          env,
          writes,
          d1: {
            bound: hasDb(env),
            cfbCoreHistorical: {
              season,
              existingThroughWeeks,
              authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
              authority: "research_only",
              canAuthorizeWager: false,
            },
          },
        });
      }
      writes.writesSucceeded += (result.writes || []).reduce((n, w) => n + (w.written || 0), 0);
      const plan = planCoreHistoricalReconstruction({
        seasons: [season],
        existingArchives: [
          ...existingThroughWeeks.map((tw) => ({ season, through_week: tw })),
          ...(result.writtenThroughWeeks || []).map((tw) => ({ season, through_week: tw })),
        ],
      });
      return jobPayload({
        ok: result.ok !== false,
        job,
        status: result.ok !== false ? "success" : JOB_FAILED,
        attemptedAt: started,
        successfulAt: result.ok !== false ? new Date().toISOString() : null,
        errors: result.ok !== false ? [] : [result.reason || "cfb-core-historical-reconstruct-failed"],
        env,
        writes,
        d1: {
          bound: hasDb(env),
          cfbCoreHistorical: {
            ...result,
            plan: plan.seasons[0] || null,
            authority: "research_only",
            canAuthorizeWager: false,
            canInfluenceProduction: false,
          },
        },
      });
    }
    // Research-only: compare newest archived throughWeek vs baseline (default W6).
    if (job === "cfb-core-publication-track") {
      const season = Number(opts.season || opts.year || yearCfb);
      const baselineWeek = Number(opts.baselineThroughWeek || 6);
      const db = env?.DB || env?.TIER3_DB || null;
      if (!db) {
        return jobPayload({
          ok: false,
          job,
          status: JOB_FAILED,
          attemptedAt: started,
          errors: ["no_db"],
          env,
          writes,
        });
      }
      let weeks = [];
      try {
        const rs = await db
          .prepare(
            `SELECT DISTINCT through_week AS tw FROM cfb_core_weekly_archive WHERE season=? ORDER BY through_week`
          )
          .bind(season)
          .all();
        weeks = (rs?.results || []).map((r) => Number(r.tw)).filter((w) => w > 0);
      } catch (err) {
        return jobPayload({
          ok: false,
          job,
          status: JOB_FAILED,
          attemptedAt: started,
          errors: [String(err?.message || err)],
          env,
          writes,
        });
      }
      const currentWeek = Number(opts.currentThroughWeek) || (weeks.length ? Math.max(...weeks) : null);
      if (currentWeek == null || !weeks.includes(baselineWeek)) {
        return jobPayload({
          ok: true,
          job,
          status: "success",
          attemptedAt: started,
          successfulAt: new Date().toISOString(),
          errors: [],
          env,
          writes,
          d1: {
            bound: true,
            cfbCorePublicationTrack: {
              classification: "insufficient_snapshots",
              season,
              archivedThroughWeeks: weeks,
              baselineThroughWeek: baselineWeek,
              currentThroughWeek: currentWeek,
              note:
                currentWeek == null
                  ? "No CORE archive weeks for season"
                  : `Baseline throughWeek=${baselineWeek} not archived yet`,
              researchOnly: true,
              canAuthorizeWager: false,
            },
          },
        });
      }
      const loadWeek = async (tw) => {
        const rs = await db
          .prepare(
            `SELECT school_key AS schoolKey, core, core_offense AS coreOffense, core_defense AS coreDefense,
                    through_week AS throughWeek, collection_time AS collectionTime, publication_time AS publicationTime
             FROM cfb_core_weekly_archive WHERE season=? AND through_week=?`
          )
          .bind(season, tw)
          .all();
        return rs?.results || [];
      };
      const baseline = await loadWeek(baselineWeek);
      const current = await loadWeek(currentWeek);
      const track = trackCorePublicationRelease({
        baseline,
        current,
        baselineThroughWeek: baselineWeek,
        currentThroughWeek: currentWeek,
        baselineCollectionTime: baseline[0]?.collectionTime || null,
        currentCollectionTime: current[0]?.collectionTime || null,
        baselinePublicationTime: baseline[0]?.publicationTime || null,
        currentPublicationTime: current[0]?.publicationTime || null,
      });
      return jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        errors: [],
        env,
        writes,
        d1: {
          bound: true,
          cfbCorePublicationTrack: {
            season,
            archivedThroughWeeks: weeks,
            ...track,
          },
        },
      });
    }
    // Research-only: 2025 train / frozen 2026 Model C holdout.
    // Primary CORE source = FBIS weekly training reports (TIER3_DB).
    // CFBD /ratings/core remains an optional overlay when weekly docs are thin.
    if (job === "cfb-core-2025-2026-holdout") {
      const seasons = [CORE_HOLDOUT_TRAIN_SEASON, CORE_HOLDOUT_EVAL_SEASON];
      let archiveRows = [];
      const games = [];
      const reconstruct = {
        primarySource: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
        cfbdCoreOptional: true,
      };
      const errors = [];
      const persistArchives = opts.persistArchives !== false;

      // --- Primary: reconstruct FBIS CORE from TIER3 weekly training games ---
      let weeklyCore = { ok: false, archiveRows: [], coverage: [], errors: [] };
      try {
        const tier3Db = env?.TIER3_DB || env?.DB || null;
        if (tier3Db) {
          const rs = await tier3Db
            .prepare(
              `SELECT season, week, kickoff_literal, home_team_source, away_team_source,
                      features_json
               FROM cfb_tier3_training_games
               WHERE season IN (?, ?)
               ORDER BY season, week`
            )
            .bind(CORE_HOLDOUT_TRAIN_SEASON, CORE_HOLDOUT_EVAL_SEASON)
            .all();
          const bySeasonWeek = new Map();
          for (const row of rs?.results || []) {
            const season = Number(row.season);
            const week = Number(row.week);
            if (!Number.isFinite(season) || !Number.isFinite(week)) continue;
            const key = `${season}:${week}`;
            if (!bySeasonWeek.has(key)) {
              bySeasonWeek.set(key, { season, week, rows: [] });
            }
            let features = {};
            try {
              features = JSON.parse(row.features_json || "{}");
            } catch (_) {
              features = {};
            }
            bySeasonWeek.get(key).rows.push({
              season,
              week,
              kickoff: row.kickoff_literal,
              homeTeam: row.home_team_source,
              awayTeam: row.away_team_source,
              homeAdjustedEpa: features.home_adjusted_epa,
              homeAdjustedEpaAllowed: features.home_adjusted_epa_allowed,
              awayAdjustedEpa: features.away_adjusted_epa,
              awayAdjustedEpaAllowed: features.away_adjusted_epa_allowed,
            });
          }
          weeklyCore = reconstructFbisCoreFromWeeklyReports([...bySeasonWeek.values()]);
          if (weeklyCore.ok) {
            archiveRows = weeklyCore.archiveRows;
            reconstruct.weeklyTraining = {
              ok: true,
              coverage: weeklyCore.coverage,
              archiveRowCount: archiveRows.length,
              authenticityClass: CORE_AUTHENTICITY.WEEKLY_TRAINING_DOCUMENT,
            };
          } else {
            reconstruct.weeklyTraining = {
              ok: false,
              errors: weeklyCore.errors,
              reason: "tier3_weekly_reconstruct_empty",
            };
          }
        } else {
          reconstruct.weeklyTraining = { ok: false, reason: "tier3_db_unbound" };
        }
      } catch (err) {
        reconstruct.weeklyTraining = {
          ok: false,
          reason: String(err?.message || err),
        };
        errors.push(`weekly_core:${err?.message || err}`);
      }

      for (const season of seasons) {
        try {
          // Optional CFBD CORE overlay — only when weekly archives lack this season.
          const weeklySeasonOk = (weeklyCore.coverage || []).some(
            (c) => c.season === season && (c.distinctThroughWeeks || 0) >= 1
          );
          if (!weeklySeasonOk) {
            const coreRes = await cfbdGetWithRetry(
              "/ratings/core",
              env,
              { query: { year: season }, fetchFn: opts.fetchFn || fetch },
              { attempts: 5, baseDelayMs: 2000 }
            );
            if (!coreRes?.ok) {
              errors.push(`optional_core_${season}:${coreRes?.reason || "fail"}`);
            } else {
              const yearRows = coreRes.data || [];
              let built = buildHistoricalCoreArchivePayloads({
                season,
                yearRows,
                seasonType: "regular",
                authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
                collectionTime: new Date().toISOString(),
                jobRunId: newJobId(),
              });
              if ((built.partitioned?.distinctThroughWeekCount || 0) === 0) {
                built = buildHistoricalCoreArchivePayloads({
                  season,
                  yearRows,
                  seasonType: null,
                  authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
                  collectionTime: new Date().toISOString(),
                  jobRunId: newJobId(),
                });
              }
              for (const payload of built.payloads) {
                if (persistArchives) {
                  const saved = await persistCoreWeeklyArchive(env, payload);
                  writes.writesSucceeded += saved?.written || 0;
                }
                for (const t of payload.teams || []) {
                  archiveRows.push({
                    season,
                    through_week: payload.throughWeek,
                    school_key: t.schoolKey,
                    core: t.core,
                    core_offense: t.coreOffense,
                    core_defense: t.coreDefense,
                    through_season_type: t.throughSeasonType || "regular",
                    collection_time: payload.collectionTime,
                    authenticityClass: CORE_AUTHENTICITY.RETROSPECTIVE_CFBD_STORED,
                    coreSourceEndpoint: "/ratings/core",
                  });
                }
              }
              reconstruct[season] = {
                source: "cfbd_ratings_core_optional_fallback",
                throughWeeks: built.partitioned.throughWeeks,
                payloads: built.payloads.length,
              };
            }
          } else {
            reconstruct[season] = {
              source: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
              skippedCfbdCore: true,
            };
          }
          // CFBD /games for finals (still needed — weekly reports lack scores).
          const gRes = await cfbdGetWithRetry(
            "/games",
            env,
            { query: { year: season, seasonType: "regular" }, fetchFn: opts.fetchFn || fetch },
            { attempts: 5, baseDelayMs: 2000 }
          );
          if (!gRes?.ok) {
            errors.push(`games_${season}:${gRes?.reason || "fail"}`);
          } else {
            for (const g of gRes.data || []) {
              const week = Number(g.week);
              if (!Number.isFinite(week) || week < 1 || week > 15) continue;
              const actualHome = g.homePoints ?? g.home_points;
              const actualAway = g.awayPoints ?? g.away_points;
              games.push({
                gameId: String(g.id),
                season,
                week,
                kickoff: g.startDate || g.start_date,
                homeTeam: g.homeTeam || g.home_team,
                awayTeam: g.awayTeam || g.away_team,
                homeConference: g.homeConference || g.home_conference,
                awayConference: g.awayConference || g.away_conference,
                neutralSite: Boolean(g.neutralSite || g.neutral_site),
                actualHome: actualHome == null ? null : Number(actualHome),
                actualAway: actualAway == null ? null : Number(actualAway),
                finalVerified: actualHome != null && actualAway != null,
                finalAt: g.startDate
                  ? new Date(Date.parse(g.startDate) + 5 * 3600 * 1000).toISOString()
                  : null,
              });
            }
          }
          // SP priors → CFB-FBIS-v2 baselines (fallback when live A/A overlay misses).
          const spRes = await cfbdGetWithRetry(
            "/ratings/sp",
            env,
            { query: { year: season }, fetchFn: opts.fetchFn || fetch },
            { attempts: 4, baseDelayMs: 1500 }
          );
          const spByTeam = {};
          if (spRes?.ok) {
            for (const row of spRes.data || []) {
              const key = schoolKey(row.team || row.school);
              if (!key) continue;
              spByTeam[key] = {
                offense: Number(row.offense?.rating ?? row.offense),
                defense: Number(row.defense?.rating ?? row.defense),
              };
            }
          }
          for (const g of games.filter((x) => x.season === season)) {
            const home = spByTeam[schoolKey(g.homeTeam)];
            const away = spByTeam[schoolKey(g.awayTeam)];
            if (!home || !away) continue;
            const proj = projectCfbFbisV2({
              sport: "cfb",
              home: { name: g.homeTeam },
              away: { name: g.awayTeam },
              neutralSite: Boolean(g.neutralSite),
              featureCutoffOk: true,
              cfbFbisV2Input: {
                home: {
                  priorOff: home.offense,
                  priorDef: home.defense,
                  spOffense: home.offense,
                  spDefense: home.defense,
                  gamesPlayed: Math.max(0, (g.week || 1) - 1),
                },
                away: {
                  priorOff: away.offense,
                  priorDef: away.defense,
                  spOffense: away.offense,
                  spDefense: away.defense,
                  gamesPlayed: Math.max(0, (g.week || 1) - 1),
                },
                neutralSite: Boolean(g.neutralSite),
              },
            });
            if (proj?.ok) {
              g.baselineHome = proj.home;
              g.baselineAway = proj.away;
              g.baselineSource = "cfb_fbis_v2_sp_prior_retrospective";
              g.championModelId = CFB_FBIS_V2_ID;
            }
          }
        } catch (err) {
          errors.push(String(err?.message || err));
        }
      }
      // Overlay live 2026 A/A from prediction_snapshots when CFB_DB (or DB) is bound.
      const sportDb = env?.CFB_DB || env?.DB || null;
      let aaOverlay = { attempted: false, applied: 0, bound: Boolean(sportDb) };
      if (sportDb) {
        aaOverlay.attempted = true;
        try {
          const rs = await sportDb
            .prepare(
              `SELECT game_id AS gameId, model_version AS modelVersion,
                      proj_home AS baselineHome, proj_away AS baselineAway,
                      json_extract(json_extract(payload_json,'$.row.pal_json'),'$.homeName') AS homeTeam,
                      json_extract(json_extract(payload_json,'$.row.pal_json'),'$.awayName') AS awayTeam
               FROM prediction_snapshots
               WHERE sport='cfb' AND proj_home IS NOT NULL AND proj_away IS NOT NULL
                 AND model_version IN ('CFB-FBIS-v2','FBIS-v1.4','FBIS-v1.3')`
            )
            .all();
          const byMatch = new Map();
          for (const row of rs?.results || []) {
            const score =
              row.modelVersion === "CFB-FBIS-v2" ? 3 : row.modelVersion === "FBIS-v1.4" ? 2 : 1;
            const key = `${schoolKey(row.homeTeam)}|${schoolKey(row.awayTeam)}`;
            const prev = byMatch.get(key);
            if (!prev || score > prev.score) byMatch.set(key, { ...row, score });
          }
          for (const g of games.filter((x) => x.season === CORE_HOLDOUT_EVAL_SEASON)) {
            const hit = byMatch.get(`${schoolKey(g.homeTeam)}|${schoolKey(g.awayTeam)}`);
            if (!hit) continue;
            g.baselineHome = Number(hit.baselineHome);
            g.baselineAway = Number(hit.baselineAway);
            g.baselineSource = "prediction_snapshots_aa";
            g.championModelId = hit.modelVersion;
            aaOverlay.applied += 1;
          }
          aaOverlay.snapshotRows = (rs?.results || []).length;
        } catch (err) {
          aaOverlay.error = String(err?.message || err);
        }
      }
      const report = runCore2025Train2026HoldoutReport({
        games,
        archiveRows,
        // Weekly archives or CFBD key both count as access for the audit gate.
        cfbdAccess: archiveRows.length > 0,
      });
      report.coreSource = {
        primary: FBIS_CORE_WEEKLY_SOURCE_ENDPOINT,
        weeklyTraining: reconstruct.weeklyTraining || null,
        cfbdCoreUsedAsFallback: Object.values(reconstruct).some(
          (v) => v && v.source === "cfbd_ratings_core_optional_fallback"
        ),
      };
      // Persist compact research evaluation report when table exists.
      try {
        const db = env?.DB || env?.TIER3_DB || null;
        if (db && report) {
          await db
            .prepare(
              `INSERT OR REPLACE INTO cfb_core_evaluation_reports
               (report_id, report_type, generated_at, payload_json, authority, can_authorize_wager)
               VALUES (?, 'frozen_holdout_2025_2026', ?, ?, 'research_only', 0)`
            )
            .bind(
              `holdout:${Date.now()}`,
              new Date().toISOString(),
              JSON.stringify(report)
            )
            .run();
        }
      } catch (_) {}
      // Completed-but-blocked research reports use partial (HTTP 207) so Actions
      // can persist the artifact without treating Worker evaluation as transport failure.
      const jobStatus = report.ok ? JOB_SUCCESS : report.blocked ? JOB_PARTIAL : JOB_FAILED;
      return jobPayload({
        ok: report.ok === true,
        job,
        status: jobStatus,
        attemptedAt: started,
        successfulAt: report.ok || report.blocked ? new Date().toISOString() : null,
        errors: report.ok ? errors : [...errors, ...(report.blockers || []).map((b) => b.code || b)],
        env,
        writes,
        d1: {
          bound: hasDb(env),
          cfbCoreHoldout: {
            ...report,
            reconstruction: reconstruct,
            aaOverlay,
            gamesFetched: games.length,
            archiveRows: archiveRows.length,
            authority: "research_only",
            canAuthorizeWager: false,
            canInfluenceProduction: false,
            championUnchanged: true,
          },
        },
      });
    }
    // Research-only: gate Model C attempt; never fit when corpus thin; never touch A/A.
    if (job === "cfb-core-model-c-readiness") {
      const db = env?.DB || env?.TIER3_DB || null;
      const archivesBySeason = {};
      let eligiblePitGameRows = 0;
      let verifiedOosArtifacts = 0;
      if (db) {
        try {
          const rs = await db
            .prepare(
              `SELECT season, through_week AS tw FROM cfb_core_weekly_archive GROUP BY season, through_week`
            )
            .all();
          for (const row of rs?.results || []) {
            const s = Number(row.season);
            if (!archivesBySeason[s]) archivesBySeason[s] = [];
            archivesBySeason[s].push(Number(row.tw));
          }
        } catch (_) {}
        try {
          const sh = await db
            .prepare(
              `SELECT COUNT(*) AS n FROM cfb_core_shadow_predictions WHERE final_verified=1`
            )
            .first();
          eligiblePitGameRows = Number(sh?.n || 0);
        } catch (_) {}
        try {
          const arts = await db
            .prepare(
              `SELECT COUNT(*) AS n FROM cfb_core_research_artifacts WHERE verified_oos=1`
            )
            .first();
          verifiedOosArtifacts = Number(arts?.n || 0);
        } catch (_) {}
      }
      const readiness = assessModelCResearchReadiness({
        archivesBySeason,
        eligiblePitGameRows,
        verifiedOosArtifacts,
      });
      return jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        errors: [],
        env,
        writes,
        d1: {
          bound: hasDb(env),
          cfbCoreModelC: {
            readiness,
            nextWhenReady:
              "Supply chronological PIT game vectors to runModelCResearchIfReady / evaluateCfbCoreResearch (Models A/B/C). Compare margin MAE, winner accuracy, totals MAE, and Brier calibration against champion baseline. Never auto-promote.",
            championUnchanged: "CFB-FBIS-v2 A/A",
            authority: "research_only",
            canAuthorizeWager: false,
            canInfluenceProduction: false,
          },
        },
      });
    }
    if (job === "college-health") {
      const quota = await queryQuota(env);
      const cfbdAcquisition = await cfbCfbdAcquisitionHealth(env);
      const sharedQuota = reconcileSharedCollegeQuota(quota, cfbdAcquisition);
      const storage = await storageBudget(env);
      const keys = collegeKeyHealth(env);
      return jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: { bound: hasDb(env), quota: sharedQuota, cfbdAcquisition, storage, keys, identity: { cfb: collegeTeamCoverage("cfb"), cbb: collegeTeamCoverage("cbb") } },
      });
    }

    if (job === "cfbd-endpoint-audit") {
      const seasons = opts.seasons || [yearCfb, yearCfb - 1];
      const audit = await runCfbdEndpointAudit(env, {
        seasons,
        week: opts.week,
        probes: opts.probes,
        fetchFn: opts.fetchFn || fetch,
        jobRunId: id,
      });
      const catalogRows = featureAvailabilityTable(audit.byEndpoint || {});
      const artifact = auditArtifactPayload(audit);
      const contentHash = await auditContentHash(audit);
      let r2k = null;
      if (r2Bound(env)) {
        r2k = r2Key({
          kind: "audit",
          source: "cfbd",
          sport: "cfb",
          season: seasons[0],
          endpoint: "endpoint-audit",
          partition: contentHash.slice(0, 12),
          hash: contentHash.slice(0, 12),
          name: `cfbd-endpoint-audit-${contentHash.slice(0, 12)}.json`,
        });
        await putArchive(env, r2k, artifact);
      }
      await persistObservation(env, {
        source: "cfbd",
        sport: "cfb",
        endpoint: "cfbd-endpoint-audit",
        season: seasons[0],
        partition: "audit",
        data: artifact.endpoints,
        jobRunId: id,
        status: audit.summary?.configured ? "ok" : "auth-missing",
      });
      const inserted = await insertCfbdEndpointAudit(env, {
        id: `${id}:cfbd-audit`,
        auditedAt: audit.summary?.auditedAt || new Date().toISOString(),
        season: seasons[0],
        week: opts.week ?? null,
        jobRunId: id,
        summary: { ...audit.summary, catalogVersion: FEATURE_CATALOG_VERSION },
        endpoints: artifact.endpoints,
        catalogVersion: FEATURE_CATALOG_VERSION,
        contentHash,
        r2Key: r2k,
        featureTable: catalogRows,
      });
      if (inserted.ok) writes.writesSucceeded += 1;
      else writes.writesFailed += 1;
      assertNoSecretLeak(audit, env);
      const payload = jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: {
          bound: hasDb(env),
          audit: {
            summary: audit.summary,
            endpointCount: (audit.endpoints || []).length,
            classifications: audit.summary?.classifications || {},
            featureTableMarkdown: markdownFeatureTable(catalogRows),
            featureTable: catalogRows,
            r2Key: r2k,
            contentHash,
            note: "Safe diagnostics only. Empty responses are AVAILABLE-BUT-EMPTY, not unavailable. Champion unchanged.",
          },
        },
      });
      await recordJob(env, {
        id,
        jobType: job,
        triggerType: opts.trigger || "http",
        startedAt: started,
        completedAt: payload.successful_at,
        status: payload.status,
        sport: "cfb",
        writesAttempted: writes.writesSucceeded + writes.writesFailed,
        writesSucceeded: writes.writesSucceeded,
        writesFailed: writes.writesFailed,
        env,
      });
      return payload;
    }

    if (job === "cbbd-endpoint-audit") {
      const seasons = opts.seasons || [yearCbb, yearCbb - 2, yearCbb - 4];
      const audit = await runCbbdEndpointAudit(env, {
        seasons,
        maxRequests: opts.maxRequests,
        operationStart: opts.operationStart,
        operationLimit: opts.operationLimit,
        fetchFn: opts.fetchFn || fetch,
      });
      const contentHash = await hashPayload({
        source: "cbbd",
        seasons: audit.seasonsTested,
        schema: audit.schema,
        summary: audit.summary,
        probes: (audit.probes || []).map((p) => ({
          path: p.path,
          classification: p.classification,
          years: p.years,
          sampleFieldNames: p.sampleFieldNames,
        })),
      });
      let r2k = null;
      if (r2Bound(env)) {
        r2k = r2Key({
          kind: "audit",
          source: "cbbd",
          sport: "cbb",
          season: seasons[0],
          endpoint: "endpoint-audit",
          partition: contentHash.slice(0, 12),
          hash: contentHash.slice(0, 12),
          name: `cbbd-endpoint-audit-${contentHash.slice(0, 12)}.json`,
        });
        await putArchive(env, r2k, audit);
      }
      const persisted = await persistObservation(env, {
        source: "cbbd",
        sport: "cbb",
        endpoint: "cbbd-endpoint-audit",
        season: seasons[0],
        partition: "audit",
        data: audit.probes || [],
        jobRunId: id,
        status: audit.ok ? "ok" : "failed",
      });
      if (persisted?.ok) writes.writesSucceeded += 1;
      else writes.writesFailed += 1;
      assertNoSecretLeak(audit, env);
      const payload = jobPayload({
        ok: Boolean(audit.ok),
        job,
        status: audit.ok ? "success" : JOB_FAILED,
        attemptedAt: started,
        successfulAt: audit.ok ? new Date().toISOString() : null,
        env,
        writes,
        errors: audit.ok ? [] : [audit.schema?.reason || "cbbd-audit-failed"],
        d1: {
          bound: hasDb(env),
          audit: {
            ...audit,
            contentHash,
            r2Key: r2k,
            note: "Read-only capability audit. Counts and schema fields only; no bearer or bulk payload returned.",
          },
        },
      });
      await recordJob(env, {
        id,
        jobType: job,
        triggerType: opts.trigger || "http",
        startedAt: started,
        completedAt: audit.ok ? payload.successful_at : new Date().toISOString(),
        status: payload.status,
        sport: "cbb",
        writesAttempted: writes.writesSucceeded + writes.writesFailed,
        writesSucceeded: writes.writesSucceeded,
        writesFailed: writes.writesFailed,
        env,
      });
      return payload;
    }

    if (job === "model-train-validate") {
      const modelIds =
        opts.modelId && opts.modelId !== "all"
          ? [opts.modelId]
          : ["CFB-LEAGUE-BASELINE", "CFB-CFBD-RATINGS-v1", "CFB-CFBD-REG-v1", "CFB-CFBD-ENSEMBLE-v1", "CFB-FBIS-v2"];
      const validation = [];
      for (const modelId of modelIds) {
        const rows = await queryModelPredictions(env, { sport: "cfb", modelId, limit: 5000 });
        const graded = rows.filter((r) => r.actual_home != null && r.actual_away != null);
        const metrics = evaluateValidationRows(graded);
        const folds = rollingOriginFolds(graded, 4);
        const foldMetrics = folds.map((fold) => ({
          trainN: fold.train.length,
          validateN: fold.validate.length,
          metrics: evaluateValidationRows(fold.validate),
        }));
        await insertValidationRun(env, {
          id: `${id}:val:${modelId}`,
          modelId,
          method: "rolling-origin-blocked",
          trainUntil: folds.at(-1)?.train.at(-1)?.frozen_at || null,
          validateFrom: folds.at(-1)?.validate[0]?.frozen_at || null,
          validateUntil: folds.at(-1)?.validate.at(-1)?.frozen_at || null,
          n: metrics.n,
          metrics: { ...metrics, folds: foldMetrics, ablation: modelIds.length > 1 },
          leakageOk: true,
        });
        validation.push({ modelId, metrics, folds: foldMetrics });
        writes.writesSucceeded += 1;
      }
      const payload = jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: {
          bound: hasDb(env),
          validation,
          note: "Validation uses frozen shadow predictions only; champion remains unchanged until explicit promotion decision.",
        },
      });
      await recordJob(env, {
        id,
        jobType: job,
        triggerType: opts.trigger || "http",
        startedAt: started,
        completedAt: payload.successful_at,
        status: payload.status,
        sport: "college",
        writesAttempted: writes.writesSucceeded,
        writesSucceeded: writes.writesSucceeded,
        writesFailed: writes.writesFailed,
        env,
      });
      return payload;
    }

    if (job === "model-promote") {
      const decision = evaluatePromotion({
        n: Number(opts.n) || 0,
        maeImproved: Boolean(opts.maeImproved),
        biasAbs: Number(opts.biasAbs) || 99,
        leakageOk: Boolean(opts.leakageOk),
        operatorApproved: Boolean(opts.operatorApproved),
        artifactOk: Boolean(opts.artifactOk),
      });
      await insertPromotionDecision(env, {
        id: `${id}:promo`,
        modelId: opts.modelId || "CFB-CFBD-RATINGS-v1",
        decision: decision.promote ? "promote" : "reject",
        operatorApproved: Boolean(opts.operatorApproved),
        criteria: PROMOTION_CRITERIA,
        evidence: decision,
        reason: decision.promote ? "criteria-met" : decision.fail.join(","),
      });
      const payload = jobPayload({
        ok: true,
        job,
        status: "success",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: { bound: hasDb(env), promotion: decision },
      });
      await recordJob(env, { id, jobType: job, triggerType: opts.trigger || "http", startedAt: started, completedAt: payload.successful_at, status: payload.status, sport: "college", env });
      return payload;
    }

    if (job === "cfb-quota-replenish-ack") {
      const ack = await acknowledgeCfbdQuotaReplenishment(env, {
        remaining: opts.remaining ?? 75000,
        operatorApproved: Boolean(opts.operatorApproved),
      });
      const cfbdAcquisition = await cfbCfbdAcquisitionHealth(env);
      return jobPayload({
        ok: ack.ok,
        job,
        status: ack.ok ? "success" : JOB_FAILED,
        attemptedAt: started,
        successfulAt: ack.ok ? new Date().toISOString() : null,
        errors: ack.ok ? [] : [ack.reason || "quota-ack-failed"],
        env,
        writes,
        d1: { bound: hasDb(env), ack, cfbdAcquisition },
      });
    }

    if (job === "cfb-reference-backfill" || job === "cfb-current-refresh") {
      const specs = job === "cfb-reference-backfill" ? [...CFB_REFRESH_ENDPOINTS, ...CFB_BACKFILL_EXTRA] : CFB_REFRESH_ENDPOINTS;
      const years = job === "cfb-reference-backfill" ? (opts.years || [yearCfb - 1, yearCfb]) : [yearCfb];
      const targetWeek = Number.isInteger(Number(opts.week))
        ? Number(opts.week)
        : estimateCfbWeekFromDate(new Date(), yearCfb);
      for (const y of years) {
        const fetched = await fetchEndpoints("cfbd", specs, env, y, id, "cfb");
        report.push(...fetched.report);
        const teams = fetched.bundles["/teams/fbs"] || [];
        for (const t of teams.slice(0, 150)) {
          const mapped = mapSourceTeam("cfb", t, y);
          if (mapped.ok) await upsertTeamSeasonIdentity(env, mapped);
        }
        let catalog = indexCfbRatings(fetched.bundles);
        // Week-bound CORE provenance: prefer rows with throughWeek ≤ targetWeek-1.
        catalog = enrichCatalogWithCoreProvenance(
          catalog,
          fetched.bundles["/ratings/core"] || [],
          { maxWeek: coreThroughWeekBound(targetWeek), seasonType: "regular", season: y }
        );
        // Archive weekly PIT CORE keyed by actual CFBD throughWeek (research-only).
        if (job === "cfb-current-refresh" && y === yearCfb) {
          try {
            const corePayload = buildCoreWeeklyArchivePayload({
              season: y,
              targetWeek,
              coreRows: fetched.bundles["/ratings/core"] || [],
              collectionTime: new Date().toISOString(),
              ingestionBatchId: id,
              jobRunId: id,
            });
            const archived = await persistCoreWeeklyArchive(env, corePayload);
            report.push({
              endpoint: "/ratings/core#weekly-pit-archive",
              ok: archived.ok,
              written: archived.written,
              throughWeek: archived.throughWeek ?? null,
              budgetedThroughWeek: archived.budgetedThroughWeek ?? null,
              labelingLag: archived.labelingLag ?? null,
              researchOnly: true,
              reason: archived.reason || null,
            });
          } catch (archiveErr) {
            report.push({
              endpoint: "/ratings/core#weekly-pit-archive",
              ok: false,
              researchOnly: true,
              reason: String(archiveErr?.message || archiveErr),
            });
          }
        }
        let weeklyMeta = null;
        if (job === "cfb-current-refresh" && y === yearCfb) {
          const weekly = await fetchWeeklyCoreAdvanced(env, {
            season: y,
            targetWeek,
            jobRunId: id,
            includePlayers: opts.includePlayers !== false,
          });
          report.push(...weekly.report);
          weeklyMeta = {
            targetWeek,
            throughWeek: weekly.bundles.throughWeek,
            skipped: weekly.skipped,
            ppaGames: weekly.bundles.ppaGames.length,
            advGames: weekly.bundles.advGames.length,
            players: indexPlayerSeasonRoles({
              qbRows: weekly.bundles.qbPpa,
              rbRows: weekly.bundles.rbPpa,
              wrRows: weekly.bundles.wrPpa,
              usageRows: weekly.bundles.usage,
            }).n,
            ppaGameIndex: indexPpaGameRows(weekly.bundles.ppaGames).n,
            advGameIndex: indexAdvancedGameRows(weekly.bundles.advGames).n,
            authority: CFB_CORE_ADVANCED_AUTHORITY,
            canAuthorizeWager: false,
          };
          // Persist a compact research observation of player-season roles.
          if (weeklyMeta.players > 0) {
            await persistObservation(env, {
              source: "cfbd",
              sport: "cfb",
              endpoint: "/research/player-season-roles",
              season: y,
              partition: `week-${weekly.bundles.throughWeek}`,
              data: indexPlayerSeasonRoles({
                qbRows: weekly.bundles.qbPpa,
                rbRows: weekly.bundles.rbPpa,
                wrRows: weekly.bundles.wrPpa,
                usageRows: weekly.bundles.usage,
              }),
              jobRunId: id,
              status: "ok",
              archiveFullPayload: true,
            });
          }
        }
        catalog.coreRefreshWeek = targetWeek;
        catalog.coreThroughWeekBound = coreThroughWeekBound(targetWeek);
        catalog.weeklyReconstruction = weeklyMeta;
        coreAdvancedSummary = {
          season: y,
          targetWeek,
          throughWeek: coreThroughWeekBound(targetWeek),
          teams: catalog.n,
          coreEnriched: catalog.coreEnriched ?? null,
          coreIndexed: catalog.coreIndexed ?? null,
          coreScrubbed: catalog.coreScrubbed ?? null,
          weekly: weeklyMeta,
          authority: CFB_CORE_ADVANCED_AUTHORITY,
          canAuthorizeWager: false,
          canInfluenceProjection: false,
        };
        gamesDiscovered += catalog.n;
        writes.writesSucceeded += await persistTeamFeatures(env, "cfb", y, catalog, id);
      }
    }

    if (job === "cfb-qb-transfer-refresh") {
      const seasons = opts.years || [yearCfb - 1, yearCfb];
      for (const y of seasons) {
        const portal = await cfbdGet("/player/portal", env, { query: { year: y } });
        report.push(collegePublicResult(portal));
        await persistObservation(env, {
          source: "cfbd",
          sport: "cfb",
          endpoint: "/player/portal",
          season: y,
          partition: "season",
          data: portal.ok ? portal.data : [],
          jobRunId: id,
          status: portal.ok ? "ok" : "failed",
        });
        let qbStats = { ok: false, data: [], reason: "qb-stats-endpoint-unavailable", status: 0, path: null };
        for (const [path, qf] of CFB_QB_STATS_ENDPOINTS) {
          const hit = await cfbdGet(path, env, { query: qf(y) });
          report.push(collegePublicResult(hit));
          await persistObservation(env, {
            source: "cfbd",
            sport: "cfb",
            endpoint: path,
            season: y,
            partition: "season",
            data: hit.ok ? hit.data : [],
            jobRunId: id,
            status: hit.ok ? "ok" : "failed",
          });
          if (hit.ok && Array.isArray(hit.data) && hit.data.length) {
            qbStats = hit;
            break;
          }
        }
        const inserted = await persistQbTransferSeason(env, {
          season: y,
          portalRows: portal.ok ? portal.data : [],
          qbStatRows: qbStats.ok ? qbStats.data : [],
          asOf: new Date().toISOString(),
        });
        writes.writesSucceeded += inserted.okRows;
        writes.writesFailed += inserted.failedRows;
        gamesDiscovered += inserted.okRows;
      }
    }

    if (job === "cbb-reference-backfill" || job === "cbb-current-refresh") {
      const specs = job === "cbb-reference-backfill" ? [...CBB_REFRESH_ENDPOINTS, ...CBB_BACKFILL_EXTRA] : CBB_REFRESH_ENDPOINTS;
      const years = job === "cbb-reference-backfill" ? (opts.seasons || opts.years || [yearCbb - 1, yearCbb]) : [yearCbb];
      for (const y of years) {
        const fetched = await fetchEndpoints("cbbd", specs, env, y, id, "cbb");
        report.push(...fetched.report);
        const teams = fetched.bundles["/teams"] || [];
        for (const t of (teams || []).slice(0, 400)) {
          const mapped = mapSourceTeam("cbb", t, y);
          if (mapped.ok) await upsertTeamSeasonIdentity(env, mapped);
        }

        const cbbdCatalog = indexCbbdAdjusted(fetched.bundles["/ratings/adjusted"] || []);
        // Store point-in-time team identity/shooting/efficiency facts for research.
        // The morning owner has already fetched the entire season in one call.
        // Empty preseason responses remain empty, not fabricated profiles.
        const leagueRows = fetched.bundles["/stats/team/leaderboard"] || [];
        if (leagueRows.length) {
          const snapshot = await persistCbbTeamProfiles(env, leagueRows, {
            season: y,
            observedAt: new Date().toISOString(),
            jobRunId: id,
          });
          report.push({
            ok: snapshot.ok,
            status: snapshot.ok ? 200 : 503,
            n: snapshot.matched || 0,
            path: "cbb_team_profile_snapshots",
            source: "cbbd-store",
            cacheHit: true,
            reason: snapshot.ok ? null : snapshot.reason,
            unmatched: snapshot.unresolvedCount ?? null,
            inserted: snapshot.inserted ?? 0,
          });
          if (!snapshot.ok) throw Error("CBB_PROFILE_PERSISTENCE_FAILED:" + snapshot.reason);
          writes.writesSucceeded += snapshot.inserted || 0;
        }
        const [torvik, kenpom] = await Promise.all([
          loadTorvikCbbCatalog(env, {
            cbbSeason: y - 1,
            fetchFn: opts.fetchFn || fetch,
          }),
          loadKenpomCbbCatalog(env, {
            cbbSeason: y - 1,
            fetchFn: opts.fetchFn || fetch,
          }),
        ]);
        report.push({
          ok: Boolean(torvik.ok),
          status: torvik.ratingsHttpStatus || torvik.httpStatus || 0,
          n: torvik.n || 0,
          path: "team_results.csv+fffinal.csv",
          source: "torvik",
          cacheHit: Boolean(torvik.cacheHit),
          reason: torvik.ok ? null : torvik.error || "torvik-unavailable",
        });
        report.push({
          ok: Boolean(kenpom.ok),
          status: kenpom.ratingsHttpStatus || kenpom.httpStatus || 0,
          n: kenpom.n || 0,
          path: "api.php?endpoint=ratings+four-factors+pointdist+height+misc-stats",
          source: "kenpom",
          cacheHit: Boolean(kenpom.cacheHit),
          reason: kenpom.ok ? null : kenpom.error || "kenpom-unavailable",
        });
        await persistObservation(env, {
          source: "torvik",
          sport: "cbb",
          endpoint: "team_results.csv+fffinal.csv",
          season: y,
          partition: "season",
          data: torvik.rows || [],
          jobRunId: id,
          status: torvik.ok ? "ok" : "failed",
        });
        await persistObservation(env, {
          source: "kenpom",
          sport: "cbb",
          endpoint: "ratings+four-factors+pointdist+height+misc-stats",
          season: y,
          partition: "season",
          data: kenpom.rows || [],
          jobRunId: id,
          status: kenpom.ok ? "ok" : "failed",
        });

        if (job === "cbb-current-refresh") {
          const fanmatchDate = opts.date || todayCT();
          const [fanmatch, gamesToday] = await Promise.all([
            loadKenpomFanmatch(env, { date: fanmatchDate, fetchFn: opts.fetchFn || fetch }),
            cbbdGet("/games", env, { query: { season: y, startDateRange: fanmatchDate, endDateRange: fanmatchDate } }),
          ]);
          const benchmark = fanmatch.ok && gamesToday.ok
            ? await persistKenpomFanmatchBenchmarks(env, fanmatch, gamesToday.data || [], id)
            : { inserted: 0, already: 0, unmatched: fanmatch.n || 0, matched: 0 };
          writes.writesSucceeded += benchmark.inserted;
          report.push({
            ok: true,
            available: Boolean(fanmatch.ok),
            required: false,
            benchmarkOnly: true,
            status: fanmatch.httpStatus || 0,
            n: fanmatch.n || 0,
            matched: benchmark.matched,
            unmatched: benchmark.unmatched,
            path: "api.php?endpoint=fanmatch",
            source: "kenpom-fanmatch",
            reason: fanmatch.ok ? null : fanmatch.error || "fanmatch-unavailable",
          });
          await persistObservation(env, {
            source: "kenpom-fanmatch",
            sport: "cbb",
            endpoint: "fanmatch",
            season: y,
            partition: fanmatchDate,
            data: fanmatch.rows || [],
            jobRunId: id,
            status: fanmatch.ok ? "ok" : "failed",
          });
        }

        const merged = mergeCbbCatalogs(cbbdCatalog, torvik, kenpom);
        gamesDiscovered += merged.n;
        writes.writesSucceeded += await persistTeamFeatures(
          env,
          "cbb",
          y,
          merged,
          id,
          { featureVersion: "cbb-features-v3-cbbd-torvik-kenpom" }
        );
      }
    }

    if (job === "cfb-postgame-harvest" || job === "cbb-postgame-harvest") {
      const sport = job.startsWith("cfb") ? "cfb" : "cbb";
      const date = opts.date || shiftDateCT(todayCT(), -1);
      const path = "/games";
      // ONE scheduled morning CFB batch. A single /games response discovers
      // yesterday's completed fixtures; weekly bulk box-score calls only happen
      // when a prior-day FBS game actually finished.
      const query = sport === "cfb" ? { year: yearCfb, seasonType: "both" } : { season: yearCbb, startDateRange: date, endDateRange: date };
      const res = sport === "cfb" ? await cfbdGet(path, env, { query,fetchFn:opts.fetchFn||fetch }) : await cbbdGet(path, env, { query });
      report.push(collegePublicResult(res));
      if(!res.ok)throw Error(res.reason||"COLLEGE_DAILY_GAME_DISCOVERY_FAILED");
      const finals = sport === "cfb"
        ? cfbDailyFinals(res.data,date)
        : (res.data || []).filter(g=>(g.homePoints??g.home_points??g.homeScore)!=null);
      gamesDiscovered = finals.length;
      if(sport === "cfb"){
        const weeks=cfbDailyWeeks(finals,yearCfb);
        if(finals.length && !weeks.length)throw Error("CFBD_DAILY_MISSING_WEEK_METADATA");
        // A week request provides all box scores, not one HTTP call per team,
        // player or game. Strict partitioning only persists yesterday's IDs.
        for(const w of weeks){
          for(const endpoint of ["/games/teams","/games/players"]){
            const box=await cfbdGet(endpoint,env,{query:w,fetchFn:opts.fetchFn||fetch});
            report.push(collegePublicResult(box));
            if(!box.ok)throw Error(box.reason||"CFBD_DAILY_BOX_FETCH_FAILED");
            const selected=cfbDailyBoxRows(box.data,finals);
            const expected=finals.filter(g=>Number(g.week)===w.week&&
              String(g.seasonType||g.season_type||"regular")===w.seasonType).length;
            if(selected.length!==expected)throw Error("CFBD_DAILY_BOX_INCOMPLETE: "+endpoint+
              " matched="+selected.length+" expected="+expected);
            const persisted=await persistObservation(env,{
              source:"cfbd",sport,endpoint,season:yearCfb,partition:date,
              data:selected,jobRunId:id,archiveFullPayload:true,
            });
            if(!persisted?.ok)throw Error("CFBD_DAILY_D1_ARCHIVE_POINTER_FAILED: "+endpoint);
            if(persisted.r2Key)cfbDailyArchives.push({endpoint,week:w.week,seasonType:w.seasonType,r2Key:persisted.r2Key,storage:persisted.storage});
            writes.writesSucceeded+=persisted.inserted||0;
          }
          // One optional CFBD /drives batch per already authorized postgame
          // week. Reuses the existing morning-only CFBD quota ledger, NEVER an
          // extra unrestricted network owner or per-team/per-game request.
          if (env.CFB_DRIVE_RESEARCH_COLLECTION === "enabled" &&
              env.CFB_DB?.prepare && env.cfbdNetworkAuthorized === true &&
              env.cfbdCacheOnly !== true && opts.trigger === "schedule") {
            const driveRes = await cfbdGet("/drives",env,{query:w,fetchFn:opts.fetchFn||fetch});
            const ids=new Set(finals.filter(g=>Number(g.week)===w.week &&
              String(g.seasonType||g.season_type||"regular")===w.seasonType)
              .map(g=>String(g.id||g.gameId)));
            if(driveRes.ok && Array.isArray(driveRes.data)){
              try{
                const selected=driveRes.data.filter(d=>ids.has(String(d.gameId)));
                const selectedFinals=finals.filter(g=>ids.has(String(g.id||g.gameId)));
                const drivePersist=await ingestCfbDriveBatch(env,{
                  finals:selectedFinals,drives:selected,
                  observedAt:new Date().toISOString(),
                });
                cfbDailyArchives.push({endpoint:"/drives",week:w.week,
                  source:"CFBD_DRIVES",researchOnly:true,
                  inserted:drivePersist.inserted,rejected:drivePersist.rejected,
                  quotaOwner:"cfb-postgame-harvest"});
                writes.writesSucceeded+=drivePersist.inserted;
              }catch(err){
                // Optional research must not jeopardize canonical postgame
                // grades, but its failure is visible to the operator.
                cfbDailyArchives.push({endpoint:"/drives",researchOnly:true,
                  status:"RESEARCH_FAILED",reason:String(err?.message||err).slice(0,120)});
              }
            }else{
              cfbDailyArchives.push({endpoint:"/drives",researchOnly:true,
                status:"SOURCE_UNAVAILABLE_OR_QUOTA_GATED",reason:driveRes.reason||"CFBD_UNAVAILABLE"});
            }
          }
        }
      }
      if (sport === "cbb") {
        const fanmatch = await loadKenpomFanmatch(env, { date, fetchFn: opts.fetchFn || fetch });
        const benchmark = fanmatch.ok
          ? await persistKenpomFanmatchBenchmarks(env, fanmatch, finals, id)
          : { inserted: 0, already: 0, unmatched: fanmatch.n || 0, matched: 0 };
        writes.writesSucceeded += benchmark.inserted;
        report.push({
          ok: true,
          available: Boolean(fanmatch.ok),
          required: false,
          benchmarkOnly: true,
          status: fanmatch.httpStatus || 0,
          n: fanmatch.n || 0,
          matched: benchmark.matched,
          unmatched: benchmark.unmatched,
          path: "api.php?endpoint=fanmatch",
          source: "kenpom-fanmatch",
          reason: fanmatch.ok ? null : fanmatch.error || "fanmatch-unavailable",
        });
        await persistObservation(env, {
          source: "kenpom-fanmatch",
          sport: "cbb",
          endpoint: "fanmatch",
          season: yearCbb,
          partition: date,
          data: fanmatch.rows || [],
          jobRunId: id,
          status: fanmatch.ok ? "ok" : "failed",
        });
      }
      const existing = await queryModelPredictions(env, { sport, ungraded: true, limit: 200 });
      for (const pred of existing) {
        const g = finals.find((x) => String(x.id || x.gameId) === String(pred.game_id));
        if (!g) continue;
        const hs = Number(g.homePoints ?? g.home_points ?? g.homeScore);
        const as = Number(g.awayPoints ?? g.away_points ?? g.awayScore);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        const grade = gradeScores(pred, hs, as);
        await gradeModelPrediction(env, { id: pred.id, actualHome: hs, actualAway: as, grade });
        writes.writesSucceeded += 1;
      }
      const dailySaved=await persistObservation(env, { source: sport === "cfb" ? "cfbd" : "cbbd",
        sport, endpoint: path, season: sport === "cfb" ? yearCfb : yearCbb,
        partition: date, data: finals, jobRunId: id,archiveFullPayload:sport==="cfb" });
      if(sport==="cfb"&&!dailySaved?.ok)throw Error("CFBD_DAILY_RESULTS_POINTER_FAILED");
      if(sport==="cfb"&&dailySaved.r2Key)cfbDailyArchives.push({endpoint:path,r2Key:dailySaved.r2Key,storage:dailySaved.storage});
      if(sport==="cfb")writes.writesSucceeded+=dailySaved.inserted||0;
    }
  } catch (err) {
    errors.push(String(err?.message || err));
  }

  const failed = report.filter((r) => r && r.ok === false).length;
  const profileWriteFailed = errors.some((e) => String(e).includes("CBB_PROFILE_PERSISTENCE_FAILED"));
  const status = (profileWriteFailed || (job==="cfb-postgame-harvest" && (errors.length>0 || failed>0)))
    ? JOB_FAILED : classifyJobStatus({
    okSports: failed === report.length && report.length ? 0 : 1,
    failedSports: failed && failed === report.length ? 1 : 0,
    writesFailed: 0,
    unbound: !hasDb(env),
    requiredFailed: errors.length > 0 && !report.length,
  });
  const quota = await queryQuota(env);
  const payload = jobPayload({
    ok: status === "success",
    job,
    status,
    triggerType: opts.trigger || "http",
    attemptedAt: started,
    successfulAt: status === "success" ? new Date().toISOString() : null,
    sports: [job.startsWith("cbb") ? "cbb" : job.startsWith("cfb") ? "cfb" : "college"],
    gamesDiscovered,
    writes,
    errors: errors.concat(report.filter((r) => r && !r.ok).map((r) => r.reason)).slice(0, 20),
    env,
    d1: {bound:hasDb(env),quota,endpoints:report,keyHealth:collegeKeyHealth(env),
      ...(coreAdvancedSummary?{coreAdvanced:coreAdvancedSummary}:{}),
      ...(job==="cfb-postgame-harvest"?{
        cfbDailyArchive:{date:opts.date||shiftDateCT(todayCT(),-1),
          payloads:cfbDailyArchives,modelAuthority:false,wagerAuthority:false,
          postgameStatTablesPromoted:false}
      }:{})},
  });
  await recordJob(env, {
    id,
    jobType: job,
    triggerType: opts.trigger || "http",
    startedAt: started,
    completedAt: payload.successful_at || new Date().toISOString(),
    status: payload.status,
    sport: payload.sports[0],
    gamesDiscovered,
    ...(job==="cfb-postgame-harvest"?{
      dates:[{date:opts.date||shiftDateCT(todayCT(),-1),
        archivePayloads:cfbDailyArchives,postgameStatTablesPromoted:false}]
    }:{}),
    writesAttempted: writes.writesSucceeded,
    writesSucceeded: writes.writesSucceeded,
    writesFailed: writes.writesFailed,
    errors: payload.errors,
    env,
  });
  return payload;
}

export function indexCfbRatings(bundles) {
  // Persist research-grade advanced fields alongside SP ratings. Source values
  // retain their own names; no PPA-to-EPA equivalence is assumed.
  const byEspnId={},byCanonicalId={};
  const n=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
  const collections=[
    ["/ratings/sp",(r)=>({sp:n(r.rating),off:n(r.offense?.rating??r.offensiveRating),def:n(r.defense?.rating??r.defensiveRating)})],
    ["/ratings/fpi",(r)=>({fpi:n(r.fpi??r.rating)})],
    ["/ratings/srs/expanded",(r)=>({srs:n(r.rating)})],
    ["/ratings/elo",(r)=>({elo:n(r.elo??r.rating)})],
    ["/ratings/core",(r)=>({
      core:n(r.rating??r.overall),
      coreOffense:n(r.offense?.rating??r.offense),
      coreDefense:n(r.defense?.rating??r.defense),
      coreSpecialTeams:n(r.specialTeams?.rating??r.specialTeams),
      coreThroughWeek:n(r.throughWeek??r.week),
      coreThroughSeasonType:r.throughSeasonType||r.seasonType||null,
      coreSourceEndpoint:"/ratings/core",
      coreTemporalClass:"B",
    })],
    ["/ppa/teams",(r)=>({
      ppaOff:n(r.offense?.overall),ppaDef:n(r.defense?.overall),
      ppaPass:n(r.offense?.passing),ppaRush:n(r.offense?.rushing),
      ppaPassAllowed:n(r.defense?.passing),ppaRushAllowed:n(r.defense?.rushing),
    })],
    ["/stats/season/advanced",(r)=>({
      offensiveSuccessRate:n(r.offense?.successRate),
      defensiveSuccessRate:n(r.defense?.successRate),
      offensiveExplosiveness:n(r.offense?.explosiveness),
      defensiveExplosiveness:n(r.defense?.explosiveness),
      offensiveLineYards:n(r.offense?.lineYards),
      defensiveLineYards:n(r.defense?.lineYards),
      offensiveHavoc:n(r.offense?.havoc?.total),
      defensiveHavoc:n(r.defense?.havoc?.total),
      offensivePointsPerOpportunity:n(r.offense?.pointsPerOpportunity),
      defensivePointsPerOpportunity:n(r.defense?.pointsPerOpportunity),
      offensiveStuffRate:n(r.offense?.stuffRate),
      defensiveStuffRate:n(r.defense?.stuffRate),
      fieldPositionOffense:n(r.offense?.fieldPosition?.averageStart),
      fieldPositionDefense:n(r.defense?.fieldPosition?.averageStart),
    })],
    ["/talent",(r)=>({talent:n(r.talent)})],
    ["/player/returning",(r)=>({
      returningPpa:n(r.percentPPA),
      returningYards:n(r.percentYards),
      returningUsage:n(r.percentUsage),
    })],
  ];
  const coverage={};
  for(const [path,map] of collections){
    const rows=Array.isArray(bundles[path])?bundles[path]:[];
    coverage[path]=rows.length;
    for(const row of rows){
      const school=row.team||row.school;
      if(!school)continue;
      const mapped=mapSourceTeam("cfb",{...row,team:school});
      if(!mapped.ok)continue;
      const id=mapped.canonicalId;
      const previous=byCanonicalId[id]||{
        canonicalId:id,team:school,conference:row.conference||null
      };
      const patch=Object.fromEntries(Object.entries(map(row)).filter(([,v])=>v!==null));
      const record={...previous,...patch};
      byCanonicalId[id]=record;
      if(mapped.espnId)byEspnId[String(mapped.espnId)]=record;
    }
  }
  return {byCanonicalId,byEspnId,n:Object.keys(byCanonicalId).length,coverage};
}

export function gradeScores(pred, actualHome, actualAway) {
  const ah = Number(actualHome);
  const aa = Number(actualAway);
  const ph = Number(pred.proj_home ?? pred.projHome);
  const pa = Number(pred.proj_away ?? pred.projAway);
  if (![ah, aa, ph, pa].every(Number.isFinite)) return { ok: false };
  const actualTotal = ah + aa;
  const actualMargin = ah - aa;
  const projTotal = ph + pa;
  const projMargin = ph - pa;
  return {
    ok: true,
    errHome: ph - ah,
    errAway: pa - aa,
    errTotal: projTotal - actualTotal,
    errMargin: projMargin - actualMargin,
    winnerHit: (ph > pa) === (ah > aa),
  };
}

export { lookupCbbdRating, indexCbbdAdjusted };

function normalizeName(v = "") {
  return String(v)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function indexQbStats(rows = []) {
  const byId = new Map();
  const byName = new Map();
  for (const row of rows || []) {
    const id = row.playerId || row.player_id || row.athleteId || row.id || null;
    const name = row.player || row.playerName || row.name || row.athlete || "";
    const rec = {
      playerId: id ? String(id) : null,
      playerName: name || null,
      gamesStarted: num(row.gamesStarted ?? row.starts ?? row.games),
      passAttempts: num(row.passAttempts ?? row.attempts),
      usage: num(row.usage ?? row.usagePct ?? row.percent),
      passingPpa: num(row.passingPpa ?? row.ppa ?? row.epaPerPlay),
      passingWepa: num(row.passingWepa ?? row.wepa),
      successRate: num(row.successRate ?? row.success),
      explosiveRate: num(row.explosiveRate ?? row.explosive),
      sackRate: num(row.sackRate ?? row.sacksPerDropback),
      turnoverRate: num(row.turnoverRate ?? row.turnoversPerPlay ?? row.intRate),
      ypa: num(row.yardsPerAttempt ?? row.ypa),
      sourceSchool: row.team || row.school || row.schoolName || null,
      season: num(row.year ?? row.season),
    };
    if (rec.playerId) byId.set(rec.playerId, rec);
    const key = normalizeName(name);
    if (key) byName.set(key, rec);
  }
  return { byId, byName };
}

async function persistQbTransferSeason(env, { season, portalRows = [], qbStatRows = [], asOf }) {
  const idx = indexQbStats(qbStatRows);
  let okRows = 0;
  let failedRows = 0;
  for (const row of portalRows || []) {
    const pos = String(row.position || row.pos || row.positionGroup || "").toUpperCase();
    if (pos !== "QB" && !/QUARTERBACK/.test(pos)) continue;
    const direction = String(row.direction || row.type || row.movement || "").toLowerCase();
    const incoming =
      /\b(in|incoming|arrive|arriving|destination|commit|committed)\b/.test(direction) ||
      Boolean(row.destination || row.destinationTeam || row.newSchool || row.toTeam);
    if (!incoming) continue;
    const playerId = row.playerId || row.athleteId || row.id || null;
    const playerName = row.player || row.playerName || row.athlete || row.name || "";
    const stat =
      (playerId ? idx.byId.get(String(playerId)) : null) || idx.byName.get(normalizeName(playerName)) || null;
    const sourceSchool = row.origin || row.originSchool || row.previousSchool || row.fromTeam || stat?.sourceSchool || null;
    const destinationSchool = row.destination || row.destinationTeam || row.newSchool || row.toTeam || row.team || null;
    const rec = {
      id: `cfb:qb-transfer:${season}:${playerId || normalizeName(playerName)}:${normalizeName(destinationSchool || "")}`,
      playerId: playerId ? String(playerId) : null,
      playerName: playerName || stat?.playerName || null,
      season,
      sourceSchool,
      sourceTeamId: row.originTeamId || row.fromTeamId || null,
      destinationSchool,
      destinationTeamId: row.destinationTeamId || row.toTeamId || null,
      position: "QB",
      transferDate: row.transferDate || row.date || null,
      gamesStarted: stat?.gamesStarted ?? null,
      passAttempts: stat?.passAttempts ?? null,
      usage: stat?.usage ?? null,
      passingPpa: stat?.passingPpa ?? null,
      passingWepa: stat?.passingWepa ?? null,
      successRate: stat?.successRate ?? null,
      explosiveRate: stat?.explosiveRate ?? null,
      sackRate: stat?.sackRate ?? null,
      turnoverRate: stat?.turnoverRate ?? null,
      ypa: stat?.ypa ?? null,
      asOf,
      source: "cfbd",
      sourceObsId: null,
    };
    const out = await upsertQbTransferHistory(env, rec);
    if (out.ok) okRows += 1;
    else failedRows += 1;
  }
  return { okRows, failedRows };
}

const FREEZE_MODELS = {
  cfb: ["CFB-LEAGUE-BASELINE", "CFB-CFBD-RATINGS-v1", "CFB-CFBD-REG-v1", "CFB-CFBD-ENSEMBLE-v1", "CFB-FBIS-v2"],
  cbb: ["CBB-LEAGUE-BASELINE", "CBB-CBBD-RATINGS-v1", "CBB-TORVIK-RATINGS-v1", "CBB-KENPOM-RATINGS-v1", "CBB-ENSEMBLE-v1", "CBB-FBIS-PURE"],
  nfl: ["NFL-TEAM-FORM-v0", "NFL-FBIS-PURE"],
};

export async function persistGameChallengers(env, game, sport) {
  if (sport !== "cfb" && sport !== "cbb" && sport !== "nfl") return { ok: true, skipped: true };
  const keep = FREEZE_MODELS[sport] || [];
  const subset = {};
  for (const id of keep) {
    if (game?.challengers?.[id]) subset[id] = game.challengers[id];
  }
  const frozen = freezeChallengerPredictions(game, subset, { sport });
  let inserted = 0;
  let already = 0;
  for (const row of frozen) {
    const res = await insertModelPrediction(env, row);
    if (res.inserted) inserted += 1;
    else if (res.already) already += 1;
  }
  return { ok: true, inserted, already, kind: "challenger" };
}

export async function gradeGameChallengers(env, game, sport) {
  if (sport !== "cfb" && sport !== "cbb" && sport !== "nfl") return { ok: true, skipped: true };
  const hs = game?.home?.score;
  const as = game?.away?.score;
  if (hs == null || as == null) return { ok: true, skipped: true };
  const rows = await queryModelPredictions(env, { sport, gameId: String(game.id), ungraded: true, limit: 20 });
  for (const pred of rows) {
    await gradeModelPrediction(env, { id: pred.id, actualHome: hs, actualAway: as, grade: gradeScores(pred, hs, as) });
  }
  return { ok: true, graded: rows.length, kind: "challenger-grade" };
}

function evaluateValidationRows(rows = []) {
  const n = rows.length;
  if (!n) {
    return {
      n: 0,
      maeTotal: null,
      maeMargin: null,
      winnerHit: null,
      brierHomeWin: null,
      logLossHomeWin: null,
    };
  }
  let sumAbsTotal = 0;
  let sumAbsMargin = 0;
  let winnerHitN = 0;
  let brier = 0;
  let logLoss = 0;
  for (const r of rows) {
    const ph = Number(r.proj_home);
    const pa = Number(r.proj_away);
    const ah = Number(r.actual_home);
    const aa = Number(r.actual_away);
    if (![ph, pa, ah, aa].every(Number.isFinite)) continue;
    sumAbsTotal += Math.abs((ph + pa) - (ah + aa));
    sumAbsMargin += Math.abs((ph - pa) - (ah - aa));
    const predHome = ph > pa;
    const actualHome = ah > aa;
    if (predHome === actualHome) winnerHitN += 1;
    const p = Math.max(0.001, Math.min(0.999, Number(r.p_home_win) || (predHome ? 0.55 : 0.45)));
    const y = actualHome ? 1 : 0;
    brier += (p - y) ** 2;
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return {
    n,
    maeTotal: sumAbsTotal / n,
    maeMargin: sumAbsMargin / n,
    winnerHit: winnerHitN / n,
    brierHomeWin: brier / n,
    logLossHomeWin: logLoss / n,
  };
}

function rollingOriginFolds(rows = [], k = 4) {
  const ordered = [...rows].sort((a, b) => String(a.frozen_at || "").localeCompare(String(b.frozen_at || "")));
  if (ordered.length < k * 2) return [];
  const foldSize = Math.max(1, Math.floor(ordered.length / (k + 1)));
  const out = [];
  for (let i = 1; i <= k; i++) {
    const split = foldSize * i;
    const train = ordered.slice(0, split);
    const validate = ordered.slice(split, split + foldSize);
    if (!train.length || !validate.length) continue;
    out.push({ train, validate });
  }
  return out;
}
