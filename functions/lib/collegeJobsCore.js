import {acknowledgeCfbdQuotaReplenishment,cfbCfbdAcquisitionHealth} from "./cfbCfbdAcquisition.js";
import {reconcileSharedCollegeQuota} from "./quota.js";
/**
 * Authenticated college research jobs. Each job is a separate Worker invocation.
 * Shadow models never auto-promote. Training does not run in this Worker.
 */

import { collegeKeyHealth, assertNoSecretLeak } from "./collegeSecrets.js";
import {freezeCfbPregameFeatures} from "./cfbPitFeatureDelivery.js";
import {
  cfbDailyFinals,
  cfbDailyWeeks,
  cfbDailyBoxRows,
  CFB_PLAYER_BOX_CATEGORIES,
  mergeGamesPlayersByCategory,
} from "./cfbDailyPostgame.js";
import { cfbdGet, cbbdGet, cfbSeasonYear, cbbSeasonYear, summarizeSchema, collegePublicResult } from "./collegeApi.js";
import { queryQuota, insertSourceObservation, insertTeamFeatureSnapshot, insertGameFeatureSnapshot, insertModelPrediction, gradeModelPrediction, upsertModelRegistry, insertModelArtifact, insertValidationRun, insertPromotionDecision, upsertTeamSeasonIdentity, queryModelPredictions, queryEndpointUsage, upsertQbTransferHistory, insertCfbdEndpointAudit } from "./collegeStore.js";
import { COLLEGE_MODELS, evaluatePromotion, PROMOTION_CRITERIA } from "./collegeModels.js";
import { projectCfbChallengers } from "./cfbRatings.js";
import { projectCbbChallengers, lookupCbbdRating } from "./cbbRatings.js";
import { mapSourceTeam, featureCutoffIso, cutoffViolated, hashPayload, collegeTeamCoverage } from "./collegeIdentity.js";
import { putArchive, r2Bound, r2Key, r2PrefixBytes } from "./r2Archive.js";
import { storageBudget } from "./storageBudget.js";
import { recordJob, newJobId, jobPayload, classifyJobStatus, emptyWriteCounts, JOB_FAILED } from "./jobs.js";
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
import { resolveGamesPlayedWithSource, GAMES_PLAYED_SOURCES, countCompletedGamesBySchool } from "./cfbGamesPlayed.js";
import {
  buildManifestRow,
  persistCollectionManifest,
  buildR2ArchiveManifestRow,
  CFBD_PATH_TO_DATASET,
} from "./cfbCollectionManifestPersist.js";

const WEEKLY_VALIDATION_JOB_ID = "cfb-e2e-weekly-validation";

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

export const COLLEGE_JOBS = [
  "cfb-reference-backfill",
  "cfb-current-refresh",
  "cfb-pregame-freeze",
  "cfb-postgame-harvest",
  "cfb-qb-transfer-refresh",
  "cfb-quota-replenish-ack",
  "cfbd-endpoint-audit",
  "cfb-e2e-weekly-validation",
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
  ["/games/teams", (y, w) => ({ year: y, week: w, seasonType: "regular", classification: "fbs" })],
];

/** Dataset ids that receive weekly reconstruction manifests. */
const CFB_WEEKLY_MANIFEST_PATHS = new Set([
  "/ppa/games",
  "/stats/game/advanced",
  "/games/teams",
  "/games/players",
]);

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
  const weekForManifest = estimateCfbWeekFromDate(new Date(), year) || 1;
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
    // Persist collection receipt for CFB refresh endpoints (no silent self-success).
    if (source === "cfbd" && sport === "cfb") {
      const datasetId = CFBD_PATH_TO_DATASET[path];
      if (datasetId) {
        const rows = Array.isArray(res.data) ? res.data : res.ok ? [res.data] : [];
        await persistCollectionManifest(
          env,
          buildManifestRow({
            season: year,
            week: weekForManifest,
            provider: "cfbd",
            datasetId,
            required: true,
            httpOk: Boolean(res.ok),
            httpStatus: res.status,
            rowCount: rows.length,
            teamCoverage: rows.length,
            contentHash: res.ok ? `job:${jobRunId}:${path}` : null,
            ingestionBatchId: jobRunId,
            collectedAt: new Date().toISOString(),
            evidence: { path, liveCollection: true },
          })
        );
      }
    }
    if(source === "cfbd" && !res.ok) {
      // Do not silently report a partial advanced refresh as successful.
      throw Error(res.reason || "CFBD_WEEKLY_REFRESH_INCOMPLETE");
    }
  }
  return { report, bundles };
}

function weeklyBundleKey(path) {
  if (path === "/ppa/games") return "ppaGames";
  if (path === "/stats/game/advanced") return "advGames";
  if (path === "/games/teams") return "gamesTeams";
  if (path === "/games/players") return "gamesPlayers";
  return path;
}

async function persistWeeklyDatasetManifest(env, {
  path,
  res,
  season,
  targetWeek,
  throughWeek,
  jobRunId,
  extraEvidence = {},
} = {}) {
  const weeklyDatasetId = CFBD_PATH_TO_DATASET[path];
  if (!weeklyDatasetId || !CFB_WEEKLY_MANIFEST_PATHS.has(path)) return null;
  const rows = Array.isArray(res?.data) ? res.data : [];
  return persistCollectionManifest(
    env,
    buildManifestRow({
      season,
      week: targetWeek,
      provider: "cfbd",
      datasetId: weeklyDatasetId,
      required: true,
      httpOk: Boolean(res?.ok),
      httpStatus: res?.status,
      rowCount: rows.length,
      teamCoverage: rows.length,
      throughWeek,
      contentHash: res?.ok ? `job:${jobRunId}:${path}:W${throughWeek}` : null,
      // Path suffix keeps teams vs players receipts distinct under one dataset id.
      ingestionBatchId: `${jobRunId}:${path}`,
      collectedAt: new Date().toISOString(),
      evidence: { path, weeklyReconstruction: true, throughWeek, ...extraEvidence },
    })
  );
}

/**
 * Budgeted CORE/advanced + box reconstruction for the prior completed week.
 * Soft-fails individual endpoints so season ratings still persist.
 * /games/players is fetched per CFBD category (passing|rushing|receiving).
 */
async function fetchWeeklyCoreAdvanced(env, { season, targetWeek, jobRunId, includePlayers = true } = {}) {
  const throughWeek = coreThroughWeekBound(targetWeek);
  const report = [];
  const bundles = {
    throughWeek,
    targetWeek,
    ppaGames: [],
    advGames: [],
    gamesTeams: [],
    gamesPlayers: [],
    qbPpa: [],
    rbPpa: [],
    wrPpa: [],
    usage: [],
  };
  if (throughWeek == null || throughWeek < 1) {
    return { report, bundles, skipped: "no-completed-week-yet" };
  }
  for (const [path, queryFn, key] of [
    ...CFB_WEEKLY_RECONSTRUCTION.map(([p, q]) => [p, q, weeklyBundleKey(p)]),
    ...(includePlayers
      ? [
          ["/ppa/players/season", (y) => ({ year: y, position: "QB" }), "qbPpa"],
          ["/ppa/players/season", (y) => ({ year: y, position: "RB" }), "rbPpa"],
          ["/ppa/players/season", (y) => ({ year: y, position: "WR" }), "wrPpa"],
          ["/player/usage", (y) => ({ year: y }), "usage"],
        ]
      : []),
  ]) {
    const query =
      path.startsWith("/ppa/games") ||
      path.startsWith("/stats/game") ||
      path.startsWith("/games/")
        ? queryFn(season, throughWeek)
        : queryFn(season);
    const res = await cfbdGet(path, env, { query });
    report.push(collegePublicResult(res));
    bundles[key] = res.ok ? res.data || [] : [];
    const persisted = await persistObservation(env, {
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
    await persistWeeklyDatasetManifest(env, {
      path,
      res,
      season,
      targetWeek,
      throughWeek,
      jobRunId,
      extraEvidence: persisted?.r2Key ? { r2Key: persisted.r2Key } : {},
    });
  }

  // CFBD /games/players requires category — three budgeted week-scoped calls.
  const playerCategoryBundles = [];
  for (const category of CFB_PLAYER_BOX_CATEGORIES) {
    const path = "/games/players";
    const query = { year: season, week: throughWeek, seasonType: "regular", category };
    const res = await cfbdGet(path, env, { query });
    report.push({ ...collegePublicResult(res), category });
    playerCategoryBundles.push({ category, rows: res.ok ? res.data || [] : [], ok: res.ok, status: res.status });
    const persisted = await persistObservation(env, {
      source: "cfbd",
      sport: "cfb",
      endpoint: path,
      season,
      partition: `week-${throughWeek}:gamesPlayers:${category}`,
      data: res.ok ? res.data : [],
      jobRunId,
      status: res.ok ? "ok" : "failed",
      archiveFullPayload: res.ok,
    });
    if (persisted?.r2Key) {
      playerCategoryBundles[playerCategoryBundles.length - 1].r2Key = persisted.r2Key;
    }
  }
  const mergedPlayers = mergeGamesPlayersByCategory(playerCategoryBundles);
  bundles.gamesPlayers = mergedPlayers;
  const anyPlayerOk = playerCategoryBundles.some((b) => b.ok && (b.rows?.length || 0) > 0);
  await persistWeeklyDatasetManifest(env, {
    path: "/games/players",
    res: {
      ok: anyPlayerOk,
      status: anyPlayerOk ? 200 : playerCategoryBundles[0]?.status || 0,
      data: mergedPlayers,
    },
    season,
    targetWeek,
    throughWeek,
    jobRunId,
    extraEvidence: {
      categories: CFB_PLAYER_BOX_CATEGORIES,
      categoryResults: playerCategoryBundles.map((b) => ({
        category: b.category,
        ok: b.ok,
        rowCount: b.rows?.length || 0,
        r2Key: b.r2Key || null,
      })),
    },
  });

  return { report, bundles, skipped: null };
}

/**
 * If weekly archives already exist in R2 but manifests were never written,
 * persist evidence-backed receipts (does not invent historical HTTP success).
 */
async function reconcileWeeklyR2Receipts(env, { season, targetWeek, throughWeek } = {}) {
  if (!r2Bound(env) || throughWeek == null) return { attempted: 0, succeeded: 0 };
  const specs = [
    { datasetId: "cfbd-ppa-games", prefix: `raw/cfbd/cfb/${season}/ppa_games/week-${throughWeek}` },
    { datasetId: "cfbd-stats-game-advanced", prefix: `raw/cfbd/cfb/${season}/stats_game_advanced/week-${throughWeek}` },
    { datasetId: "cfbd-games-teams-players", prefix: `raw/cfbd/cfb/${season}/games_teams/` },
    { datasetId: "cfbd-games-teams-players", prefix: `raw/cfbd/cfb/${season}/games_players/` },
  ];
  let attempted = 0;
  let succeeded = 0;
  for (const spec of specs) {
    const listed = await r2PrefixBytes(env, spec.prefix);
    if (!listed.ok || !(listed.objects > 0)) continue;
    attempted += 1;
    const row = buildR2ArchiveManifestRow({
      season,
      week: targetWeek,
      datasetId: spec.datasetId,
      r2Key: `${spec.prefix}*`,
      objectBytes: listed.bytes,
      throughWeek,
      uploadedAt: new Date().toISOString(),
    });
    if (!row) continue;
    row.evidence_json = JSON.stringify({
      ...JSON.parse(row.evidence_json || "{}"),
      r2Objects: listed.objects,
      r2Prefix: spec.prefix,
    });
    const saved = await persistCollectionManifest(env, row);
    if (saved.ok) succeeded += 1;
  }
  return { attempted, succeeded };
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

    // Post-collection / pre-freeze independent validation (does not trust collector self-success).
    if (job === "cfb-e2e-weekly-validation" || job === WEEKLY_VALIDATION_JOB_ID) {
      // Dynamic import keeps node:crypto (retentionGate) off the Vite client graph.
      const {
        executeWeeklyValidationJob,
        persistWeeklyValidationReceipt,
      } = await import("./cfbWeeklyValidationJob.js");
      const week = Number(opts.week || estimateCfbWeekFromDate(new Date()) || 8);
      const season = Number(opts.season || yearCfb);
      const evidenceByDataset = {};
      try {
        if (hasDb(env)) {
          const rows =
            (
              await env.DB.prepare(
                `SELECT dataset_id, http_ok, row_count, team_coverage, through_week, content_hash, collected_at
                   FROM cfb_collection_manifests WHERE season=? AND week=? ORDER BY collected_at DESC`
              )
                .bind(season, week)
                .all()
            ).results || [];
          for (const r of rows) {
            if (evidenceByDataset[r.dataset_id]) continue;
            evidenceByDataset[r.dataset_id] = {
              httpOk: Boolean(r.http_ok),
              rowCount: r.row_count,
              teamCoverage: r.team_coverage,
              throughWeek: r.through_week,
              contentHash: r.content_hash,
              collectedAt: r.collected_at,
              archived: Boolean(r.content_hash),
            };
          }
        }
      } catch {
        /* pre-migration manifests */
      }
      let d1FeatureTeamCount = null;
      try {
        if (hasDb(env)) {
          const row = await env.DB.prepare(
            `SELECT COUNT(DISTINCT team_id) AS n FROM team_feature_snapshots
              WHERE sport='cfb' AND season=? AND feature_version='cfb-features-v1'`
          )
            .bind(season)
            .first();
          d1FeatureTeamCount = Number(row?.n || 0);
        }
      } catch {
        /* ignore */
      }
      const result = executeWeeklyValidationJob({
        season,
        week,
        evidenceByDataset,
        d1FeatureTeamCount,
      });
      const runId = await persistWeeklyValidationReceipt(env, result, { season, week });
      if (runId) writes.writesSucceeded += 1;
      const payload = jobPayload({
        ok: true,
        job,
        status: result.pass ? "success" : "degraded",
        attemptedAt: started,
        successfulAt: new Date().toISOString(),
        env,
        writes,
        d1: {
          bound: hasDb(env),
          validation: {
            pass: result.pass,
            runId,
            essentials: result.essentials,
            unresolvedCount: (result.unresolvedFindings || []).length,
            scheduleConstraint: result.scheduleConstraint,
            note: "Independent of collector self-report; run after collection and before pregame freeze.",
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
        // Persist explicit gamesPlayed for auditability. Prefer schedule-derived
        // completed finals (CFBD /games bundle or durable D1 predictions);
        // else flagged CORE throughWeek — never leave gamesPlayed null when n is known.
        const d1ScheduleBySchool = await loadD1ScheduleGamesPlayedBySchool(env, y, Date.now());
        catalog = stampGamesPlayedOnCatalog(catalog, {
          gameRows: fetched.bundles["/games"] || [],
          scheduleBySchool: d1ScheduleBySchool,
          nowMs: Date.now(),
        });
        // Archive weekly PIT CORE for research replay (never promotes to champion).
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
          const r2Receipts = await reconcileWeeklyR2Receipts(env, {
            season: y,
            targetWeek,
            throughWeek: weekly.bundles.throughWeek,
          });
          weeklyMeta = {
            targetWeek,
            throughWeek: weekly.bundles.throughWeek,
            skipped: weekly.skipped,
            ppaGames: weekly.bundles.ppaGames.length,
            advGames: weekly.bundles.advGames.length,
            gamesTeams: weekly.bundles.gamesTeams?.length || 0,
            gamesPlayers: weekly.bundles.gamesPlayers?.length || 0,
            r2ReceiptReconcile: r2Receipts,
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
          const weekFinals=finals.filter(g=>Number(g.week)===w.week&&
            String(g.seasonType||g.season_type||"regular")===w.seasonType);
          const expected=weekFinals.length;

          // Team box — single week-scoped call, then filter to prior-day finals.
          {
            const endpoint="/games/teams";
            const box=await cfbdGet(endpoint,env,{query:w,fetchFn:opts.fetchFn||fetch});
            report.push(collegePublicResult(box));
            if(!box.ok){
              await persistCollectionManifest(env,buildManifestRow({
                season:yearCfb,week:w.week,provider:"cfbd",datasetId:"cfbd-games-teams-players",
                required:true,httpOk:false,httpStatus:box.status,rowCount:0,
                ingestionBatchId:id,evidence:{path:endpoint,postgame:true,date,reason:box.reason},
              }));
              throw Error(box.reason||"CFBD_DAILY_BOX_FETCH_FAILED");
            }
            const selected=cfbDailyBoxRows(box.data,weekFinals,{minTeams:2});
            if(selected.length!==expected)throw Error("CFBD_DAILY_BOX_INCOMPLETE: "+endpoint+
              " matched="+selected.length+" expected="+expected);
            const persisted=await persistObservation(env,{
              source:"cfbd",sport,endpoint,season:yearCfb,partition:date,
              data:selected,jobRunId:id,archiveFullPayload:true,
            });
            if(!persisted?.ok)throw Error("CFBD_DAILY_D1_ARCHIVE_POINTER_FAILED: "+endpoint);
            if(persisted.r2Key)cfbDailyArchives.push({endpoint,week:w.week,seasonType:w.seasonType,r2Key:persisted.r2Key,storage:persisted.storage});
            writes.writesSucceeded+=persisted.inserted||0;
            await persistCollectionManifest(env,buildManifestRow({
              season:yearCfb,week:w.week,provider:"cfbd",datasetId:"cfbd-games-teams-players",
              required:true,httpOk:true,httpStatus:box.status,rowCount:selected.length,
              teamCoverage:selected.length,contentHash:`job:${id}:${endpoint}:${date}`,
              ingestionBatchId:id+":"+endpoint,evidence:{path:endpoint,postgame:true,date,r2Key:persisted.r2Key||null},
            }));
          }

          // Player box — CFBD requires category; merge passing|rushing|receiving.
          {
            const endpoint="/games/players";
            const categoryBundles=[];
            for(const category of CFB_PLAYER_BOX_CATEGORIES){
              const box=await cfbdGet(endpoint,env,{
                query:{...w,category},
                fetchFn:opts.fetchFn||fetch,
              });
              report.push({...collegePublicResult(box),category});
              if(!box.ok){
                await persistCollectionManifest(env,buildManifestRow({
                  season:yearCfb,week:w.week,provider:"cfbd",datasetId:"cfbd-games-teams-players",
                  required:true,httpOk:false,httpStatus:box.status,rowCount:0,
                  ingestionBatchId:id,
                  evidence:{path:endpoint,category,postgame:true,date,reason:box.reason},
                }));
                throw Error(box.reason||"CFBD_DAILY_BOX_FETCH_FAILED");
              }
              categoryBundles.push({category,rows:box.data||[]});
            }
            const merged=mergeGamesPlayersByCategory(categoryBundles);
            const selected=cfbDailyBoxRows(merged,weekFinals,{minTeams:1});
            if(selected.length!==expected)throw Error("CFBD_DAILY_BOX_INCOMPLETE: "+endpoint+
              " matched="+selected.length+" expected="+expected);
            const persisted=await persistObservation(env,{
              source:"cfbd",sport,endpoint,season:yearCfb,partition:`${date}:players`,
              data:selected,jobRunId:id,archiveFullPayload:true,
            });
            if(!persisted?.ok)throw Error("CFBD_DAILY_D1_ARCHIVE_POINTER_FAILED: "+endpoint);
            if(persisted.r2Key)cfbDailyArchives.push({
              endpoint,week:w.week,seasonType:w.seasonType,r2Key:persisted.r2Key,
              storage:persisted.storage,categories:[...CFB_PLAYER_BOX_CATEGORIES],
            });
            writes.writesSucceeded+=persisted.inserted||0;
            await persistCollectionManifest(env,buildManifestRow({
              season:yearCfb,week:w.week,provider:"cfbd",datasetId:"cfbd-games-teams-players",
              required:true,httpOk:true,httpStatus:200,rowCount:selected.length,
              teamCoverage:selected.length,contentHash:`job:${id}:${endpoint}:${date}`,
              ingestionBatchId:id+":"+endpoint,
              evidence:{
                path:endpoint,postgame:true,date,r2Key:persisted.r2Key||null,
                categories:[...CFB_PLAYER_BOX_CATEGORIES],
              },
            }));
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

/**
 * Durable schedule game counts from graded CFB predictions (no provider call).
 */
export async function loadD1ScheduleGamesPlayedBySchool(env, season, nowMs = Date.now()) {
  if (!env?.DB?.prepare) return new Map();
  const cutoff = new Date(nowMs).toISOString();
  try {
    const rows = await env.DB.prepare(
      `SELECT g.home_name AS home_name, g.away_name AS away_name
         FROM predictions p
         LEFT JOIN games g ON g.id = p.game_id
        WHERE p.sport='cfb' AND p.date >= ? AND p.date <= ?
          AND p.actual_home IS NOT NULL AND p.actual_away IS NOT NULL
          AND (g.start IS NULL OR g.start < ?)
        LIMIT 4000`
    )
      .bind(`${season}-08-01`, `${season}-12-31`, cutoff)
      .all();
    const bySchool = new Map();
    const bump = (name) => {
      if (!name) return;
      const key = String(name)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!key) return;
      bySchool.set(key, (bySchool.get(key) || 0) + 1);
    };
    for (const r of rows?.results || []) {
      bump(r.home_name);
      bump(r.away_name);
    }
    return bySchool;
  } catch {
    return new Map();
  }
}

/**
 * Attach gamesPlayed (+ source/uncertainty) onto each catalog team row before D1 persist.
 * Never invent counts. Schedule > explicit > coreThroughWeek fallback.
 */
export function stampGamesPlayedOnCatalog(
  catalog = {},
  { gameRows = [], scheduleBySchool = null, nowMs = Date.now() } = {}
) {
  const fromGames = countCompletedGamesBySchool(gameRows, nowMs);
  const bySchool = new Map([...(scheduleBySchool || new Map()), ...fromGames]);
  const byCanonicalId = { ...(catalog.byCanonicalId || {}) };
  const byEspnId = { ...(catalog.byEspnId || {}) };
  let stamped = 0;
  let scheduleN = 0;
  let fallbackN = 0;
  for (const [id, row] of Object.entries(byCanonicalId)) {
    const schoolKey = String(row.team || row.school || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const scheduleGamesPlayed = schoolKey ? bySchool.get(schoolKey) || null : null;
    const resolved = resolveGamesPlayedWithSource(row, { scheduleGamesPlayed });
    const next = {
      ...row,
      gamesPlayed: resolved.gamesPlayed,
      gamesPlayedSource: resolved.source,
      gamesPlayedUncertainty: resolved.uncertainty === true,
      gamesPlayedNote: resolved.note,
    };
    // Ensure CORE fallback can fire on next read even if writer omitted bounded flag.
    if (
      resolved.source === GAMES_PLAYED_SOURCES.CORE_THROUGH_WEEK_FALLBACK &&
      next.coreWeekBounded !== true &&
      next.coreThroughWeek != null
    ) {
      next.coreWeekBounded = true;
    }
    byCanonicalId[id] = next;
    if (row.espnId || id) {
      const espnKey = String(row.espnId || id.replace(/^cfb-/, ""));
      if (byEspnId[espnKey]) byEspnId[espnKey] = next;
    }
    if (resolved.gamesPlayed != null && resolved.gamesPlayed > 0) {
      stamped += 1;
      if (resolved.source === GAMES_PLAYED_SOURCES.SCHEDULE) scheduleN += 1;
      if (resolved.source === GAMES_PLAYED_SOURCES.CORE_THROUGH_WEEK_FALLBACK) fallbackN += 1;
    }
  }
  return {
    ...catalog,
    byCanonicalId,
    byEspnId,
    gamesPlayedStamp: { stamped, scheduleN, fallbackN, scheduleSchools: bySchool.size },
  };
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
