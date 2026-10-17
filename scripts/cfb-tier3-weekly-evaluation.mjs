#!/usr/bin/env node
/**
 * Offline research grader for CFBD Tier 3 weekly CSVs vs ESPN public finals.
 *
 * Usage:
 *   node scripts/cfb-tier3-weekly-evaluation.mjs \
 *     --csv /path/to/week06.csv [--csv /path/to/week07.csv] \
 *     [--out artifacts/cfb-tier3-week56-eval.json]
 *
 * Does not write proprietary CSV contents. Research-only; never authorizes wagers.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCfbTier3WeeklyCsv } from "../functions/lib/cfbTier3Weekly.js";
import {
  evaluateCfbTier3Weekly,
  compareWeekSummaries,
  fetchEspnCfFinals,
  CFB_TIER3_EVAL_AUTHORITY,
} from "../functions/lib/cfbTier3WeeklyEvaluation.js";

function args(argv) {
  const csvPaths = [];
  let out = null;
  let finalsJson = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") csvPaths.push(argv[++i]);
    else if (a === "--out") out = argv[++i];
    else if (a === "--finals-json") finalsJson = argv[++i];
    else if (a === "--help") {
      console.log("Usage: --csv <path> [--csv <path>] [--out report.json] [--finals-json cache.json]");
      process.exit(0);
    }
  }
  if (!csvPaths.length) {
    console.error("Need at least one --csv path");
    process.exit(2);
  }
  return { csvPaths, out, finalsJson };
}

function redactGames(games) {
  // Keep outcome + market reference; drop raw proprietary feature vectors.
  return games.map((g) => ({
    gameId: g.gameId,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    openingSpread: g.openingSpread,
    homePoints: g.homePoints,
    awayPoints: g.awayPoints,
    homeMargin: g.homeMargin,
    ats: g.ats,
    favorite: g.favorite,
    su: g.su,
    favoriteSuHit: g.favoriteSuHit,
    marketImpliedMargin: g.marketImpliedMargin,
    predictions: g.predictions,
    edgeVsSpread: g.edgeVsSpread,
    modelSide: g.modelSide,
    modelHit: g.modelHit,
    edgeHit: g.edgeHit,
  }));
}

const { csvPaths, out, finalsJson } = args(process.argv);
const weekReports = [];
let finalsCache = finalsJson ? JSON.parse(readFileSync(finalsJson, "utf8")) : null;

for (const path of csvPaths) {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8");
  const snapshot = await parseCfbTier3WeeklyCsv(raw, {
    filename: abs.split(/[\\/]/).pop(),
    receivedAt: new Date().toISOString(),
  });

  let finalsMap;
  if (finalsCache) {
    const rows = Array.isArray(finalsCache) ? finalsCache : finalsCache.finals || [];
    finalsMap = new Map(rows.map((r) => [String(r.gameId || r.id), r]));
  } else {
    finalsMap = await fetchEspnCfFinals(snapshot.games.map((g) => g.gameId));
  }

  const result = evaluateCfbTier3Weekly(snapshot, finalsMap);
  weekReports.push({
    summary: result.summary,
    games: redactGames(result.games),
  });
  console.log(
    JSON.stringify(
      {
        week: result.summary.week,
        graded: result.summary.graded,
        homeAtsRate: result.summary.homeAtsRate,
        favoriteSuRate: result.summary.favoriteSuRate,
        naiveBlendAtsRate: result.summary.naiveBlendAtsRate,
        corrMarket: result.summary.correlations.marketImpliedVsMargin,
        corrBlend: result.summary.correlations.blendVsMargin,
        maeSpread: result.summary.mae.openingSpread,
        edgeBuckets: result.summary.edgeBuckets,
      },
      null,
      2
    )
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  authority: CFB_TIER3_EVAL_AUTHORITY,
  canAuthorizeWager: false,
  canInfluenceProjection: false,
  comparison: compareWeekSummaries(weekReports.map((w) => w.summary)),
  weeks: weekReports,
};

if (out) {
  const dest = resolve(out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
  console.error(`wrote ${dest}`);
}
