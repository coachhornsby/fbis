#!/usr/bin/env node
/**
 * CFB-FBIS-v2 FINAL model-selection (post talent-catalog repair).
 *
 * Fits margin and total architectures independently (no global winner by margin MAE).
 * Uses repaired design rows. canQualify / wager auth remain false. No promotion.
 *
 * Env:
 *   CFB_FINAL_SKIP_REBUILD=1 (default) — reuse artifacts/cfb-fbis-v2-design-rows.jsonl
 *   CFB_CALIBRATE_SEASONS=2022,2023,2024,2025
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { cfbdGet } from "../functions/lib/collegeApi.js";
import {
  fetchSeasonFeatureBundle,
  buildPriorCatalog,
  buildFcsConferenceStrength,
  assembleGameFeatures,
} from "../functions/lib/cfbFeaturePipeline.js";
import { indexCoreByTeam } from "../functions/lib/cfbdCanonical.js";
import { projectCfbFbisV2 } from "../functions/lib/cfbFbisV2.js";
import {
  ABLATION_FEATURE_SETS,
  TOTAL_FEATURE_SETS,
  fitRidge,
  predictRidge,
  tuneRidgeLambda,
  pairedBlockBootstrap,
  rowToMarginX,
  rowToTotalX,
  scoreMetrics,
  mean,
  variance,
  pHomeWinFromMargin,
} from "../functions/lib/cfbFbisV2Fit.js";

const DESIGN_PATH = "artifacts/cfb-fbis-v2-design-rows.jsonl";
const SNAPSHOT_PATH = "artifacts/cfb-fbis-v2-snapshot-summaries.json";
const CACHE_DIR = "artifacts/cfbd-http-cache";

const seasons = (process.env.CFB_CALIBRATE_SEASONS || "2022,2023,2024,2025")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Number.isFinite);
const skipFetch = process.env.CFB_FINAL_SKIP_REBUILD !== "0";
const forceRebuild = process.env.CFB_FINAL_FORCE_REBUILD === "1";
const env = { CFBD_API_KEY: process.env.CFBD_API_KEY || "" };

const FOLDS = [
  { id: "fold1", trainSeasons: [2022], testSeason: 2023 },
  { id: "fold2", trainSeasons: [2022, 2023], testSeason: 2024 },
  { id: "fold3", trainSeasons: [2022, 2023, 2024], testSeason: 2025 },
];

const MARGIN_KEYS = [
  "base",
  "pass",
  "rush",
  "success",
  "explosiveness",
  "havoc",
  "trenches",
  "finishing",
  "qb",
  "pace",
  "context",
];

const ADDED_VS_PREVIOUS = {
  A: ["base"],
  B: ["pass", "rush"],
  C: ["success"],
  D: ["explosiveness"],
  E: ["havoc"],
  F: ["trenches"],
  G: ["finishing"],
  H: ["qb"],
  I: ["pace"],
  J: ["context"],
  K: [],
};

mkdirSync("artifacts", { recursive: true });
mkdirSync("data/cfbd/calibration", { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

function sha256(x) {
  return createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
}

function sha256File(path) {
  try {
    return sha256(readFileSync(path));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sideSum(a, b) {
  const x = num(a);
  const y = num(b);
  if (x == null && y == null) return null;
  return (x || 0) + (y || 0);
}

/** Disk-cache wrapper around cfbdGet → artifacts/cfbd-http-cache/ */
async function cachedGet(path, query = {}) {
  const key = sha256({ path, query });
  const fp = `${CACHE_DIR}/${key}.json`;
  if (existsSync(fp)) return JSON.parse(readFileSync(fp, "utf8"));
  const res = await cfbdGet(path, env, { query });
  const payload = {
    ok: res.ok,
    status: res.status,
    data: res.data,
    n: res.n,
    path,
    reason: res.reason || null,
  };
  writeFileSync(fp, JSON.stringify(payload));
  await sleep(50);
  return payload;
}

/**
 * Disk-cached fetchFn for fetchSeasonFeatureBundle so season-level CFBD GETs
 * also land under artifacts/cfbd-http-cache/.
 */
async function diskCachedFetch(url, init = {}) {
  const key = sha256({ url: String(url), method: init.method || "GET" });
  const fp = `${CACHE_DIR}/http-${key}.json`;
  if (existsSync(fp)) {
    const cached = JSON.parse(readFileSync(fp, "utf8"));
    return new Response(JSON.stringify(cached.body), {
      status: cached.status || 200,
      headers: { "content-type": "application/json" },
    });
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  writeFileSync(fp, JSON.stringify({ status: res.status, body }));
  await sleep(50);
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

async function fetchWeeks(path, season, extra = {}) {
  const rows = [];
  let calls = 0;
  let errors = 0;
  for (let week = 1; week <= 15; week++) {
    const res = await cachedGet(path, { year: season, week, seasonType: "regular", ...extra });
    calls += 1;
    if (res.ok && Array.isArray(res.data)) {
      for (const r of res.data) {
        rows.push({
          ...r,
          week,
          startDate: r.startDate || r.start_date || null,
        });
      }
    } else if (!res.ok) {
      errors += 1;
    }
  }
  return { rows, calls, errors };
}

function attachKickoffs(rows, games) {
  const byId = new Map((games || []).map((g) => [String(g.id), g.startDate || g.start_date]));
  return (rows || []).map((r) => ({
    ...r,
    startDate: r.startDate || byId.get(String(r.gameId || r.game_id || r.id)) || null,
    gameId: r.gameId || r.game_id || r.id || null,
  }));
}

function pickClosingLine(row) {
  let best = null;
  for (const L of row.lines || []) {
    if (L.spread != null || L.overUnder != null) best = L;
    if (String(L.provider || "").toLowerCase().includes("consensus")) best = L;
  }
  return best;
}

function toDesignRow(game, record) {
  const home = record.features?.home || {};
  const away = record.features?.away || {};
  const gameInput = {
    home: { name: record.home_team },
    away: { name: record.away_team },
    neutralSite: Boolean(record.features?.neutralSite),
    featureCutoffOk: true,
    cfbFbisV2Input: {
      home: { ...home, qbPpa: home.qbHistoricalUnsafe ? null : home.qbPpa },
      away: { ...away, qbPpa: away.qbHistoricalUnsafe ? null : away.qbPpa },
      neutralSite: record.features?.neutralSite,
    },
  };
  const proj = projectCfbFbisV2(gameInput, { ablation: "K" });
  if (!proj?.ok) return null;

  const d = proj.decomposition || {};
  const actualHome = num(game.homePoints ?? game.home_points);
  const actualAway = num(game.awayPoints ?? game.away_points);
  if (actualHome == null || actualAway == null) return null;

  const qbVal = num(d.QB);
  const paceVal = num(d.PACE);

  return {
    gameId: String(game.id),
    season: Number(game.season || record.season),
    week: Number(game.week || record.week),
    homeTeam: record.home_team,
    awayTeam: record.away_team,
    neutralSite: Boolean(record.features?.neutralSite),
    actualHome,
    actualAway,
    actualMargin: actualHome - actualAway,
    actualTotal: actualHome + actualAway,
    closingSpread: num(record.features?.evaluation?.closingSpread),
    closingTotal: num(record.features?.evaluation?.closingTotal),
    marginFeatures: {
      base: num(d.BASE_POWER),
      pass: num(d.PASS_MATCHUP),
      rush: num(d.RUSH_MATCHUP),
      success: num(d.SUCCESS),
      explosiveness: num(d.EXPLOSIVENESS),
      havoc: num(d.HAVOC),
      trenches: num(d.TRENCHES),
      finishing: num(d.FINISHING_DRIVES),
      qb: qbVal,
      pace: paceVal,
      context: (num(d.HFA) || 0) + (num(d.WEATHER_CONTEXT) || 0),
    },
    totalFeatures: {
      // Exact same semantic feature used at serving time.
      base_total: num(d.BASE_TOTAL),
      pass_total: sideSum(home.passEpa, away.passEpa),
      rush_total: sideSum(home.rushEpa, away.rushEpa),
      success_total: sideSum(home.successRate, away.successRate),
      explosiveness_total: sideSum(
        home.explosiveRate ?? home.explosiveness,
        away.explosiveRate ?? away.explosiveness
      ),
      havoc_total: sideSum(home.havocRate, away.havocRate),
      trenches_total: sideSum(home.lineYards, away.lineYards),
      finishing_total: sideSum(home.pointsPerOpportunity, away.pointsPerOpportunity),
      qb_total: sideSum(home.qbPpa, away.qbPpa),
      pace_total: sideSum(home.paceNorm, away.paceNorm),
      context_total: num(d.WEATHER_CONTEXT),
    },
    present: {
      base: d.BASE_POWER != null,
      pass: d.PASS_MATCHUP != null,
      rush: d.RUSH_MATCHUP != null,
      success: d.SUCCESS != null,
      explosiveness: d.EXPLOSIVENESS != null,
      havoc: d.HAVOC != null,
      trenches: d.TRENCHES != null,
      finishing: d.FINISHING_DRIVES != null,
      qb: qbVal != null && Math.abs(qbVal) > 1e-9,
      pace: paceVal != null && Math.abs(paceVal) > 1e-9,
      context: true,
    },
    provisionalMargin: num(proj.margin),
    provisionalTotal: num(proj.total),
  };
}

async function buildDesignRows() {
  if (!env.CFBD_API_KEY) throw new Error("CFBD_API_KEY required to build design rows");
  if (!existsSync(SNAPSHOT_PATH)) throw new Error(`missing snapshot summaries: ${SNAPSHOT_PATH}`);

  const snaps = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
  const passIds = new Set(
    (Array.isArray(snaps) ? snaps : [])
      .filter((s) => s.provenancePass)
      .map((s) => String(s.game_id))
  );
  const rows = [];

  for (const season of seasons) {
    const priorSeason = season - 1;
    console.error(JSON.stringify({ phase: "season-start", season, priorSeason, passIds: passIds.size }));

    const priorBundle = await fetchSeasonFeatureBundle(env, priorSeason, {
      week: null,
      fetchFn: diskCachedFetch,
    });
    const priorCatalog = buildPriorCatalog(priorBundle);
    const confMap = buildFcsConferenceStrength(priorCatalog);
    const seasonBundle = await fetchSeasonFeatureBundle(env, season, {
      week: null,
      fetchFn: diskCachedFetch,
    });
    const games = (seasonBundle.endpoints?.games?.data || []).filter(
      (g) => (g.homePoints ?? g.home_points) != null && (g.awayPoints ?? g.away_points) != null
    );

    const ppa = await fetchWeeks("/ppa/games", season);
    const adv = await fetchWeeks("/stats/game/advanced", season);
    const lines = await fetchWeeks("/lines", season);
    const ppaRows = attachKickoffs(ppa.rows, games);
    const advRows = attachKickoffs(adv.rows, games);

    const linesByGame = new Map();
    for (const row of lines.rows || []) {
      const id = String(row.id || row.gameId || "");
      if (!id) continue;
      const best = pickClosingLine(row);
      if (best) {
        linesByGame.set(id, {
          spread: best.spread ?? null,
          total: best.overUnder ?? null,
        });
      }
    }

    let used = 0;
    for (const g of games) {
      const gid = String(g.id);
      if (!passIds.has(gid)) continue;
      const kickoff = g.startDate || g.start_date;
      if (!kickoff) continue;

      const asOf = new Date(Date.parse(kickoff) - 60_000).toISOString();
      const maxCoreWeek = Math.max(0, Number(g.week) - 1);
      const coreByTeam = indexCoreByTeam([], { maxWeek: maxCoreWeek, seasonType: "regular" });

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
        mode: "historical",
      });
      if (!record?.temporalOk) continue;

      const line = linesByGame.get(gid);
      if (line) {
        record.features.evaluation = {
          ...(record.features.evaluation || {}),
          closingSpread: line.spread,
          closingTotal: line.total,
        };
      }

      const row = toDesignRow(g, record);
      if (row) {
        rows.push(row);
        used += 1;
      }
    }
    console.error(
      JSON.stringify({
        phase: "season-done",
        season,
        designRows: used,
        total: rows.length,
        ppaCalls: ppa.calls,
        advCalls: adv.calls,
        lineCalls: lines.calls,
      })
    );
  }

  writeFileSync(DESIGN_PATH, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  return rows;
}

function loadDesignRows() {
  return readFileSync(DESIGN_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function activationReport(rows) {
  const byFeature = {};
  for (const k of MARGIN_KEYS) {
    const vals = rows.map((r) => r.marginFeatures?.[k]).filter((v) => v != null && Number.isFinite(v));
    const nonzero = vals.filter((v) => Math.abs(v) > 1e-9);
    byFeature[k] = {
      nonNullN: vals.length,
      nonNullPct: rows.length ? vals.length / rows.length : null,
      nonzeroN: nonzero.length,
      nonzeroPct: rows.length ? nonzero.length / rows.length : null,
      variance: variance(vals),
      meanAbs: mean(vals.map((v) => Math.abs(v))),
    };
  }

  const ablationActivation = {};
  for (const ab of Object.keys(ABLATION_FEATURE_SETS)) {
    const feats = ADDED_VS_PREVIOUS[ab] || [];
    const inactive = feats.filter((f) => (byFeature[f]?.nonzeroPct || 0) < 0.01);
    ablationActivation[ab] = {
      featuresEnabled: ABLATION_FEATURE_SETS[ab],
      addedVsPrevious: feats,
      inactiveAddedBlocks: inactive,
      status:
        ab === "K"
          ? "architecturally_identical_to_J"
          : inactive.length === feats.length && feats.length
            ? "inactive_in_historical_sample"
            : "active",
    };
  }

  return {
    eligibleN: rows.length,
    byFeature,
    ablationActivation,
    explanations: {
      J_equals_K: "Identical feature sets/masks; K adds nothing architectural.",
      inactive_blocks:
        "Blocks with nonzeroPct≈0 are inactive_in_historical_sample — not proof they lack value if populated later.",
      provisional_total_flat: "Unfitted total ≈ 2×nationalPpg; fitted total uses intentional totalFeatures.",
    },
  };
}

function summarize(preds) {
  if (!preds?.length) return { n: 0 };
  const m = scoreMetrics({
    actualMargin: preds.map((p) => p.actualMargin),
    predMargin: preds.map((p) => p.predMargin),
    actualTotal: preds.map((p) => p.actualTotal),
    predTotal: preds.map((p) => p.predTotal),
    actualHome: preds.map((p) => p.actualHome),
    predHome: preds.map((p) => p.predHome),
    actualAway: preds.map((p) => p.actualAway),
    predAway: preds.map((p) => p.predAway),
    pHome: preds.map((p) => p.pHome),
    homeWon: preds.map((p) => p.homeWon),
    marginSigma: preds.map((p) => p.marginSigma),
  });
  // Drop per-row error vectors from reports (keep OOS preds file for detail).
  const { absMarginErr: _a, absTotalErr: _b, ...compact } = m;
  return compact;
}

function splitTrainVal(train, trainSeasons) {
  const multi = trainSeasons.length > 1;
  if (multi) {
    const lastTrain = Math.max(...trainSeasons);
    return {
      trainFit: train.filter((r) => r.season !== lastTrain),
      trainVal: train.filter((r) => r.season === lastTrain),
    };
  }
  const cut = Math.floor(train.length * 0.8);
  return {
    trainFit: train.slice(0, cut),
    trainVal: train.slice(cut),
  };
}

function makePredRow(r, foldId, ablation, predMargin, predTotal, sigmaM) {
  return {
    gameId: r.gameId,
    season: r.season,
    week: r.week,
    ablation,
    fold: foldId,
    predMargin,
    predTotal,
    predHome: (predTotal + predMargin) / 2,
    predAway: (predTotal - predMargin) / 2,
    actualMargin: r.actualMargin,
    actualTotal: r.actualTotal,
    actualHome: r.actualHome,
    actualAway: r.actualAway,
    pHome: pHomeWinFromMargin(predMargin, sigmaM),
    homeWon: r.actualHome > r.actualAway ? 1 : 0,
    marginSigma: sigmaM,
    closingSpread: r.closingSpread,
    closingTotal: r.closingTotal,
    neutralSite: r.neutralSite,
  };
}

function fitAll(rows) {
  const ablations = Object.keys(ABLATION_FEATURE_SETS);
  const foldReports = [];
  const oosByAblation = Object.fromEntries(ablations.map((a) => [a, []]));
  const coefByFold = {};

  for (const fold of FOLDS) {
    const train = rows.filter((r) => fold.trainSeasons.includes(r.season));
    const test = rows.filter((r) => r.season === fold.testSeason);
    const { trainFit, trainVal } = splitTrainVal(train, fold.trainSeasons);
    coefByFold[fold.id] = {};

    for (const ab of ablations) {
      const mNames = ABLATION_FEATURE_SETS[ab];
      const tNames = TOTAL_FEATURE_SETS[ab];

      const fitX = trainFit.length ? trainFit : train;
      const valX = trainVal.length ? trainVal : train;
      const tunedM = tuneRidgeLambda(
        fitX.map((r) => rowToMarginX(r, mNames)),
        fitX.map((r) => r.actualMargin),
        valX.map((r) => rowToMarginX(r, mNames)),
        valX.map((r) => r.actualMargin)
      );
      const tunedT = tuneRidgeLambda(
        fitX.map((r) => rowToTotalX(r, tNames)),
        fitX.map((r) => r.actualTotal),
        valX.map((r) => rowToTotalX(r, tNames)),
        valX.map((r) => r.actualTotal)
      );

      const marginModel = fitRidge(
        train.map((r) => rowToMarginX(r, mNames)),
        train.map((r) => r.actualMargin),
        { lambda: tunedM.lambda, featureNames: mNames }
      );
      const totalModel = fitRidge(
        train.map((r) => rowToTotalX(r, tNames)),
        train.map((r) => r.actualTotal),
        { lambda: tunedT.lambda, featureNames: tNames }
      );

      const trPredM = predictRidge(
        marginModel,
        train.map((r) => rowToMarginX(r, mNames))
      );
      const residM = train.map((r, i) => r.actualMargin - trPredM[i]).filter(Number.isFinite);
      const sigmaM = Math.sqrt(variance(residM)) || 16.5;

      const predM = predictRidge(
        marginModel,
        test.map((r) => rowToMarginX(r, mNames))
      );
      const predT = predictRidge(
        totalModel,
        test.map((r) => rowToTotalX(r, tNames))
      );

      const preds = test.map((r, i) => makePredRow(r, fold.id, ab, predM[i], predT[i], sigmaM));
      oosByAblation[ab].push(...preds);
      foldReports.push({
        fold: fold.id,
        ablation: ab,
        trainSeasons: fold.trainSeasons,
        testSeason: fold.testSeason,
        metrics: summarize(preds),
      });
      coefByFold[fold.id][ab] = {
        lambdaMargin: tunedM.lambda,
        lambdaTotal: tunedT.lambda,
        sigmaMargin: sigmaM,
        margin: { intercept: marginModel.intercept, beta: marginModel.beta, features: mNames },
        total: { intercept: totalModel.intercept, beta: totalModel.beta, features: tNames },
        trainN: train.length,
        testN: test.length,
      };
    }
  }

  return { foldReports, oosByAblation, coefByFold, folds: FOLDS };
}

function baselines(rows, folds) {
  const out = {
    historicalMeanHfa: [],
    priorStrengthOnly: [],
    rollingOffDef: [],
    fbisV14Shell: [],
    bookClosing: [],
  };

  for (const fold of folds) {
    const train = rows.filter((r) => fold.trainSeasons.includes(r.season));
    const test = rows.filter((r) => r.season === fold.testSeason);
    if (!train.length || !test.length) continue;

    const meanMargin = mean(train.map((r) => r.actualMargin));
    const meanTotal = mean(train.map((r) => r.actualTotal));
    const sigmaM = Math.sqrt(variance(train.map((r) => r.actualMargin - meanMargin))) || 16.5;

    const mA = fitRidge(
      train.map((r) => rowToMarginX(r, ABLATION_FEATURE_SETS.A)),
      train.map((r) => r.actualMargin),
      { lambda: 10, featureNames: ABLATION_FEATURE_SETS.A }
    );
    const tA = fitRidge(
      train.map((r) => rowToTotalX(r, TOTAL_FEATURE_SETS.A)),
      train.map((r) => r.actualTotal),
      { lambda: 10, featureNames: TOTAL_FEATURE_SETS.A }
    );
    const predMA = predictRidge(
      mA,
      test.map((r) => rowToMarginX(r, ABLATION_FEATURE_SETS.A))
    );
    const predTA = predictRidge(
      tA,
      test.map((r) => rowToTotalX(r, TOTAL_FEATURE_SETS.A))
    );

    for (let i = 0; i < test.length; i++) {
      const r = test[i];
      const push = (name, predMargin, predTotal) => {
        out[name].push({
          gameId: r.gameId,
          season: r.season,
          week: r.week,
          fold: fold.id,
          predMargin,
          predTotal,
          predHome: (predTotal + predMargin) / 2,
          predAway: (predTotal - predMargin) / 2,
          actualMargin: r.actualMargin,
          actualTotal: r.actualTotal,
          actualHome: r.actualHome,
          actualAway: r.actualAway,
          pHome: pHomeWinFromMargin(predMargin, sigmaM),
          homeWon: r.actualHome > r.actualAway ? 1 : 0,
          marginSigma: sigmaM,
        });
      };
      push("historicalMeanHfa", meanMargin, meanTotal);
      push("priorStrengthOnly", predMA[i], predTA[i]);
      push("rollingOffDef", r.marginFeatures.base ?? 0, r.totalFeatures.base_total ?? meanTotal);
      push("fbisV14Shell", (r.marginFeatures.base ?? 0) * 0.85 + (r.neutralSite ? 0 : 2.5), 53);
      if (r.closingSpread != null) {
        push(
          "bookClosing",
          -Number(r.closingSpread),
          r.closingTotal != null ? Number(r.closingTotal) : meanTotal
        );
      }
    }
  }
  return out;
}

function pairedCompare(bestPreds, otherPreds) {
  const byId = new Map((otherPreds || []).map((p) => [p.gameId, p]));
  const common = [];
  for (const b of bestPreds || []) {
    const o = byId.get(b.gameId);
    if (o) common.push({ b, o, block: `${b.season}-W${b.week}` });
  }

  const blocksMap = new Map();
  common.forEach((c, idx) => {
    const arr = blocksMap.get(c.block) || [];
    arr.push(idx);
    blocksMap.set(c.block, arr);
  });
  const blocks = [...blocksMap.values()];

  const metric = (fn) =>
    pairedBlockBootstrap(
      common.map((c) => fn(c.o)),
      common.map((c) => fn(c.b)),
      blocks,
      { nBoot: 500 }
    );

  return {
    nCommon: common.length,
    deltaMaeMargin: metric((p) => Math.abs(p.predMargin - p.actualMargin)),
    deltaSqMargin: metric((p) => (p.predMargin - p.actualMargin) ** 2),
    deltaBrier: metric((p) => (p.pHome - p.homeWon) ** 2),
    note: "delta = mean(best_err - other_err) under season-week block bootstrap; negative ⇒ best better",
  };
}

function foldStability(preds, target) {
  const byFold = {};
  for (const p of preds || []) {
    (byFold[p.fold] ||= []).push(p);
  }
  const maes = Object.values(byFold).map((arr) => {
    if (target === "margin") {
      return mean(arr.map((p) => Math.abs(p.predMargin - p.actualMargin)).filter(Number.isFinite));
    }
    return mean(arr.map((p) => Math.abs(p.predTotal - p.actualTotal)).filter(Number.isFinite));
  });
  return variance(maes.filter(Number.isFinite));
}

function selectTargetCandidate(pooled, oosByAblation, target, activation) {
  const inactive = new Set(
    Object.entries(activation?.ablationActivation || {})
      .filter(([, v]) => String(v.status || "").includes("inactive"))
      .map(([k]) => k)
  );
  // J≡K: keep J only as the tested architecture for the shared mask.
  const activeKeys = Object.keys(pooled).filter((k) => k !== "K" && !inactive.has(k));

  const maeKey = target === "margin" ? "maeMargin" : "maeTotal";
  const rmseKey = target === "margin" ? "rmseMargin" : "rmseTotal";
  const biasKey = target === "margin" ? "biasMargin" : "biasTotal";

  const ranked = activeKeys
    .map((ablation) => ({
      ablation,
      complexity: ABLATION_FEATURE_SETS[ablation].length,
      foldStability: foldStability(oosByAblation[ablation], target),
      ...pooled[ablation],
    }))
    .filter((r) => r.n > 0)
    .sort((a, b) => {
      const dMae = (a[maeKey] ?? 99) - (b[maeKey] ?? 99);
      if (Math.abs(dMae) > 1e-12) return dMae;
      const dRmse = (a[rmseKey] ?? 99) - (b[rmseKey] ?? 99);
      if (Math.abs(dRmse) > 1e-12) return dRmse;
      if (target === "margin") {
        const dBrier = (a.brier ?? 99) - (b.brier ?? 99);
        if (Math.abs(dBrier) > 1e-12) return dBrier;
        const dLl = (a.logLoss ?? 99) - (b.logLoss ?? 99);
        if (Math.abs(dLl) > 1e-12) return dLl;
      }
      const dBias = Math.abs(a[biasKey] ?? 99) - Math.abs(b[biasKey] ?? 99);
      if (Math.abs(dBias) > 1e-12) return dBias;
      const dStab = (a.foldStability ?? 99) - (b.foldStability ?? 99);
      if (Math.abs(dStab) > 1e-12) return dStab;
      return a.complexity - b.complexity;
    });

  const best = ranked[0] || null;
  if (!best) return { ranked, best: null, selected: null, paired: {}, practicalEps: null };

  // Adaptive practical epsilon: ~0.3% of leading MAE, floored at 0.02 — NOT a fixed 0.05 across targets.
  const practicalEps = Math.max(0.02, 0.003 * (best[maeKey] || 15));
  const errFn =
    target === "margin"
      ? (p) => Math.abs(p.predMargin - p.actualMargin)
      : (p) => Math.abs(p.predTotal - p.actualTotal);

  let selected = best;
  const paired = {};
  for (const cand of [...ranked].sort((a, b) => a.complexity - b.complexity)) {
    if (cand.ablation === best.ablation) {
      selected = cand;
      break;
    }
    const cmp = pairedCompare(oosByAblation[best.ablation], oosByAblation[cand.ablation]);
    const delta =
      target === "margin" ? cmp.deltaMaeMargin : {
        // reuse block bootstrap on totals via a local metric
      };
    // For totals, compute dedicated paired delta
    let deltaMean = null;
    let ci = [null, null];
    if (target === "margin") {
      deltaMean = cmp.deltaMaeMargin?.mean;
      ci = cmp.deltaMaeMargin?.ci95 || [null, null];
      paired[`${best.ablation}_vs_${cand.ablation}`] = cmp;
    } else {
      const byId = new Map((oosByAblation[cand.ablation] || []).map((p) => [p.gameId, p]));
      const common = [];
      for (const b of oosByAblation[best.ablation] || []) {
        const o = byId.get(b.gameId);
        if (o) common.push({ b, o, block: `${b.season}-W${b.week}` });
      }
      const blocksMap = new Map();
      common.forEach((c, idx) => {
        const arr = blocksMap.get(c.block) || [];
        arr.push(idx);
        blocksMap.set(c.block, arr);
      });
      const blocks = [...blocksMap.values()];
      const boot = pairedBlockBootstrap(
        common.map((c) => errFn(c.b)),
        common.map((c) => errFn(c.o)),
        blocks,
        { nBoot: 500 }
      );
      // Note: pairedBlockBootstrap in this codebase returns mean(best_err - other_err) depending on arg order.
      deltaMean = boot?.mean;
      ci = boot?.ci95 || [null, null];
      paired[`${best.ablation}_vs_${cand.ablation}`] = { nCommon: common.length, deltaMaeTotal: boot };
    }
    const ciIncludesZero = ci[0] != null && ci[1] != null && ci[0] <= 0 && ci[1] >= 0;
    const practicallyTied = deltaMean != null && Math.abs(deltaMean) <= practicalEps;
    if (ciIncludesZero || practicallyTied) {
      selected = cand;
      break;
    }
  }

  if (activeKeys.includes("A") && activeKeys.includes("B")) {
    if (target === "margin") {
      paired.A_vs_B = pairedCompare(oosByAblation.A, oosByAblation.B);
    } else {
      const byId = new Map((oosByAblation.B || []).map((p) => [p.gameId, p]));
      const common = [];
      for (const a of oosByAblation.A || []) {
        const b = byId.get(a.gameId);
        if (b) common.push({ a, b, block: `${a.season}-W${a.week}` });
      }
      const blocksMap = new Map();
      common.forEach((c, idx) => {
        const arr = blocksMap.get(c.block) || [];
        arr.push(idx);
        blocksMap.set(c.block, arr);
      });
      paired.A_vs_B = {
        nCommon: common.length,
        deltaMaeTotal: pairedBlockBootstrap(
          common.map((c) => Math.abs(c.a.predTotal - c.a.actualTotal)),
          common.map((c) => Math.abs(c.b.predTotal - c.b.actualTotal)),
          [...blocksMap.values()],
          { nBoot: 500 }
        ),
      };
    }
  }

  return {
    ranked,
    best,
    selected,
    paired,
    practicalEps,
    rationale: `Selected ${selected.ablation} for ${target}: rank by ${maeKey}/${rmseKey}/bias${
      target === "margin" ? "/Brier/logLoss" : ""
    }/fold-stability; prefer simpler when paired Δ within practicalEps=${practicalEps.toFixed(3)} or CI crosses 0.`,
  };
}

function combineMT(marginPreds, totalPreds, Mstar, Tstar) {
  const byId = new Map((totalPreds || []).map((p) => [p.gameId, p]));
  const out = [];
  for (const m of marginPreds || []) {
    const t = byId.get(m.gameId);
    if (!t) continue;
    const predMargin = m.predMargin;
    const predTotal = t.predTotal;
    out.push({
      ...m,
      ablation: `M:${Mstar}+T:${Tstar}`,
      predMargin,
      predTotal,
      predHome: (predTotal + predMargin) / 2,
      predAway: (predTotal - predMargin) / 2,
      pHome: pHomeWinFromMargin(predMargin, m.marginSigma),
    });
  }
  return out;
}

function writeOutputs(report, activation, coefByFold, oosByAblation) {
  const body = JSON.stringify(report, null, 2);
  writeFileSync("artifacts/cfb-v2-calibration-report.json", body);
  writeFileSync("data/cfbd/calibration/calibration-report.json", body);
  writeFileSync("artifacts/cfb-v2-feature-activation-fitted.json", JSON.stringify(activation, null, 2));
  writeFileSync("data/cfbd/calibration/feature-activation-fitted.json", JSON.stringify(activation, null, 2));
  writeFileSync("artifacts/cfb-v2-fitted-coefficients.json", JSON.stringify(coefByFold, null, 2));
  writeFileSync("data/cfbd/calibration/fitted-coefficients.json", JSON.stringify(coefByFold, null, 2));
  writeFileSync("artifacts/cfb-v2-oos-predictions.json", JSON.stringify(oosByAblation));

  const hashes = {
    designRows: sha256File(DESIGN_PATH),
    report: sha256(body),
    activation: sha256File("artifacts/cfb-v2-feature-activation-fitted.json"),
    coefficients: sha256File("artifacts/cfb-v2-fitted-coefficients.json"),
    coverage: sha256File("artifacts/cfb-v2-coverage-selection-bias.json"),
  };
  writeFileSync("artifacts/cfb-v2-calibration-hashes.json", JSON.stringify(hashes, null, 2));
  writeFileSync("data/cfbd/calibration/calibration-hashes.json", JSON.stringify(hashes, null, 2));
  return hashes;
}

async function main() {
  let rows;
  if (!forceRebuild && (skipFetch || existsSync(DESIGN_PATH))) {
    if (!existsSync(DESIGN_PATH)) throw new Error("design rows missing");
    rows = loadDesignRows();
    console.error(JSON.stringify({ phase: "load-design", n: rows.length }));
  } else {
    rows = await buildDesignRows();
  }

  const activation = activationReport(rows);
  const { foldReports, oosByAblation, coefByFold, folds } = fitAll(rows);
  const base = baselines(rows, folds);

  const pooled = {};
  for (const [ab, preds] of Object.entries(oosByAblation)) pooled[ab] = summarize(preds);
  const baselineMetrics = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, summarize(v)]));

  const marginSel = selectTargetCandidate(pooled, oosByAblation, "margin", activation);
  const totalSel = selectTargetCandidate(pooled, oosByAblation, "total", activation);
  if (!marginSel.selected || !totalSel.selected) throw new Error("no target candidates produced OOS predictions");

  const Mstar = marginSel.selected.ablation;
  const Tstar = totalSel.selected.ablation;
  const combined = combineMT(oosByAblation[Mstar], oosByAblation[Tstar], Mstar, Tstar);
  const combinedMetrics = summarize(combined);

  const book = baselineMetrics.bookClosing || {};
  const shell = baselineMetrics.fbisV14Shell || {};
  const hist = baselineMetrics.historicalMeanHfa || {};
  const prior = baselineMetrics.priorStrengthOnly || {};
  const roll = baselineMetrics.rollingOffDef || {};

  const beats = (a, b) => (a != null && b != null ? a < b : null);
  const marginGates = {
    vsHistoricalHfa: beats(combinedMetrics.maeMargin, hist.maeMargin),
    vsPriorStrengthOnly: beats(combinedMetrics.maeMargin, prior.maeMargin),
    vsFbisV14Shell: beats(combinedMetrics.maeMargin, shell.maeMargin),
    vsBookClosing_evalOnly: beats(combinedMetrics.maeMargin, book.maeMargin),
  };
  const totalGates = {
    vsHistoricalMean: beats(combinedMetrics.maeTotal, hist.maeTotal),
    vsRollingOffDef: beats(combinedMetrics.maeTotal, roll.maeTotal),
    vsFbisV14Shell: beats(combinedMetrics.maeTotal, shell.maeTotal),
    vsBookClosing_evalOnly: beats(combinedMetrics.maeTotal, book.maeTotal),
  };
  const marginBeatsIndependents =
    marginGates.vsHistoricalHfa && marginGates.vsPriorStrengthOnly && marginGates.vsFbisV14Shell;
  const totalBeatsIndependents =
    totalGates.vsHistoricalMean && totalGates.vsRollingOffDef && totalGates.vsFbisV14Shell;
  const totalFailsNaive =
    combinedMetrics.maeTotal != null &&
    [hist.maeTotal, roll.maeTotal, shell.maeTotal].filter((x) => x != null).length > 0 &&
    combinedMetrics.maeTotal >
      Math.min(...[hist.maeTotal, roll.maeTotal, shell.maeTotal].filter((x) => x != null));

  let coverage = null;
  try {
    coverage = JSON.parse(readFileSync("artifacts/cfb-v2-coverage-repair.json", "utf8"));
  } catch {}

  const cutoverReasons = [];
  const blockers = [
    "canQualify remains false by policy (shadow-only)",
    "wager authorization remains disabled by policy",
    "production engine must load M*/T* coefficients and coherent score path before live enablement",
  ];
  let cutover = "DO NOT CUTOVER";
  if (!marginBeatsIndependents) cutoverReasons.push("margin candidate does not beat all independent non-market baselines");
  if (totalFailsNaive) {
    cutoverReasons.push(
      "total candidate worse than naïve/simple independent baselines (historical mean / rolling / shell) without documented fallback"
    );
  }
  if (marginBeatsIndependents && !totalFailsNaive && combinedMetrics.n >= 1000) {
    cutover = "CUTOVER";
    cutoverReasons.push(
      "temporally valid fitted M*/T* beat independent baselines on the repaired provenance sample; ceremonial soak is not an automatic blocker; production wiring still required"
    );
  } else if (!cutoverReasons.length) {
    cutoverReasons.push("insufficient OOS sample or gate failure");
  }

  const report = {
    generatedAt: new Date().toISOString(),
    modelId: "CFB-FBIS-v2",
    canQualify: false,
    wagerAuthorization: false,
    promote: false,
    method: "final-select-target-specific-rolling-origin-ridge",
    marginSignConvention:
      "margin = homeScore - awayScore (home−away). Positive ⇒ home favored. biasMargin = mean(predMargin − actualMargin).",
    coherentScores: {
      homeScore: "(total + margin) / 2",
      awayScore: "(total - margin) / 2",
      note: "Feasible scores by construction from joint (margin,total); uncertainty uses M* residual σ.",
    },
    coverageRepair: coverage,
    folds,
    eligibleDesignN: rows.length,
    activation,
    coefficientsByFold: coefByFold,
    foldReports,
    pooledOos: pooled,
    marginSelection: { Mstar, ...marginSel },
    totalSelection: { Tstar, ...totalSel },
    combinedMT: { marginModel: Mstar, totalModel: Tstar, metrics: combinedMetrics },
    baselines: baselineMetrics,
    marketEvaluationSeparate: {
      note: "Do not summarize as 'books win both'. Spread and total evaluated separately.",
      spread: {
        bookMae: book.maeMargin,
        bookRmse: book.rmseMargin,
        bookBrier: book.brier,
        fbisMae: combinedMetrics.maeMargin,
        bookBeatsFbis:
          book.maeMargin != null &&
          combinedMetrics.maeMargin != null &&
          book.maeMargin < combinedMetrics.maeMargin,
      },
      total: {
        bookMae: book.maeTotal,
        bookRmse: book.rmseTotal,
        fbisMae: combinedMetrics.maeTotal,
        shellMae: shell.maeTotal,
        histMae: hist.maeTotal,
        bookBeatsFbis:
          book.maeTotal != null && combinedMetrics.maeTotal != null && book.maeTotal < combinedMetrics.maeTotal,
        bookBeatsShell: book.maeTotal != null && shell.maeTotal != null && book.maeTotal < shell.maeTotal,
      },
    },
    gates: {
      marginGates,
      totalGates,
      marginBeatsIndependents,
      totalBeatsIndependents,
      totalFailsNaive,
    },
    cutoverRecommendation: {
      gameProjectionEngine: cutover,
      wagerAuthorization: "DO NOT ENABLE",
      reasons: cutoverReasons,
      remainingEngineeringBlockers: blockers,
    },
    featureEffects: {
      margin: "Ridge on signed matchup components per ablation; M* chosen independently",
      total: "Separate ridge on intentional totalFeatures; T* chosen independently; home/away = (total ± margin)/2",
    },
    biasSignConvention: "biasMargin = mean(predMargin - actualMargin); margin = home - away",
  };

  const hashes = writeOutputs(report, activation, coefByFold, oosByAblation);
  // Also write final-select-specific artifacts
  writeFileSync("artifacts/cfb-v2-final-select-report.json", JSON.stringify(report, null, 2));
  writeFileSync("data/cfbd/calibration/final-select-report.json", JSON.stringify(report, null, 2));
  writeFileSync(
    "artifacts/cfb-v2-fitted-coefficients-final.json",
    JSON.stringify({ Mstar, Tstar, coefByFold }, null, 2)
  );
  writeFileSync(
    "data/cfbd/calibration/fitted-coefficients-final.json",
    JSON.stringify({ Mstar, Tstar, coefByFold }, null, 2)
  );
  const finalHashes = {
    ...hashes,
    designRows: sha256File(DESIGN_PATH),
    designRowsPrev5306: sha256File("artifacts/cfb-fbis-v2-design-rows-pre-talent-5306.jsonl"),
    coverageRepair: sha256File("artifacts/cfb-v2-coverage-repair.json"),
    finalReport: sha256(JSON.stringify(report)),
  };
  writeFileSync("artifacts/cfb-v2-final-select-hashes.json", JSON.stringify(finalHashes, null, 2));
  writeFileSync("data/cfbd/calibration/final-select-hashes.json", JSON.stringify(finalHashes, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        eligibleDesignN: rows.length,
        coverage,
        Mstar,
        Tstar,
        maeMargin: combinedMetrics.maeMargin,
        maeTotal: combinedMetrics.maeTotal,
        market: report.marketEvaluationSeparate,
        gates: report.gates,
        cutover: report.cutoverRecommendation,
        canQualify: false,
        hashes: finalHashes,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
