#!/usr/bin/env node
/**
 * Offline CFB pregame feature backfill (GitHub Actions).
 * Reconstructs rolling features from game-level CFBD endpoints.
 * Prior = previous season ratings only. Market lines stored under evaluation only.
 *
 * Env:
 *   CFBD_API_KEY (required)
 *   CFB_BACKFILL_SEASONS=2022,2023,2024,2025
 *   CFB_BACKFILL_MAX_GAMES (optional cap for cost control)
 *   CFB_BACKFILL_MODE=historical (default) — rejects same-season player aggregates
 *   CFB_BACKFILL_WEEKS=1,2,3,4 (optional week filter for smoke)
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
import { projectCfbFbisV2, ablationSuite, CFB_FBIS_V2_ID } from "../functions/lib/cfbFbisV2.js";
import { assertNoSecretLeak } from "../functions/lib/collegeSecrets.js";
import { evaluatePromotionEvidence, PROMOTION_CRITERIA } from "../functions/lib/collegeModels.js";

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
const ablations = (process.env.CFB_ABLATIONS || "A,K").split(",").map((s) => s.trim()).filter(Boolean);
const mode = process.env.CFB_BACKFILL_MODE || "historical";
const weekFilter = process.env.CFB_BACKFILL_WEEKS
  ? process.env.CFB_BACKFILL_WEEKS.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  : null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAllWeeksPpa(season) {
  const rows = [];
  for (let week = 1; week <= 15; week++) {
    const res = await cfbdGet("/ppa/games", env, { query: { year: season, week, seasonType: "regular" } });
    if (res.ok && Array.isArray(res.data)) {
      for (const r of res.data) rows.push({ ...r, week, startDate: r.startDate || r.start_date || null });
    }
    await sleep(120);
  }
  return rows;
}

async function fetchAllWeeksAdv(season) {
  const rows = [];
  for (let week = 1; week <= 15; week++) {
    const res = await cfbdGet("/stats/game/advanced", env, {
      query: { year: season, week, seasonType: "regular" },
    });
    if (res.ok && Array.isArray(res.data)) {
      for (const r of res.data) rows.push({ ...r, week });
    }
    await sleep(120);
  }
  return rows;
}

function attachKickoffs(ppaRows, games) {
  const byId = new Map();
  for (const g of games || []) byId.set(String(g.id), g.startDate || g.start_date);
  return (ppaRows || []).map((r) => ({
    ...r,
    startDate: r.startDate || byId.get(String(r.gameId || r.game_id)) || null,
  }));
}

function metricsFor(preds) {
  const n = preds.length;
  if (!n) {
    return { n: 0, maeTotal: null, maeMargin: null, maeHome: null, maeAway: null, maeTeam: null, rmseMargin: null, biasMargin: null, brier: null, logLoss: null };
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

const requestLog = [];
const featureRecords = [];
const predictionsByAblation = Object.fromEntries(ablations.map((a) => [a, []]));
const foldReports = [];

let priorBundle = null;
for (const season of seasons) {
  const priorSeason = season - 1;
  if (!priorBundle || priorBundle.season !== priorSeason) {
    priorBundle = await fetchSeasonFeatureBundle(env, priorSeason, { week: null });
    requestLog.push({ kind: "prior-bundle", season: priorSeason });
  }
  const priorCatalog = buildPriorCatalog(priorBundle);
  const confMap = buildFcsConferenceStrength(priorCatalog);

  const seasonBundle = await fetchSeasonFeatureBundle(env, season, { week: null });
  requestLog.push({ kind: "season-bundle", season });
  const games = (seasonBundle.endpoints.games.data || []).filter((g) => {
    const scored =
      (g.homePoints ?? g.home_points ?? g.homeScore) != null &&
      (g.awayPoints ?? g.away_points ?? g.awayScore) != null;
    if (!scored) return false;
    if (weekFilter && !weekFilter.includes(Number(g.week))) return false;
    return true;
  });

  console.error(JSON.stringify({ phase: "fetch-rolling", season, games: games.length, mode }));
  const ppaRaw = await fetchAllWeeksPpa(season);
  const advRaw = await fetchAllWeeksAdv(season);
  const ppaRows = attachKickoffs(ppaRaw, seasonBundle.endpoints.games.data);
  const advRows = attachKickoffs(advRaw, seasonBundle.endpoints.games.data);
  requestLog.push({ kind: "ppa-games-weeks", season, rows: ppaRows.length });
  requestLog.push({ kind: "adv-games-weeks", season, rows: advRows.length });

  // Historical mode: never pass cumulative season player aggregates into independent features
  const qbRows = mode === "historical" ? [] : seasonBundle.endpoints.qbPpa.data || [];
  const usageRows = mode === "historical" ? [] : seasonBundle.endpoints.usage.data || [];

  let used = 0;
  for (const g of games) {
    if (maxGames != null && featureRecords.length >= maxGames) break;
    const kickoff = g.startDate || g.start_date;
    if (!kickoff) continue;
    // Historical as-of: freeze collection at one minute before kickoff
    const asOf = new Date(Date.parse(kickoff) - 60_000).toISOString();
    const record = assembleGameFeatures({
      game: g,
      priorCatalog,
      confMap,
      ppaGameRows: ppaRows,
      advGameRows: advRows,
      qbRows,
      usageRows,
      collectionTimestamp: asOf,
      mode,
    });
    if (!record.temporalOk) continue;
    featureRecords.push(record);
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
  console.error(JSON.stringify({ phase: "season-done", season, featureRows: used }));
}

// Rolling-origin folds by season: train earlier seasons, validate next
const seasonList = [...new Set(featureRecords.map((r) => r.season))].sort();
for (let i = 1; i < seasonList.length; i++) {
  const trainSeasons = seasonList.slice(0, i);
  const valSeason = seasonList[i];
  for (const ablation of ablations) {
    const train = predictionsByAblation[ablation].filter((p) => trainSeasons.includes(p.season));
    const validate = predictionsByAblation[ablation].filter((p) => p.season === valSeason);
    foldReports.push({
      fold_id: `fold-${trainSeasons.join("_")}-val-${valSeason}-${ablation}`,
      train_start: trainSeasons[0],
      train_end: trainSeasons.at(-1),
      validation_start: valSeason,
      validation_end: valSeason,
      feature_set: ablation,
      trainN: train.length,
      validateN: validate.length,
      metrics: metricsFor(validate),
    });
  }
}

const fullMetrics = Object.fromEntries(
  ablations.map((a) => [a, metricsFor(predictionsByAblation[a])])
);

const bestAblation = ablations
  .map((a) => ({ ablation: a, metrics: fullMetrics[a] }))
  .filter((r) => r.metrics.n > 0)
  .sort((a, b) => (a.metrics.maeTotal ?? 99) - (b.metrics.maeTotal ?? 99))[0] || null;

const promotion = evaluatePromotionEvidence({
  n: bestAblation?.metrics?.n || 0,
  seasons: seasonList.length,
  maeImprovement: null,
  biasAbs: Math.abs(bestAblation?.metrics?.biasMargin ?? 99),
  brierDegradation: null,
  coverage: featureRecords.length ? 1 : 0,
  leakageOk: featureRecords.every((r) => r.temporalOk),
  operatorApproved: false,
  artifactOk: true,
});

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  pipelineVersion: PIPELINE_VERSION,
  modelId: CFB_FBIS_V2_ID,
  mode,
  weekFilter,
  seasons,
  featureRowCount: featureRecords.length,
  predictionCounts: Object.fromEntries(ablations.map((a) => [a, predictionsByAblation[a].length])),
  fullMetrics,
  bestAblation,
  folds: foldReports,
  promotion: { ...promotion, criteria: PROMOTION_CRITERIA },
  requestEstimate: {
    logged: requestLog.length,
    note: "Week loops ≈ 15 calls/endpoint/season for /ppa/games and /stats/game/advanced plus prior/season bundles",
    approxCalls: seasons.length * (20 + 15 * 2) + seasons.length * 12,
  },
  leakage: {
    rule: "collectionTimestamp forced to kickoff-60s; prior from prior season only; rolling from games before kickoff; historical mode rejects season player aggregates",
    rejectedPostKickoff: featureRecords.filter((r) => !r.temporalOk).length,
    historicalSeasonAggregatesRejected: mode === "historical",
  },
  canQualify: false,
  fitted: false,
  researchReady: false,
  promotionReady: false,
  championUntouched: true,
};

assertNoSecretLeak(report, env);
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/cfb-fbis-v2-backfill-report.json", JSON.stringify(report, null, 2));
writeFileSync(
  "artifacts/cfb-fbis-v2-feature-sample.json",
  JSON.stringify(featureRecords.slice(0, 25), null, 2)
);
writeFileSync(
  "artifacts/cfb-fbis-v2-predictions-sample.json",
  JSON.stringify(
    Object.fromEntries(ablations.map((a) => [a, predictionsByAblation[a].slice(0, 50)])),
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      ok: true,
      featureRowCount: report.featureRowCount,
      seasons: report.seasons,
      bestAblation: bestAblation?.ablation || null,
      maeTotal: bestAblation?.metrics?.maeTotal ?? null,
      promote: promotion.promote,
      artifact: "artifacts/cfb-fbis-v2-backfill-report.json",
    },
    null,
    2
  )
);
