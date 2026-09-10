#!/usr/bin/env node
/**
 * CFB historical smoke backfill + hardened temporal provenance audit.
 * Default: 2024 weeks 1–4. Does NOT fit or promote models.
 *
 * Env:
 *   CFBD_API_KEY (required)
 *   CFB_SMOKE_SEASON=2024
 *   CFB_SMOKE_WEEKS=1,2,3,4
 *   CFB_SMOKE_MAX_GAMES (optional)
 *   CFB_SMOKE_MODE=historical
 *   CFB_SMOKE_PLAYER_ROLE_N=12  (representative games for real player-game identity)
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
import { indexCoreByTeam, estimateRequestCount } from "../functions/lib/cfbdCanonical.js";
import { projectCfbFbisV2, CFB_FBIS_V2_ID } from "../functions/lib/cfbFbisV2.js";
import { identifyGamePlayerRoles, filterPlayerGamesBeforeKickoff } from "../functions/lib/cfbPlayerIdentity.js";
import {
  auditPreseasonPriorSources,
  auditPlayerRoleResolution,
  auditCoreProvenance,
  buildModelInputProvenance,
  historicallyRejectedEndpointReport,
  backfillRequestEstimate,
  TEMPORAL_AUDIT_VERSION,
} from "../functions/lib/cfbTemporalAudit.js";
import { assertNoSecretLeak } from "../functions/lib/collegeSecrets.js";

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
const playerRoleN = Number(process.env.CFB_SMOKE_PLAYER_ROLE_N || 12);

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

async function fetchWeeks(path, seasonYear, weekList, extraQuery = {}) {
  const rows = [];
  let calls = 0;
  for (const week of weekList) {
    const res = await cfbdGet(path, env, {
      query: { year: seasonYear, week, seasonType: "regular", ...extraQuery },
    });
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
    gameId: r.gameId || r.game_id || null,
  }));
}

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

function normalizePlayerGameRow(r, gamesById) {
  const gid = String(r.gameId || r.game_id || "");
  const kick = r.startDate || r.start_date || gamesById.get(gid) || null;
  return {
    ...r,
    gameId: gid || null,
    team: r.team || r.school || null,
    name: r.name || r.player || r.athleteName || null,
    position: r.position || r.pos || null,
    startDate: kick,
    passingAttempts: r.passingAttempts ?? r.passAttempts ?? r.attempts ?? null,
    passingYards: r.passingYards ?? r.passYards ?? null,
    rushingAttempts: r.rushingAttempts ?? r.carries ?? null,
    rushingYards: r.rushingYards ?? null,
    receptions: r.receptions ?? null,
    receivingYards: r.receivingYards ?? null,
    targets: r.targets ?? r.receivingTargets ?? null,
    week: r.week ?? null,
  };
}

const requestLog = [];
const snapshots = [];
const provenanceExamples = [];
const roleExamplesUncertain = [];
const roleExamplesReconstructed = [];
const priorAudits = [];

let counts = {
  snapshots: 0,
  provenancePass: 0,
  provenanceFail: 0,
  priorPass: 0,
  priorFail: 0,
  priorMissing: 0,
  postCutoffRejections: 0,
  coreCutoffRejections: 0,
  corePresentOk: 0,
};

console.error(JSON.stringify({ phase: "start", season, weeks, mode, auditVersion: TEMPORAL_AUDIT_VERSION }));

const priorSeason = season - 1;
const priorBundle = await fetchSeasonFeatureBundle(env, priorSeason, { week: null });
requestLog.push({ kind: "prior-bundle", season: priorSeason });
const priorCatalog = buildPriorCatalog(priorBundle);
const confMap = buildFcsConferenceStrength(priorCatalog);

const coreRes = await cfbdGet("/ratings/core", env, { query: { year: season } });
requestLog.push({ kind: "core-season", season, ok: coreRes.ok, n: (coreRes.data || []).length });
await sleep(120);

const gamesRes = await cfbdGet("/games", env, { query: { year: season, seasonType: "regular" } });
requestLog.push({ kind: "games", season, ok: gamesRes.ok, n: (gamesRes.data || []).length });
const allGames = (gamesRes.data || []).filter((g) => weeks.includes(Number(g.week)));
const gamesById = new Map((gamesRes.data || []).map((g) => [String(g.id), g.startDate || g.start_date]));

const ppaFetch = await fetchWeeks("/ppa/games", season, weeks);
const advFetch = await fetchWeeks("/stats/game/advanced", season, weeks);
requestLog.push({ kind: "ppa-games", calls: ppaFetch.calls, rows: ppaFetch.rows.length });
requestLog.push({ kind: "adv-games", calls: advFetch.calls, rows: advFetch.rows.length });

const ppaRows = attachKickoffs(ppaFetch.rows, gamesRes.data);
const advRows = attachKickoffs(advFetch.rows, gamesRes.data);

// Player-game rows for role reconstruction slice
const gamesPlayers = await fetchWeeks("/games/players", season, weeks, { category: "passing" });
const gamesPlayersRush = await fetchWeeks("/games/players", season, weeks, { category: "rushing" });
const gamesPlayersRec = await fetchWeeks("/games/players", season, weeks, { category: "receiving" });
requestLog.push({
  kind: "games-players",
  calls: gamesPlayers.calls + gamesPlayersRush.calls + gamesPlayersRec.calls,
  rows: gamesPlayers.rows.length + gamesPlayersRush.rows.length + gamesPlayersRec.rows.length,
});
const playerGameRowsRaw = [...gamesPlayers.rows, ...gamesPlayersRush.rows, ...gamesPlayersRec.rows].map((r) =>
  normalizePlayerGameRow(r, gamesById)
);

let used = 0;
for (const g of allGames) {
  if (maxGames != null && used >= maxGames) break;
  const kickoff = g.startDate || g.start_date;
  if (!kickoff) continue;
  const asOf = new Date(Date.parse(kickoff) - 60_000).toISOString();
  const maxCoreWeek = Math.max(0, Number(g.week) - 1);
  const coreByTeam = indexCoreByTeam(coreRes.data || [], { maxWeek: maxCoreWeek, seasonType: "regular" });

  const record = assembleGameFeatures({
    game: g,
    priorCatalog,
    confMap,
    ppaGameRows: ppaRows,
    advGameRows: advRows,
    qbRows: [],
    usageRows: [],
    playerGameRows: [],
    coreByTeam,
    collectionTimestamp: asOf,
    mode,
  });
  if (!record.temporalOk) continue;

  const homeKey = schoolKey(record.home_team);
  const awayKey = schoolKey(record.away_team);
  // Fail closed: do NOT invent { sourceSeason: priorSeason } for missing teams
  const homeEntry = priorCatalog.bySchool[homeKey] || null;
  const awayEntry = priorCatalog.bySchool[awayKey] || null;
  const homePriorAudit = auditPreseasonPriorSources({
    gameYear: season,
    priorCatalogEntry: homeEntry,
    priorSeason,
  });
  const awayPriorAudit = auditPreseasonPriorSources({
    gameYear: season,
    priorCatalogEntry: awayEntry,
    priorSeason,
  });
  priorAudits.push({ gameId: String(g.id), home: homePriorAudit, away: awayPriorAudit });
  for (const a of [homePriorAudit, awayPriorAudit]) {
    if (a.ok) counts.priorPass += 1;
    else {
      counts.priorFail += 1;
      if (a.exclusionReason === "missing-source-provenance") counts.priorMissing += 1;
    }
  }

  // CORE: use actual retrieved row throughWeek — never substitute maxCoreWeek as if it were the row
  for (const side of ["home", "away"]) {
    const feat = record.features[side];
    const coreAudit = auditCoreProvenance({
      coreRow: feat.coreRow,
      targetWeek: g.week,
      targetKickoffTimestamp: kickoff,
    });
    if (feat.coreThroughWeek != null || feat.coreRating != null) {
      if (coreAudit.ok) counts.corePresentOk += 1;
      else counts.coreCutoffRejections += 1;
    }
  }

  // Count contaminated / post-cutoff among assembled source observations
  for (const side of ["home", "away"]) {
    for (const obs of record.features[side].sourceObservations || []) {
      const sk = Date.parse(obs.sourceKickoffTimestamp || "");
      if (!Number.isFinite(sk) || sk >= Date.parse(kickoff)) counts.postCutoffRejections += 1;
    }
  }

  const rolesEmpty = identifyGamePlayerRoles(
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
    { identityAsOf: asOf, playerGameRows: [] }
  );
  const roleAuditEmpty = {
    gameId: String(g.id),
    week: g.week,
    mode: "empty-player-games",
    away: {
      QB1: auditPlayerRoleResolution(rolesEmpty.roles.away.QB1),
      RB1: auditPlayerRoleResolution(rolesEmpty.roles.away.RB1),
      WR1: auditPlayerRoleResolution(rolesEmpty.roles.away.WR1),
    },
    home: {
      QB1: auditPlayerRoleResolution(rolesEmpty.roles.home.QB1),
      RB1: auditPlayerRoleResolution(rolesEmpty.roles.home.RB1),
      WR1: auditPlayerRoleResolution(rolesEmpty.roles.home.WR1),
    },
  };
  if (roleExamplesUncertain.length < 8) roleExamplesUncertain.push(roleAuditEmpty);

  const provenance = buildModelInputProvenance({
    game: g,
    featureRecord: record,
    roles: roleAuditEmpty,
    mode,
    priorAudits: { home: homePriorAudit, away: awayPriorAudit },
  });
  if (provenance.provenancePass) counts.provenancePass += 1;
  else counts.provenanceFail += 1;

  const proj = projectCfbFbisV2(
    {
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
    },
    { ablation: "K" }
  );

  const snapshot = {
    game_id: String(g.id),
    season,
    week: g.week,
    kickoff_timestamp: kickoff,
    prediction_cutoff: asOf,
    home_team: record.home_team,
    away_team: record.away_team,
    tags: tagGame(g),
    provenancePass: provenance.provenancePass,
    prior_audit: { home: homePriorAudit, away: awayPriorAudit },
    feature_provenance_summary: {
      passed: provenance.independentFeaturesPassed.length,
      rejected: provenance.featuresRejected.length,
      latestAllowedWeek: provenance.latestAllowedWeek,
    },
    actual_core: {
      homeThroughWeek: record.features.home.coreThroughWeek,
      awayThroughWeek: record.features.away.coreThroughWeek,
      homeYear: record.features.home.coreYear,
      awayYear: record.features.away.coreYear,
    },
    actual_source_weeks: {
      home: record.features.home.actualSourceWeeks,
      away: record.features.away.actualSourceWeeks,
    },
    source_game_ids: {
      home: record.features.home.rollingSourceGameIds,
      away: record.features.away.rollingSourceGameIds,
    },
    targets: {
      home_points: g.homePoints ?? g.home_points ?? null,
      away_points: g.awayPoints ?? g.away_points ?? null,
    },
    shadow_projection: proj.ok
      ? { modelId: CFB_FBIS_V2_ID, home: proj.home, away: proj.away, margin: proj.margin, total: proj.total, canQualify: false }
      : { ok: false, reason: proj.reason },
  };
  snapshots.push(snapshot);
  counts.snapshots += 1;

  if (
    provenanceExamples.length < 12 &&
    (snapshot.tags.includes("week1") || snapshot.tags.includes("fbs-fcs") || used < 4)
  ) {
    provenanceExamples.push({
      gameId: snapshot.game_id,
      matchup: `${snapshot.away_team} @ ${snapshot.home_team}`,
      week: snapshot.week,
      tags: snapshot.tags,
      provenancePass: provenance.provenancePass,
      predictionCutoff: asOf,
      latestAllowedWeek: provenance.latestAllowedWeek,
      priorSeasons: {
        home: homePriorAudit.sourceSeason,
        away: awayPriorAudit.sourceSeason,
        homeOk: homePriorAudit.ok,
        awayOk: awayPriorAudit.ok,
        homeReason: homePriorAudit.exclusionReason,
        awayReason: awayPriorAudit.exclusionReason,
      },
      actualSourceWeeks: snapshot.actual_source_weeks,
      actualCoreThroughWeek: snapshot.actual_core,
      featuresPassedSample: provenance.independentFeaturesPassed.slice(0, 10),
      featuresRejectedSample: provenance.featuresRejected.slice(0, 10),
    });
  }

  used += 1;
}

// Representative player-role reconstruction on a small slice (weeks >= 2 preferred)
const roleCandidates = allGames
  .filter((g) => Number(g.week) >= 2 && (g.startDate || g.start_date))
  .slice(0, Math.max(playerRoleN, 12));

for (const g of roleCandidates) {
  const kickoff = g.startDate || g.start_date;
  const asOf = new Date(Date.parse(kickoff) - 60_000).toISOString();
  const priorOnly = filterPlayerGamesBeforeKickoff(playerGameRowsRaw, kickoff);
  const roles = identifyGamePlayerRoles(
    {
      id: g.id,
      week: g.week,
      season,
      startDate: kickoff,
      homeTeam: g.homeTeam || g.home_team,
      awayTeam: g.awayTeam || g.away_team,
      home: { name: g.homeTeam || g.home_team },
      away: { name: g.awayTeam || g.away_team },
    },
    { identityAsOf: asOf, playerGameRows: priorOnly }
  );

  const enrich = (roleRow, team) => {
    const usedRows = priorOnly.filter((r) => {
      if (schoolKey(r.team) !== schoolKey(team)) return false;
      if (!roleRow.player_name) return false;
      return String(r.name || "").toLowerCase() === String(roleRow.player_name).toLowerCase();
    });
    return auditPlayerRoleResolution(roleRow, { priorGameRows: usedRows, priorStarts: usedRows.length || null });
  };

  const homeTeam = g.homeTeam || g.home_team;
  const awayTeam = g.awayTeam || g.away_team;
  roleExamplesReconstructed.push({
    targetGame: {
      gameId: String(g.id),
      week: g.week,
      kickoff,
      matchup: `${awayTeam} @ ${homeTeam}`,
    },
    away: {
      QB1: enrich(roles.roles.away.QB1, awayTeam),
      RB1: enrich(roles.roles.away.RB1, awayTeam),
      WR1: enrich(roles.roles.away.WR1, awayTeam),
    },
    home: {
      QB1: enrich(roles.roles.home.QB1, homeTeam),
      RB1: enrich(roles.roles.home.RB1, homeTeam),
      WR1: enrich(roles.roles.home.WR1, homeTeam),
    },
  });
}

const rejectedEndpoints = historicallyRejectedEndpointReport();
const smokeEstimate = backfillRequestEstimate({ seasons: [season], smokeWeeks: weeks.length });
const fullEstimate = backfillRequestEstimate({ seasons: [2022, 2023, 2024, 2025], weeksPerSeason: 15 });

const report = {
  ok: true,
  job: "cfb-temporal-smoke-backfill",
  generatedAt: new Date().toISOString(),
  auditVersion: TEMPORAL_AUDIT_VERSION,
  pipelineVersion: PIPELINE_VERSION,
  mode,
  season,
  weeks,
  snapshotCount: counts.snapshots,
  counts: {
    ...counts,
    provenancePassRate: counts.snapshots ? counts.provenancePass / counts.snapshots : null,
    priorPassRate: counts.priorPass + counts.priorFail ? counts.priorPass / (counts.priorPass + counts.priorFail) : null,
  },
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
  },
  rejectedEndpoints,
  requestLog,
  requestEstimates: {
    smoke: smokeEstimate,
    full2022_2025: fullEstimate,
    canonicalEstimate: estimateRequestCount({ seasons: 4, weeks: 15 }),
  },
  playerRoleReconstruction: {
    games: roleExamplesReconstructed.length,
    note: "Only pre-kickoff /games/players rows; no season leaders",
  },
  nextFullBackfillCommands: {
    note: "Only after this hardened smoke provenance audit passes review",
    cli: [
      "export CFBD_API_KEY=***",
      "CFB_BACKFILL_SEASONS=2022,2023,2024,2025 CFB_BACKFILL_MODE=historical node scripts/cfb-feature-backfill.mjs",
    ],
  },
};

assertNoSecretLeak(report, env);
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/cfb-temporal-smoke-report.json", JSON.stringify(report, null, 2));
writeFileSync("artifacts/cfb-temporal-smoke-snapshots.json", JSON.stringify(snapshots, null, 2));
writeFileSync("artifacts/cfb-temporal-smoke-provenance-examples.json", JSON.stringify(provenanceExamples, null, 2));
writeFileSync("artifacts/cfb-temporal-smoke-role-uncertain.json", JSON.stringify(roleExamplesUncertain, null, 2));
writeFileSync("artifacts/cfb-temporal-smoke-role-reconstructed.json", JSON.stringify(roleExamplesReconstructed, null, 2));
writeFileSync("artifacts/cfb-temporal-rejected-endpoints.json", JSON.stringify(rejectedEndpoints, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      season,
      weeks,
      snapshotCount: counts.snapshots,
      provenancePassRate: report.counts.provenancePassRate,
      priorPass: counts.priorPass,
      priorFail: counts.priorFail,
      priorMissing: counts.priorMissing,
      postCutoffRejections: counts.postCutoffRejections,
      coreCutoffRejections: counts.coreCutoffRejections,
      playerRoleExamples: roleExamplesReconstructed.length,
      fitted: false,
      researchReady: false,
    },
    null,
    2
  )
);
