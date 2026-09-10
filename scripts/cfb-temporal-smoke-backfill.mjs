#!/usr/bin/env node
/**
 * CFB historical smoke backfill + temporal provenance audit.
 *
 * Default: 2024 weeks 1–4 only. Does NOT fit or promote models.
 * Rejects historically unsafe same-season aggregates from the independent matrix.
 *
 * Env:
 *   CFBD_API_KEY (required)
 *   CFB_SMOKE_SEASON=2024
 *   CFB_SMOKE_WEEKS=1,2,3,4
 *   CFB_SMOKE_MAX_GAMES (optional)
 *   CFB_SMOKE_MODE=historical (default)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cfbdGet } from "../functions/lib/collegeApi.js";
import {
  fetchSeasonFeatureBundle,
  buildPriorCatalog,
  buildFcsConferenceStrength,
  assembleGameFeatures,
  PIPELINE_VERSION,
} from "../functions/lib/cfbFeaturePipeline.js";
import { indexCoreByTeam } from "../functions/lib/cfbdCanonical.js";
import { projectCfbFbisV2, CFB_FBIS_V2_ID } from "../functions/lib/cfbFbisV2.js";
import { identifyGamePlayerRoles } from "../functions/lib/cfbPlayerIdentity.js";
import {
  auditCatalogForGame,
  auditPreseasonPriorSources,
  auditPlayerRoleResolution,
  buildModelInputProvenance,
  historicallyRejectedEndpointReport,
  backfillRequestEstimate,
  TEMPORAL_AUDIT_VERSION,
} from "../functions/lib/cfbTemporalAudit.js";
import { assertNoSecretLeak } from "../functions/lib/collegeSecrets.js";
import { estimateRequestCount } from "../functions/lib/cfbdCanonical.js";

const env = { CFBD_API_KEY: process.env.CFBD_API_KEY || "" };
if (!env.CFBD_API_KEY) {
  console.error(JSON.stringify({ ok: false, error: "CFBD_API_KEY missing" }));
  process.exit(2);
}

const season = Number(process.env.CFB_SMOKE_SEASON || 2024);
const weeks = (process.env.CFB_SMOKE_WEEKS || "1,2,3,4")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const maxGames = process.env.CFB_SMOKE_MAX_GAMES ? Number(process.env.CFB_SMOKE_MAX_GAMES) : null;
const mode = process.env.CFB_SMOKE_MODE || "historical";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function schoolKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWeeks(path, seasonYear, weekList) {
  const rows = [];
  let calls = 0;
  for (const week of weekList) {
    const res = await cfbdGet(path, env, { query: { year: seasonYear, week, seasonType: "regular" } });
    calls += 1;
    if (res.ok && Array.isArray(res.data)) {
      for (const r of res.data) rows.push({ ...r, week, startDate: r.startDate || r.start_date || null });
    }
    await sleep(150);
  }
  return { rows, calls };
}

function attachKickoffs(rows, games) {
  const byId = new Map();
  for (const g of games || []) byId.set(String(g.id), g.startDate || g.start_date);
  return (rows || []).map((r) => ({
    ...r,
    startDate: r.startDate || byId.get(String(r.gameId || r.game_id)) || null,
  }));
}

const requestLog = [];
const snapshots = [];
const provenanceExamples = [];
const roleExamples = [];
const priorAudits = [];
const catalogAudits = [];

console.error(JSON.stringify({ phase: "start", season, weeks, mode, auditVersion: TEMPORAL_AUDIT_VERSION }));

const priorSeason = season - 1;
const priorBundle = await fetchSeasonFeatureBundle(env, priorSeason, { week: null });
requestLog.push({ kind: "prior-bundle", season: priorSeason, paths: Object.keys(priorBundle.endpoints || {}).length });
const priorCatalog = buildPriorCatalog(priorBundle);
const confMap = buildFcsConferenceStrength(priorCatalog);

// Current-season CORE for week-bounded lookups (filter client-side)
const coreRes = await cfbdGet("/ratings/core", env, { query: { year: season } });
requestLog.push({ kind: "core-season", season, ok: coreRes.ok, n: (coreRes.data || []).length });
await sleep(120);

const gamesRes = await cfbdGet("/games", env, { query: { year: season, seasonType: "regular" } });
requestLog.push({ kind: "games", season, ok: gamesRes.ok, n: (gamesRes.data || []).length });
const allGames = (gamesRes.data || []).filter((g) => weeks.includes(Number(g.week)));

const ppaFetch = await fetchWeeks("/ppa/games", season, weeks);
const advFetch = await fetchWeeks("/stats/game/advanced", season, weeks);
requestLog.push({ kind: "ppa-games", calls: ppaFetch.calls, rows: ppaFetch.rows.length });
requestLog.push({ kind: "adv-games", calls: advFetch.calls, rows: advFetch.rows.length });

const ppaRows = attachKickoffs(ppaFetch.rows, gamesRes.data);
const advRows = attachKickoffs(advFetch.rows, gamesRes.data);

// Representative case tags for manual audit
function tagGame(g) {
  const tags = [];
  if (Number(g.week) === 1) tags.push("week1");
  const homeClass = String(g.homeClassification || g.home_classification || "");
  const awayClass = String(g.awayClassification || g.away_classification || "");
  if (/fcs/i.test(homeClass) || /fcs/i.test(awayClass)) tags.push("fbs-fcs");
  else tags.push("fbs-fbs");
  if (Number(g.week) <= 4) tags.push("early-season");
  return tags;
}

let used = 0;
for (const g of allGames) {
  if (maxGames != null && used >= maxGames) break;
  const kickoff = g.startDate || g.start_date;
  if (!kickoff) continue;
  if ((g.homePoints ?? g.home_points) == null || (g.awayPoints ?? g.away_points) == null) {
    // Still allow pregame-style feature build for prospective, but smoke prefers completed for targets-separated check
  }
  const asOf = new Date(Date.parse(kickoff) - 60_000).toISOString();
  const maxCoreWeek = Math.max(0, Number(g.week) - 1);
  const coreByTeam = indexCoreByTeam(coreRes.data || [], { maxWeek: maxCoreWeek, seasonType: "regular" });

  const record = assembleGameFeatures({
    game: g,
    priorCatalog,
    confMap,
    ppaGameRows: ppaRows,
    advGameRows: advRows,
    qbRows: [], // historical: do not pass season aggregates
    usageRows: [],
    playerGameRows: [],
    coreByTeam,
    collectionTimestamp: asOf,
    mode,
  });
  if (!record.temporalOk) continue;

  const homeKey = schoolKey(record.home_team);
  const awayKey = schoolKey(record.away_team);
  const homePriorAudit = auditPreseasonPriorSources({
    gameYear: season,
    priorCatalogEntry: priorCatalog.bySchool[homeKey] || { sourceSeason: priorSeason },
    priorSeason,
  });
  const awayPriorAudit = auditPreseasonPriorSources({
    gameYear: season,
    priorCatalogEntry: priorCatalog.bySchool[awayKey] || { sourceSeason: priorSeason },
    priorSeason,
  });
  priorAudits.push({ gameId: String(g.id), home: homePriorAudit, away: awayPriorAudit });

  const catalogAudit = auditCatalogForGame({
    year: season,
    targetWeek: g.week,
    kickoffTimestamp: kickoff,
    predictionCutoff: asOf,
    priorSeason,
    coreThroughWeek: maxCoreWeek,
  });
  catalogAudits.push({ gameId: String(g.id), summary: catalogAudit.summary });

  const roles = identifyGamePlayerRoles(
    {
      id: g.id,
      week: g.week,
      season,
      startDate: kickoff,
      homeTeam: record.home_team,
      awayTeam: record.away_team,
      home: { name: record.home_team },
      away: { name: record.away_team },
    },
    {
      identityAsOf: asOf,
      // No future player-game rows — empty forces uncertain/widen where needed
      playerGameRows: [],
      qbPpaRows: [],
      rbPpaRows: [],
      wrPpaRows: [],
      usageRows: [],
    }
  );

  const roleAudit = {
    gameId: String(g.id),
    week: g.week,
    away: {
      QB1: auditPlayerRoleResolution(roles.roles.away.QB1),
      RB1: auditPlayerRoleResolution(roles.roles.away.RB1),
      WR1: auditPlayerRoleResolution(roles.roles.away.WR1),
    },
    home: {
      QB1: auditPlayerRoleResolution(roles.roles.home.QB1),
      RB1: auditPlayerRoleResolution(roles.roles.home.RB1),
      WR1: auditPlayerRoleResolution(roles.roles.home.WR1),
    },
  };
  roleExamples.push(roleAudit);

  const provenance = buildModelInputProvenance({
    game: g,
    featureRecord: record,
    roles: roleAudit,
    mode,
  });

  const gameInput = {
    sport: "cfb",
    home: { name: record.home_team },
    away: { name: record.away_team },
    neutralSite: Boolean(record.features.neutralSite),
    featureCutoffOk: true,
    cfbFbisV2Input: {
      home: { ...record.features.home, qbPpa: record.features.home.qbHistoricalUnsafe ? null : record.features.home.qbPpa },
      away: { ...record.features.away, qbPpa: record.features.away.qbHistoricalUnsafe ? null : record.features.away.qbPpa },
      neutralSite: record.features.neutralSite,
    },
  };
  // Strip evaluation from independent input
  const proj = projectCfbFbisV2(gameInput, { ablation: "K" });

  const snapshot = {
    game_id: String(g.id),
    season,
    week: g.week,
    season_type: "regular",
    kickoff_timestamp: kickoff,
    prediction_cutoff: asOf,
    home_team: record.home_team,
    away_team: record.away_team,
    tags: tagGame(g),
    feature_values: {
      home: record.features.home,
      away: record.features.away,
      neutralSite: record.features.neutralSite,
      dataCompleteness: record.features.dataCompleteness,
    },
    feature_provenance: provenance,
    feature_temporal_ok: record.temporalOk,
    model_data_version: PIPELINE_VERSION,
    role_snapshots: roleAudit,
    // Targets stored separately — not in feature matrix
    targets: {
      home_points: g.homePoints ?? g.home_points ?? null,
      away_points: g.awayPoints ?? g.away_points ?? null,
    },
    shadow_projection: proj.ok
      ? {
          modelId: CFB_FBIS_V2_ID,
          home: proj.home,
          away: proj.away,
          margin: proj.margin,
          total: proj.total,
          canQualify: false,
        }
      : { ok: false, reason: proj.reason },
    prior_audit: { home: homePriorAudit, away: awayPriorAudit },
  };
  snapshots.push(snapshot);

  // Keep a handful of detailed provenance examples covering required cases
  if (
    provenanceExamples.length < 12 &&
    (snapshot.tags.includes("week1") ||
      snapshot.tags.includes("fbs-fcs") ||
      snapshot.tags.includes("early-season") ||
      used < 4)
  ) {
    provenanceExamples.push({
      gameId: snapshot.game_id,
      matchup: `${snapshot.away_team} @ ${snapshot.home_team}`,
      week: snapshot.week,
      tags: snapshot.tags,
      predictionCutoff: asOf,
      independentFeatureCount: provenance.independentFeaturesPassed.length,
      rejectedFeatureCount: provenance.featuresRejected.length,
      rejectedReasons: [...new Set(provenance.featuresRejected.map((r) => r.exclusionReason))],
      priorSeasons: {
        home: homePriorAudit.consumedPriorSeason,
        away: awayPriorAudit.consumedPriorSeason,
        ok: homePriorAudit.ok && awayPriorAudit.ok,
      },
      roles: {
        awayQB: roleAudit.away.QB1,
        homeQB: roleAudit.home.QB1,
      },
      featuresPassedSample: provenance.independentFeaturesPassed.slice(0, 20),
      featuresRejectedSample: provenance.featuresRejected.slice(0, 20),
      fullProvenance: provenance,
    });
  }

  used += 1;
}

const rejectedEndpoints = historicallyRejectedEndpointReport();
const smokeEstimate = backfillRequestEstimate({ seasons: [season], smokeWeeks: weeks.length });
const fullEstimate = backfillRequestEstimate({ seasons: [2022, 2023, 2024, 2025], weeksPerSeason: 15 });
const canonicalEstimate = estimateRequestCount({ seasons: 4, weeks: 15 });

const report = {
  ok: true,
  job: "cfb-temporal-smoke-backfill",
  generatedAt: new Date().toISOString(),
  auditVersion: TEMPORAL_AUDIT_VERSION,
  pipelineVersion: PIPELINE_VERSION,
  mode,
  season,
  weeks,
  snapshotCount: snapshots.length,
  canQualify: false,
  canAuthorizeWager: false,
  championUntouched: true,
  fitted: false,
  researchReady: false,
  promotionReady: false,
  deployedClaim: false,
  governance: {
    "CFB-FBIS-v2": { canQualify: false },
    "CFB-PLAYER-v1": { canQualify: false },
    marketExcludedFromIndependent: true,
  },
  temporalAudit: {
    catalogSample: catalogAudits[0] || null,
    rejectedEndpoints,
    priorAuditOkRate:
      priorAudits.length === 0
        ? null
        : priorAudits.filter((p) => p.home.ok && p.away.ok).length / priorAudits.length,
  },
  requestLog,
  requestEstimates: {
    smoke: smokeEstimate,
    full2022_2025: fullEstimate,
    canonicalEstimate,
  },
  nextFullBackfillCommands: {
    note: "Only after smoke provenance audit passes",
    githubWorkflow: "FBIS college research",
    workflowDispatch: {
      job: "cfb-feature-backfill",
      seasons: "2022,2023,2024,2025",
      maxGames: "",
    },
    cli: [
      "export CFBD_API_KEY=***",
      "CFB_BACKFILL_SEASONS=2022,2023,2024,2025 CFB_BACKFILL_MODE=historical node scripts/cfb-feature-backfill.mjs",
    ],
    smokeCli: [
      "export CFBD_API_KEY=***",
      "CFB_SMOKE_SEASON=2024 CFB_SMOKE_WEEKS=1,2,3,4 node scripts/cfb-temporal-smoke-backfill.mjs",
    ],
  },
};

assertNoSecretLeak(report, env);
assertNoSecretLeak({ snapshots: snapshots.slice(0, 1), provenanceExamples }, env);

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/cfb-temporal-smoke-report.json", JSON.stringify(report, null, 2));
writeFileSync("artifacts/cfb-temporal-smoke-snapshots.json", JSON.stringify(snapshots, null, 2));
writeFileSync("artifacts/cfb-temporal-smoke-provenance-examples.json", JSON.stringify(provenanceExamples, null, 2));
writeFileSync("artifacts/cfb-temporal-smoke-role-examples.json", JSON.stringify(roleExamples.slice(0, 20), null, 2));
writeFileSync("artifacts/cfb-temporal-rejected-endpoints.json", JSON.stringify(rejectedEndpoints, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      season,
      weeks,
      snapshotCount: snapshots.length,
      provenanceExamples: provenanceExamples.length,
      priorAuditOkRate: report.temporalAudit.priorAuditOkRate,
      smokeRequestEstimate: smokeEstimate.estimate,
      fullRequestEstimate: fullEstimate.estimate,
      fitted: false,
      researchReady: false,
      artifacts: [
        "artifacts/cfb-temporal-smoke-report.json",
        "artifacts/cfb-temporal-smoke-provenance-examples.json",
        "artifacts/cfb-temporal-rejected-endpoints.json",
      ],
    },
    null,
    2
  )
);
