#!/usr/bin/env node
/**
 * Offline CFB pregame feature backfill (GitHub Actions).
 * Strict historical provenance — never invent prior seasons or CORE throughWeek.
 * Reconstructs rolling features from game-level CFBD endpoints.
 *
 * Env:
 *   CFBD_API_KEY (required)
 *   CFB_BACKFILL_SEASONS=2022,2023,2024,2025
 *   CFB_BACKFILL_MAX_GAMES (optional)
 *   CFB_BACKFILL_MODE=historical
 *   CFB_BACKFILL_WEEKS (optional)
 *   CFB_ABLATIONS=A,B,C,D,E,F,G,H,I,J,K
 *   CFB_BACKFILL_PLAYER_ROLES=1 (default) — reconstruct QB1/RB1/WR1 from /games/players
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
import {
  identifyGamePlayerRoles,
  filterPlayerGamesBeforeKickoff,
  flattenGamesPlayersResponse,
} from "../functions/lib/cfbPlayerIdentity.js";
import {
  auditPreseasonPriorSources,
  auditCoreProvenance,
  auditPlayerRoleResolution,
  buildModelInputProvenance,
  TEMPORAL_AUDIT_VERSION,
} from "../functions/lib/cfbTemporalAudit.js";
import { assertNoSecretLeak } from "../functions/lib/collegeSecrets.js";
import { evaluatePromotionEvidence, PROMOTION_CRITERIA } from "../functions/lib/collegeModels.js";
import { SOURCE_VERSION } from "../functions/lib/cfbFeatureStore.js";

const env = { CFBD_API_KEY: process.env.CFBD_API_KEY || "" };
if (!env.CFBD_API_KEY) {
  console.error(JSON.stringify({ ok: false, error: "CFBD_API_KEY missing" }));
  process.exit(2);
}

const seasons = (process.env.CFB_BACKFILL_SEASONS || "2022,2023,2024,2025")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const maxGames = process.env.CFB_BACKFILL_MAX_GAMES ? Number(process.env.CFB_BACKFILL_MAX_GAMES) : null;
const ablations = (process.env.CFB_ABLATIONS || "A,B,C,D,E,F,G,H,I,J,K")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const mode = process.env.CFB_BACKFILL_MODE || "historical";
const weekFilter = process.env.CFB_BACKFILL_WEEKS
  ? process.env.CFB_BACKFILL_WEEKS.split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
  : null;
const doPlayerRoles = process.env.CFB_BACKFILL_PLAYER_ROLES !== "0";

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

function sha256Json(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function sha256File(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

async function fetchAllWeeks(path, season, extraQuery = {}) {
  const rows = [];
  let calls = 0;
  let errors = 0;
  for (let week = 1; week <= 15; week++) {
    if (weekFilter && !weekFilter.includes(week)) continue;
    const res = await cfbdGet(path, env, {
      query: { year: season, week, seasonType: "regular", ...extraQuery },
    });
    calls += 1;
    if (res.ok && Array.isArray(res.data)) {
      for (const r of res.data) rows.push({ ...r, week, startDate: r.startDate || r.start_date || null });
    } else if (!res.ok) {
      errors += 1;
    }
    await sleep(120);
  }
  return { rows, calls, errors };
}

function attachKickoffs(rows, games) {
  const byId = new Map();
  for (const g of games || []) byId.set(String(g.id), g.startDate || g.start_date);
  return (rows || []).map((r) => ({
    ...r,
    startDate: r.startDate || byId.get(String(r.gameId || r.game_id || r.id)) || null,
    gameId: r.gameId || r.game_id || r.id || null,
  }));
}

function normalizePlayerGameRow(r, gamesById) {
  const gid = String(r.gameId || r.game_id || "");
  return {
    ...r,
    gameId: gid || null,
    team: r.team || r.school || null,
    name: r.name || r.player || r.athleteName || null,
    position: r.position || r.pos || null,
    startDate: r.startDate || r.start_date || gamesById.get(gid) || null,
    passingAttempts: r.passingAttempts ?? r.passAttempts ?? null,
    passingYards: r.passingYards ?? r.passYards ?? null,
    rushingAttempts: r.rushingAttempts ?? r.carries ?? null,
    rushingYards: r.rushingYards ?? null,
    receptions: r.receptions ?? null,
    receivingYards: r.receivingYards ?? null,
    targets: r.targets ?? r.receivingTargets ?? null,
    week: r.week ?? null,
  };
}

function flattenPlayerGameFeeds(nestedFeeds, gamesById, seasonYear) {
  const merged = new Map();
  for (const feed of nestedFeeds) {
    const flat = flattenGamesPlayersResponse(feed.rows || [], {
      gamesById,
      week: null,
      season: seasonYear,
    }).map((r) => normalizePlayerGameRow(r, gamesById));
    for (const row of flat) {
      const key = `${row.gameId || ""}::${row.athleteId || row.name || ""}::${schoolKey(row.team)}`;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, row);
        continue;
      }
      merged.set(key, {
        ...prev,
        ...Object.fromEntries(Object.entries(row).filter(([, v]) => v != null)),
        position:
          prev.passingAttempts != null || row.passingAttempts != null
            ? "QB"
            : prev.receptions != null || row.receptions != null
              ? "WR"
              : prev.rushingAttempts != null || row.rushingAttempts != null
                ? "RB"
                : prev.position || row.position || null,
      });
    }
  }
  return [...merged.values()];
}

function metricsFor(preds) {
  const n = preds.length;
  if (!n) {
    return {
      n: 0,
      maeTotal: null,
      maeMargin: null,
      maeHome: null,
      maeAway: null,
      maeTeam: null,
      rmseMargin: null,
      biasMargin: null,
      brier: null,
      logLoss: null,
    };
  }
  let absT = 0;
  let absM = 0;
  let absH = 0;
  let absA = 0;
  let sqM = 0;
  let biasM = 0;
  let brier = 0;
  let logLoss = 0;
  for (const p of preds) {
    const eh = p.home - p.actualHome;
    const ea = p.away - p.actualAway;
    const em = p.margin - (p.actualHome - p.actualAway);
    const et = p.total - (p.actualHome + p.actualAway);
    absH += Math.abs(eh);
    absA += Math.abs(ea);
    absM += Math.abs(em);
    absT += Math.abs(et);
    sqM += em * em;
    biasM += em;
    const y = p.actualHome > p.actualAway ? 1 : 0;
    const pr = Math.max(0.001, Math.min(0.999, p.pHomeWin ?? (p.margin > 0 ? 0.55 : 0.45)));
    brier += (pr - y) ** 2;
    logLoss += -(y * Math.log(pr) + (1 - y) * Math.log(1 - pr));
  }
  return {
    n,
    maeTotal: absT / n,
    maeMargin: absM / n,
    maeHome: absH / n,
    maeAway: absA / n,
    maeTeam: (absH + absA) / (2 * n),
    rmseMargin: Math.sqrt(sqM / n),
    biasMargin: biasM / n,
    brier: brier / n,
    logLoss: logLoss / n,
  };
}

function bump(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

const requestLog = [];
const featureRecords = [];
const snapshotSummaries = [];
const predictionsByAblation = Object.fromEntries(ablations.map((a) => [a, []]));
const foldReports = [];
const roleConfidence = {
  QB1: { LOW: 0, MEDIUM: 0, HIGH: 0 },
  RB1: { LOW: 0, MEDIUM: 0, HIGH: 0 },
  WR1: { LOW: 0, MEDIUM: 0, HIGH: 0 },
};
const roleResolved = { QB1: 0, RB1: 0, WR1: 0, totalSlots: 0 };
const rejectionReasons = {};
const missingnessByFamily = {
  priorOff: 0,
  priorDef: 0,
  rollingPassEpa: 0,
  rollingRushEpa: 0,
  rollingSuccess: 0,
  core: 0,
  qb: 0,
  weather: 0,
};
const coreAvailability = {};
const counts = {
  gamesSeen: 0,
  snapshots: 0,
  skippedNoKickoff: 0,
  skippedTemporalGate: 0,
  provenancePass: 0,
  provenanceFail: 0,
  priorPass: 0,
  priorFail: 0,
  priorMissing: 0,
  postCutoffRejections: 0,
  coreCutoffRejections: 0,
  corePresentOk: 0,
  coreAbsent: 0,
  acceptedTemporalViolations: 0,
  requestErrors: 0,
};
const bySeason = {};

console.error(
  JSON.stringify({
    phase: "start",
    seasons,
    mode,
    ablations,
    auditVersion: TEMPORAL_AUDIT_VERSION,
    doPlayerRoles,
  })
);

let priorBundle = null;
for (const season of seasons) {
  bySeason[season] = {
    games: 0,
    snapshots: 0,
    provenancePass: 0,
    provenanceFail: 0,
    priorPass: 0,
    priorFail: 0,
    corePresentOk: 0,
    coreAbsent: 0,
    coreInvalid: 0,
  };
  const priorSeason = season - 1;
  if (!priorBundle || priorBundle.season !== priorSeason) {
    priorBundle = await fetchSeasonFeatureBundle(env, priorSeason, { week: null });
    requestLog.push({ kind: "prior-bundle", season: priorSeason });
  }
  const priorCatalog = buildPriorCatalog(priorBundle);
  const confMap = buildFcsConferenceStrength(priorCatalog);

  const seasonBundle = await fetchSeasonFeatureBundle(env, season, { week: null });
  requestLog.push({ kind: "season-bundle", season });

  const coreRes = await cfbdGet("/ratings/core", env, { query: { year: season } });
  requestLog.push({ kind: "core-season", season, ok: coreRes.ok, n: (coreRes.data || []).length });
  if (!coreRes.ok) counts.requestErrors += 1;
  await sleep(100);

  const allSeasonGames = seasonBundle.endpoints.games.data || [];
  const gamesById = new Map(allSeasonGames.map((g) => [String(g.id), g.startDate || g.start_date]));
  const games = allSeasonGames.filter((g) => {
    const scored =
      (g.homePoints ?? g.home_points ?? g.homeScore) != null &&
      (g.awayPoints ?? g.away_points ?? g.awayScore) != null;
    if (!scored) return false;
    if (weekFilter && !weekFilter.includes(Number(g.week))) return false;
    return true;
  });
  bySeason[season].games = games.length;
  counts.gamesSeen += games.length;

  console.error(JSON.stringify({ phase: "fetch-rolling", season, games: games.length, mode }));
  const ppaFetch = await fetchAllWeeks("/ppa/games", season);
  const advFetch = await fetchAllWeeks("/stats/game/advanced", season);
  counts.requestErrors += ppaFetch.errors + advFetch.errors;
  const ppaRows = attachKickoffs(ppaFetch.rows, allSeasonGames);
  const advRows = attachKickoffs(advFetch.rows, allSeasonGames);
  requestLog.push({
    kind: "ppa-games-weeks",
    season,
    rows: ppaRows.length,
    calls: ppaFetch.calls,
    errors: ppaFetch.errors,
  });
  requestLog.push({
    kind: "adv-games-weeks",
    season,
    rows: advRows.length,
    calls: advFetch.calls,
    errors: advFetch.errors,
  });

  let playerGameRows = [];
  if (doPlayerRoles) {
    const pass = await fetchAllWeeks("/games/players", season, { category: "passing" });
    const rush = await fetchAllWeeks("/games/players", season, { category: "rushing" });
    const recv = await fetchAllWeeks("/games/players", season, { category: "receiving" });
    counts.requestErrors += pass.errors + rush.errors + recv.errors;
    playerGameRows = flattenPlayerGameFeeds([pass, rush, recv], gamesById, season);
    requestLog.push({
      kind: "games-players",
      season,
      flatRows: playerGameRows.length,
      calls: pass.calls + rush.calls + recv.calls,
      errors: pass.errors + rush.errors + recv.errors,
    });
  }

  const qbRows = mode === "historical" ? [] : seasonBundle.endpoints.qbPpa?.data || [];
  const usageRows = mode === "historical" ? [] : seasonBundle.endpoints.usage?.data || [];

  let used = 0;
  for (const g of games) {
    if (maxGames != null && featureRecords.length >= maxGames) break;
    const kickoff = g.startDate || g.start_date;
    if (!kickoff) {
      counts.skippedNoKickoff += 1;
      bump(rejectionReasons, "missing-kickoff");
      continue;
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
      qbRows,
      usageRows,
      playerGameRows,
      coreByTeam,
      collectionTimestamp: asOf,
      mode,
    });
    if (!record.temporalOk) {
      counts.skippedTemporalGate += 1;
      bump(rejectionReasons, "temporal-gate-fail");
      continue;
    }

    const homeKey = schoolKey(record.home_team);
    const awayKey = schoolKey(record.away_team);
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
    for (const a of [homePriorAudit, awayPriorAudit]) {
      if (a.ok) {
        counts.priorPass += 1;
        bySeason[season].priorPass += 1;
      } else {
        counts.priorFail += 1;
        bySeason[season].priorFail += 1;
        bump(rejectionReasons, `prior:${a.exclusionReason || "fail"}`);
        if (a.exclusionReason === "missing-source-provenance") counts.priorMissing += 1;
      }
    }

    for (const side of ["home", "away"]) {
      const feat = record.features[side];
      const coreAudit = auditCoreProvenance({
        coreRow: feat.coreRow,
        targetWeek: g.week,
        targetKickoffTimestamp: kickoff,
      });
      const weekKey = String(g.week);
      coreAvailability[season] = coreAvailability[season] || {};
      coreAvailability[season][weekKey] = coreAvailability[season][weekKey] || {
        present: 0,
        valid: 0,
        invalid: 0,
        absent: 0,
      };
      if (feat.coreThroughWeek != null || feat.coreRating != null) {
        coreAvailability[season][weekKey].present += 1;
        if (coreAudit.ok) {
          counts.corePresentOk += 1;
          bySeason[season].corePresentOk += 1;
          coreAvailability[season][weekKey].valid += 1;
        } else {
          counts.coreCutoffRejections += 1;
          bySeason[season].coreInvalid += 1;
          coreAvailability[season][weekKey].invalid += 1;
          bump(rejectionReasons, `core:${coreAudit.exclusionReason || "fail"}`);
        }
      } else {
        counts.coreAbsent += 1;
        bySeason[season].coreAbsent += 1;
        coreAvailability[season][weekKey].absent += 1;
      }

      for (const obs of feat.sourceObservations || []) {
        const sk = Date.parse(obs.sourceKickoffTimestamp || "");
        if (!Number.isFinite(sk) || sk >= Date.parse(kickoff)) {
          counts.postCutoffRejections += 1;
          bump(rejectionReasons, "post-cutoff-source-observation");
        }
      }

      if (feat.priorOff == null) missingnessByFamily.priorOff += 1;
      if (feat.priorDef == null) missingnessByFamily.priorDef += 1;
      if (feat.passEpa == null) missingnessByFamily.rollingPassEpa += 1;
      if (feat.rushEpa == null) missingnessByFamily.rollingRushEpa += 1;
      if (feat.successRate == null) missingnessByFamily.rollingSuccess += 1;
      if (feat.coreThroughWeek == null && feat.coreRating == null) missingnessByFamily.core += 1;
      if (feat.qbPpa == null) missingnessByFamily.qb += 1;
      if (feat.temperature == null) missingnessByFamily.weather += 1;
    }

    let roleBundle = null;
    if (doPlayerRoles) {
      const priorOnly = filterPlayerGamesBeforeKickoff(playerGameRows, kickoff);
      roleBundle = identifyGamePlayerRoles(
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
        { identityAsOf: asOf, playerGameRows: priorOnly }
      );
      for (const side of ["home", "away"]) {
        for (const role of ["QB1", "RB1", "WR1"]) {
          roleResolved.totalSlots += 1;
          const row = roleBundle.roles[side][role];
          const audited = auditPlayerRoleResolution(row);
          const tier = audited.roleConfidenceTierAssigned || "LOW";
          roleConfidence[role][tier] = (roleConfidence[role][tier] || 0) + 1;
          if (audited.player) roleResolved[role] += 1;
        }
      }
    }

    const provenance = buildModelInputProvenance({
      game: g,
      featureRecord: record,
      roles: roleBundle
        ? {
            home: {
              QB1: auditPlayerRoleResolution(roleBundle.roles.home.QB1),
              RB1: auditPlayerRoleResolution(roleBundle.roles.home.RB1),
              WR1: auditPlayerRoleResolution(roleBundle.roles.home.WR1),
            },
            away: {
              QB1: auditPlayerRoleResolution(roleBundle.roles.away.QB1),
              RB1: auditPlayerRoleResolution(roleBundle.roles.away.RB1),
              WR1: auditPlayerRoleResolution(roleBundle.roles.away.WR1),
            },
          }
        : null,
      mode,
      priorAudits: { home: homePriorAudit, away: awayPriorAudit },
    });
    if (provenance.provenancePass) {
      counts.provenancePass += 1;
      bySeason[season].provenancePass += 1;
    } else {
      counts.provenanceFail += 1;
      bySeason[season].provenanceFail += 1;
      for (const r of provenance.featuresRejected || []) {
        if (
          r.exclusionReason &&
          r.exclusionReason !== "missing-value" &&
          r.exclusionReason !== "evaluation-only"
        ) {
          bump(rejectionReasons, `feature:${r.exclusionReason}`);
        }
      }
    }

    if (
      !provenance.provenancePass &&
      (record.features.home.sourceObservations || []).some(
        (o) => Date.parse(o.sourceKickoffTimestamp || "") >= Date.parse(kickoff)
      )
    ) {
      counts.acceptedTemporalViolations += 1;
    }

    featureRecords.push(record);
    snapshotSummaries.push({
      game_id: String(g.id),
      season,
      week: g.week,
      kickoff_timestamp: kickoff,
      prediction_cutoff: asOf,
      home_team: record.home_team,
      away_team: record.away_team,
      provenancePass: provenance.provenancePass,
      priorOk: { home: homePriorAudit.ok, away: awayPriorAudit.ok },
      coreThroughWeek: {
        home: record.features.home.coreThroughWeek,
        away: record.features.away.coreThroughWeek,
      },
      actualSourceWeeks: {
        home: record.features.home.actualSourceWeeks,
        away: record.features.away.actualSourceWeeks,
      },
      missingness: {
        home: record.features.home.missingness,
        away: record.features.away.missingness,
      },
      roles:
        roleBundle == null
          ? null
          : {
              home: {
                QB1: roleBundle.roles.home.QB1.player_name,
                RB1: roleBundle.roles.home.RB1.player_name,
                WR1: roleBundle.roles.home.WR1.player_name,
              },
              away: {
                QB1: roleBundle.roles.away.QB1.player_name,
                RB1: roleBundle.roles.away.RB1.player_name,
                WR1: roleBundle.roles.away.WR1.player_name,
              },
            },
    });
    counts.snapshots += 1;
    bySeason[season].snapshots += 1;
    used += 1;

    const gameInput = {
      sport: "cfb",
      home: { name: record.home_team },
      away: { name: record.away_team },
      neutralSite: Boolean(record.features.neutralSite),
      featureCutoffOk: true,
      cfbFbisV2Input: {
        home: {
          ...record.features.home,
          qbPpa: record.features.home?.qbHistoricalUnsafe ? null : record.features.home?.qbPpa,
        },
        away: {
          ...record.features.away,
          qbPpa: record.features.away?.qbHistoricalUnsafe ? null : record.features.away?.qbPpa,
        },
        neutralSite: record.features.neutralSite,
      },
    };
    for (const ablation of ablations) {
      const proj = projectCfbFbisV2(gameInput, { ablation });
      if (!proj.ok) continue;
      predictionsByAblation[ablation].push({
        season,
        week: g.week,
        gameId: String(g.id),
        frozenAt: asOf,
        provenancePass: provenance.provenancePass,
        home: proj.home,
        away: proj.away,
        margin: proj.margin,
        total: proj.total,
        pHomeWin: proj.pHomeWin,
        actualHome: Number(g.homePoints ?? g.home_points ?? g.homeScore),
        actualAway: Number(g.awayPoints ?? g.away_points ?? g.awayScore),
        ablation,
        modelId: CFB_FBIS_V2_ID,
        closingSpread: record.features.evaluation?.closingSpread ?? null,
        closingTotal: record.features.evaluation?.closingTotal ?? null,
      });
    }
  }
  console.error(
    JSON.stringify({
      phase: "season-done",
      season,
      featureRows: used,
      provenancePass: bySeason[season].provenancePass,
    })
  );
}

const seasonList = [...new Set(featureRecords.map((r) => r.season))].sort((a, b) => a - b);
for (let i = 1; i < seasonList.length; i++) {
  const trainSeasons = seasonList.slice(0, i);
  const valSeason = seasonList[i];
  for (const ablation of ablations) {
    const train = predictionsByAblation[ablation].filter((p) => trainSeasons.includes(p.season));
    const validate = predictionsByAblation[ablation].filter((p) => p.season === valSeason);
    const validateEligible = validate.filter((p) => p.provenancePass);
    foldReports.push({
      fold_id: `fold-${trainSeasons.join("_")}-val-${valSeason}-${ablation}`,
      train_start: trainSeasons[0],
      train_end: trainSeasons.at(-1),
      validation_start: valSeason,
      validation_end: valSeason,
      feature_set: ablation,
      trainN: train.length,
      validateN: validate.length,
      validateEligibleN: validateEligible.length,
      metrics: metricsFor(validate),
      metricsEligibleOnly: metricsFor(validateEligible),
    });
  }
}

const fullMetrics = Object.fromEntries(ablations.map((a) => [a, metricsFor(predictionsByAblation[a])]));
const eligibleMetrics = Object.fromEntries(
  ablations.map((a) => [a, metricsFor(predictionsByAblation[a].filter((p) => p.provenancePass))])
);

const bestAblation =
  ablations
    .map((a) => ({ ablation: a, metrics: eligibleMetrics[a], metricsAll: fullMetrics[a] }))
    .filter((r) => r.metrics.n > 0)
    .sort((a, b) => (a.metrics.maeTotal ?? 99) - (b.metrics.maeTotal ?? 99))[0] || null;

const bestAllRows =
  ablations
    .map((a) => ({ ablation: a, metrics: fullMetrics[a] }))
    .filter((r) => r.metrics.n > 0)
    .sort((a, b) => (a.metrics.maeTotal ?? 99) - (b.metrics.maeTotal ?? 99))[0] || null;

const promotion = evaluatePromotionEvidence({
  n: bestAblation?.metrics?.n || 0,
  seasons: seasonList.length,
  maeImprovement: null,
  biasAbs: Math.abs(bestAblation?.metrics?.biasMargin ?? 99),
  brierDegradation: null,
  coverage: featureRecords.length ? counts.provenancePass / featureRecords.length : 0,
  leakageOk: counts.acceptedTemporalViolations === 0 && counts.postCutoffRejections === 0,
  operatorApproved: false,
  artifactOk: true,
});

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  pipelineVersion: PIPELINE_VERSION,
  auditVersion: TEMPORAL_AUDIT_VERSION,
  sourceVersion: SOURCE_VERSION,
  modelId: CFB_FBIS_V2_ID,
  mode,
  weekFilter,
  seasons,
  strictProvenance: true,
  featureRowCount: featureRecords.length,
  counts: {
    ...counts,
    provenancePassRate: counts.snapshots ? counts.provenancePass / counts.snapshots : null,
    priorPassRate:
      counts.priorPass + counts.priorFail ? counts.priorPass / (counts.priorPass + counts.priorFail) : null,
  },
  bySeason,
  rejectionReasons,
  missingnessByFamily,
  coreAvailability,
  playerRoles: {
    confidenceDistribution: roleConfidence,
    resolved: roleResolved,
    usableSampleSizes: {
      QB1: roleResolved.QB1,
      RB1: roleResolved.RB1,
      WR1: roleResolved.WR1,
      note: "Count of role slots with a selected player from pre-kickoff /games/players only",
    },
  },
  predictionCounts: Object.fromEntries(ablations.map((a) => [a, predictionsByAblation[a].length])),
  fullMetrics,
  eligibleMetrics,
  bestAblationEligible: bestAblation,
  bestAblationAllRows: bestAllRows,
  folds: foldReports,
  rollingOriginSummary: {
    method: "rolling-origin-by-season",
    folds: foldReports.filter((f) => f.feature_set === (bestAblation?.ablation || "K")),
    note: "Primary ranking uses provenance-eligible rows only; all-rows metrics retained for comparison",
  },
  promotion: { ...promotion, criteria: PROMOTION_CRITERIA, promote: false },
  requestLog,
  requestSummary: {
    entries: requestLog.length,
    errors: counts.requestErrors,
    approxCalls: requestLog.reduce((a, r) => a + (r.calls || 1), 0),
  },
  leakage: {
    rule: "Fail-closed priors; actual source kickoffs; actual CORE throughWeek; historical season aggregates rejected; no invented eligibility",
    postCutoffRejections: counts.postCutoffRejections,
    acceptedTemporalViolations: counts.acceptedTemporalViolations,
    historicalSeasonAggregatesRejected: mode === "historical",
  },
  canQualify: false,
  fitted: false,
  researchReady: false,
  promotionReady: false,
  championUntouched: true,
  governance: {
    "CFB-FBIS-v2": { canQualify: false },
    "CFB-PLAYER-v1": { canQualify: false },
  },
};

assertNoSecretLeak(report, env);
mkdirSync("artifacts", { recursive: true });
mkdirSync("data/cfbd/backfills", { recursive: true });

writeFileSync("artifacts/cfb-fbis-v2-backfill-report.json", JSON.stringify(report, null, 2));
writeFileSync(
  "artifacts/cfb-fbis-v2-feature-sample.json",
  JSON.stringify(featureRecords.slice(0, 25), null, 2)
);
writeFileSync("artifacts/cfb-fbis-v2-snapshot-summaries.json", JSON.stringify(snapshotSummaries, null, 2));
writeFileSync(
  "artifacts/cfb-fbis-v2-predictions-sample.json",
  JSON.stringify(Object.fromEntries(ablations.map((a) => [a, predictionsByAblation[a].slice(0, 40)])), null, 2)
);
writeFileSync("artifacts/cfb-fbis-v2-predictions-all.json", JSON.stringify(predictionsByAblation));
writeFileSync("artifacts/cfb-fbis-v2-folds.json", JSON.stringify(foldReports, null, 2));

const hashes = {
  report: sha256File("artifacts/cfb-fbis-v2-backfill-report.json"),
  snapshots: sha256File("artifacts/cfb-fbis-v2-snapshot-summaries.json"),
  predictions: sha256File("artifacts/cfb-fbis-v2-predictions-all.json"),
  folds: sha256File("artifacts/cfb-fbis-v2-folds.json"),
  reportBody: sha256Json({
    seasons: report.seasons,
    counts: report.counts,
    bySeason: report.bySeason,
    bestAblationEligible: report.bestAblationEligible,
    eligibleMetrics: report.eligibleMetrics,
  }),
};
report.artifactHashes = hashes;
writeFileSync("artifacts/cfb-fbis-v2-backfill-report.json", JSON.stringify(report, null, 2));
writeFileSync("artifacts/cfb-fbis-v2-backfill-hashes.json", JSON.stringify(hashes, null, 2));

writeFileSync(
  "data/cfbd/backfills/2022-2025-historical-summary.json",
  JSON.stringify(
    {
      generatedAt: report.generatedAt,
      auditVersion: report.auditVersion,
      pipelineVersion: report.pipelineVersion,
      seasons: report.seasons,
      counts: report.counts,
      bySeason: report.bySeason,
      rejectionReasons: report.rejectionReasons,
      missingnessByFamily: report.missingnessByFamily,
      coreAvailability: report.coreAvailability,
      playerRoles: report.playerRoles,
      eligibleMetrics: report.eligibleMetrics,
      bestAblationEligible: report.bestAblationEligible,
      rollingOriginSummary: {
        method: report.rollingOriginSummary.method,
        foldCount: foldReports.length,
        bestAblation: bestAblation?.ablation || null,
      },
      artifactHashes: hashes,
      canQualify: false,
      fitted: false,
      researchReady: false,
      promotionReady: false,
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      ok: true,
      featureRowCount: report.featureRowCount,
      snapshots: counts.snapshots,
      provenancePassRate: report.counts.provenancePassRate,
      priorPass: counts.priorPass,
      priorFail: counts.priorFail,
      postCutoffRejections: counts.postCutoffRejections,
      acceptedTemporalViolations: counts.acceptedTemporalViolations,
      bestAblationEligible: bestAblation?.ablation || null,
      maeTotalEligible: bestAblation?.metrics?.maeTotal ?? null,
      requestErrors: counts.requestErrors,
      hashes,
      promote: false,
      artifact: "artifacts/cfb-fbis-v2-backfill-report.json",
    },
    null,
    2
  )
);
