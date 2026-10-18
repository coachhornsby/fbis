/**
 * CFB CORE research evaluation: Champion vs CORE vs Combined + ablation + market edge.
 * Rolling-origin, multi-season walk-forward. Never invents coefficients or markets.
 * Research-only — no wager authority.
 */
import {fitRidge,predictRidge,mae,bias,brierScore,pHomeWinFromMargin,rmse} from "./cfbFbisV2Fit.js";
import {buildCfbCoreMatchupVector,CFB_CORE_FEATURE_KEYS,CFB_CORE_SHADOW_ID} from "./cfbCoreChallenger.js";
import {evaluateCoreWalkForward} from "./cfbCoreBacktest.js";

const n = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const ROUND = (x, d = 4) => Number.isFinite(x) ? Number(x.toFixed(d)) : null;
const CHAMPION_KEYS = Object.freeze(["baselineMargin", "baselineTotal"]);
const CORE_ONLY_KEYS = Object.freeze(["coreCrossMargin", "coreCrossTotal"]);
const COMBINED_KEYS = CFB_CORE_FEATURE_KEYS;

function prepareRows(rows = []) {
  const dedupe = new Set(), safe = [], reject = {};
  for (const row of rows || []) {
    const id = String(row?.gameId || "");
    const season = n(row?.season), week = n(row?.week);
    const actualHome = n(row?.actualHome), actualAway = n(row?.actualAway);
    const kickoff = Date.parse(String(row?.kickoff || ""));
    const finalAt = Date.parse(String(row?.finalAt || ""));
    if (!id || dedupe.has(id) || !Number.isFinite(kickoff) ||
      !Number.isFinite(finalAt) || finalAt <= kickoff ||
      row?.finalVerified !== true || actualHome == null || actualAway == null) {
      reject.finalOrDuplicate = (reject.finalOrDuplicate || 0) + 1;
      continue;
    }
    dedupe.add(id);
    const v = buildCfbCoreMatchupVector({ ...row, season, week });
    if (!v.ok) {
      reject[v.reason] = (reject[v.reason] || 0) + 1;
      continue;
    }
    const marketSpread = n(row?.marketSpread ?? row?.openingSpread ?? row?.pinnacleSpread);
    const marketTotal = n(row?.marketTotal ?? row?.openingTotal ?? row?.pinnacleTotal);
    const marketMlHome = n(row?.marketMlHome ?? row?.mlHome);
    const marketMlAway = n(row?.marketMlAway ?? row?.mlAway);
    const marketCapturedAt = row?.marketCapturedAt || null;
    const hasMarket = marketSpread != null && marketCapturedAt &&
      Date.parse(String(marketCapturedAt)) < kickoff;
    safe.push({
      id, season, week, kickoff: row.kickoff, vector: v,
      conference: row?.homeConference || row?.conference || null,
      matchupType: row?.neutralSite ? "neutral" : "home",
      favoriteSide: (v.features.baselineMargin >= 0) ? "home" : "away",
      xChampion: CHAMPION_KEYS.map(k => v.features[k]),
      xCoreOnly: CORE_ONLY_KEYS.map(k => v.features[k]),
      xCombined: COMBINED_KEYS.map(k => v.features[k]),
      actualMargin: actualHome - actualAway,
      actualTotal: actualHome + actualAway,
      actualHome, actualAway,
      market: hasMarket ? {
        spread: marketSpread,
        total: marketTotal,
        mlHome: marketMlHome,
        mlAway: marketMlAway,
        capturedAt: marketCapturedAt,
        closingSpread: n(row?.closingSpread),
        closingTotal: n(row?.closingTotal),
        priceHome: n(row?.spreadPriceHome ?? row?.priceHome),
        priceAway: n(row?.spreadPriceAway ?? row?.priceAway),
        priceOver: n(row?.totalPriceOver ?? row?.priceOver),
        priceUnder: n(row?.totalPriceUnder ?? row?.priceUnder),
      } : null,
    });
  }
  return { safe, rejected: reject };
}

function fitPredict(trainX, testX, trainY, lambda, featureNames) {
  const fit = fitRidge(trainX, trainY, { lambda, featureNames });
  if (!fit.ok) return { ok: false };
  return { ok: true, fit, pred: predictRidge(fit, testX) };
}

function metricsBlock(yMargin, yTotal, pMargin, pTotal, sigma = 16.5) {
  const pWin = (pMargin || []).map(m => pHomeWinFromMargin(m, sigma));
  const yBin = yMargin.map(m => m > 0 ? 1 : 0);
  const winners = pMargin.map((m, i) => (m >= 0 ? 1 : 0) === (yMargin[i] > 0 ? 1 : 0) ? 1 : 0);
  const winnerAcc = winners.length ? winners.reduce((a, b) => a + b, 0) / winners.length : null;
  return {
    n: yMargin.length,
    spreadMae: ROUND(mae(yMargin, pMargin)),
    spreadRmse: ROUND(rmse(yMargin, pMargin)),
    spreadBias: ROUND(bias(yMargin, pMargin)),
    totalMae: ROUND(mae(yTotal, pTotal)),
    totalRmse: ROUND(rmse(yTotal, pTotal)),
    totalBias: ROUND(bias(yTotal, pTotal)),
    winnerAccuracy: ROUND(winnerAcc),
    brier: ROUND(brierScore(pWin, yBin)),
  };
}

function americanToProfit(price, won) {
  if (!Number.isFinite(price) || price === 0) return null;
  if (won == null) return 0;
  if (!won) return -1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function noVigProb(mlHome, mlAway) {
  const toImp = ml => {
    if (!Number.isFinite(ml) || ml === 0) return null;
    return ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
  };
  const ih = toImp(mlHome), ia = toImp(mlAway);
  if (ih == null || ia == null || ih + ia <= 0) return null;
  return { home: ih / (ih + ia), away: ia / (ih + ia) };
}

/**
 * Edge threshold selected on train fold only; evaluated on held-out fold.
 * Returns cover/ROI using actual recorded prices (never assumed -110 when present).
 */
function marketEdgeForFold(testRows, predMargins, predTotals, edgeThreshold) {
  const ats = [], totals = [], ml = [];
  for (let i = 0; i < testRows.length; i++) {
    const mkt = testRows[i].market;
    if (!mkt || mkt.spread == null) continue;
    const modelSpread = -predMargins[i]; // home-centric fair spread
    const edge = predMargins[i] - (-mkt.spread); // positive => home covers more than market
    if (Math.abs(edge) < edgeThreshold) continue;
    const sideHome = edge > 0;
    const coverMargin = testRows[i].actualMargin + mkt.spread;
    const covered = coverMargin === 0 ? null : (sideHome ? coverMargin > 0 : coverMargin < 0);
    const price = sideHome ? (mkt.priceHome ?? -110) : (mkt.priceAway ?? -110);
    const unit = covered == null ? 0 : americanToProfit(price, covered);
    ats.push({
      gameId: testRows[i].id, edge: ROUND(edge), side: sideHome ? "home" : "away",
      covered, unit: ROUND(unit),
      clv: mkt.closingSpread != null ? ROUND((sideHome ? 1 : -1) * (mkt.closingSpread - mkt.spread)) : null,
    });
    if (mkt.total != null && Number.isFinite(predTotals[i])) {
      const totEdge = predTotals[i] - mkt.total;
      if (Math.abs(totEdge) >= edgeThreshold) {
        const over = totEdge > 0;
        const actualTot = testRows[i].actualTotal;
        const hit = actualTot === mkt.total ? null : (over ? actualTot > mkt.total : actualTot < mkt.total);
        const tPrice = over ? (mkt.priceOver ?? -110) : (mkt.priceUnder ?? -110);
        totals.push({
          gameId: testRows[i].id, edge: ROUND(totEdge), side: over ? "over" : "under",
          hit, unit: ROUND(hit == null ? 0 : americanToProfit(tPrice, hit)),
          clv: mkt.closingTotal != null ? ROUND((over ? 1 : -1) * (mkt.closingTotal - mkt.total)) : null,
        });
      }
    }
    if (mkt.mlHome != null && mkt.mlAway != null) {
      const fair = pHomeWinFromMargin(predMargins[i]);
      const vig = noVigProb(mkt.mlHome, mkt.mlAway);
      if (vig) {
        const adv = fair - vig.home;
        if (Math.abs(adv) >= 0.03) {
          const betHome = adv > 0;
          const won = testRows[i].actualMargin === 0 ? null :
            (betHome ? testRows[i].actualMargin > 0 : testRows[i].actualMargin < 0);
          const price = betHome ? mkt.mlHome : mkt.mlAway;
          ml.push({
            gameId: testRows[i].id, adv: ROUND(adv), side: betHome ? "home" : "away",
            won, unit: ROUND(won == null ? 0 : americanToProfit(price, won)),
          });
        }
      }
    }
  }
  const summarize = arr => {
    const decided = arr.filter(x => x.covered != null || x.hit != null || x.won != null);
    const units = arr.map(x => x.unit).filter(Number.isFinite);
    const covers = arr.filter(x => x.covered === true || x.hit === true || x.won === true).length;
    const losses = arr.filter(x => x.covered === false || x.hit === false || x.won === false).length;
    const clvs = arr.map(x => x.clv).filter(Number.isFinite);
    return {
      n: arr.length, decided: decided.length,
      coverRate: (covers + losses) ? ROUND(covers / (covers + losses)) : null,
      unitRoi: units.length ? ROUND(units.reduce((a, b) => a + b, 0) / units.length) : null,
      totalUnits: units.length ? ROUND(units.reduce((a, b) => a + b, 0)) : null,
      meanClv: clvs.length ? ROUND(clvs.reduce((a, b) => a + b, 0) / clvs.length) : null,
      note: "Uses recorded prices when present; -110 only when historical price missing on that ticket.",
    };
  };
  return { ats: summarize(ats), totals: summarize(totals), moneyline: summarize(ml), sampleAts: ats.length, sampleTotals: totals.length };
}

function selectEdgeThreshold(trainRows, trainPredMargins) {
  // Train-only threshold selection: maximize cover-rate proxy at |edge|>=t for t in {1,2,3,4}.
  const candidates = [1, 2, 3, 4];
  let best = { t: 2, score: -1 };
  for (const t of candidates) {
    let hits = 0, n = 0;
    for (let i = 0; i < trainRows.length; i++) {
      const mkt = trainRows[i].market;
      if (!mkt || mkt.spread == null) continue;
      const edge = trainPredMargins[i] - (-mkt.spread);
      if (Math.abs(edge) < t) continue;
      const sideHome = edge > 0;
      const coverMargin = trainRows[i].actualMargin + mkt.spread;
      if (coverMargin === 0) continue;
      n += 1;
      if (sideHome ? coverMargin > 0 : coverMargin < 0) hits += 1;
    }
    const score = n >= 20 ? hits / n : -1;
    if (score > best.score) best = { t, score };
  }
  return best.t;
}

function sliceMetrics(rows, predMargins, predTotals, keyFn) {
  const buckets = {};
  for (let i = 0; i < rows.length; i++) {
    const key = keyFn(rows[i]) || "unknown";
    if (!buckets[key]) buckets[key] = { yM: [], yT: [], pM: [], pT: [] };
    buckets[key].yM.push(rows[i].actualMargin);
    buckets[key].yT.push(rows[i].actualTotal);
    buckets[key].pM.push(predMargins[i]);
    buckets[key].pT.push(predTotals[i]);
  }
  const out = {};
  for (const [k, b] of Object.entries(buckets)) {
    out[k] = { n: b.yM.length, spreadMae: ROUND(mae(b.yM, b.pM)), totalMae: ROUND(mae(b.yT, b.pT)) };
  }
  return out;
}

/**
 * Full research evaluation across Model A (Champion/baseline), B (CORE-only),
 * C (Combined), plus feature ablation and market-edge assessment.
 */
export function evaluateCfbCoreResearch(rows = [], {
  minTrain = 100, minTest = 50, minFolds = 2, lambda = 30,
} = {}) {
  const baselineWf = evaluateCoreWalkForward(rows, { minTrain, minTest, minFolds, lambda });
  const { safe, rejected } = prepareRows(rows);
  const seasons = [...new Set(safe.map(r => r.season))].sort((a, b) => a - b);
  const folds = [];
  const pooled = { A: [], B: [], C: [] };
  const marketFolds = [];
  const ablationPooled = { withoutCross: [], withCross: [] };

  for (const season of seasons.slice(1)) {
    const train = safe.filter(r => r.season < season);
    const test = safe.filter(r => r.season === season);
    if (train.length < minTrain || test.length < minTest) continue;

    const yM = test.map(r => r.actualMargin), yT = test.map(r => r.actualTotal);
    const tYM = train.map(r => r.actualMargin), tYT = train.map(r => r.actualTotal);

    const aM = fitPredict(train.map(r => r.xChampion), test.map(r => r.xChampion), tYM, lambda, CHAMPION_KEYS);
    const aT = fitPredict(train.map(r => r.xChampion), test.map(r => r.xChampion), tYT, lambda, CHAMPION_KEYS);
    const bM = fitPredict(train.map(r => r.xCoreOnly), test.map(r => r.xCoreOnly), tYM, lambda, CORE_ONLY_KEYS);
    const bT = fitPredict(train.map(r => r.xCoreOnly), test.map(r => r.xCoreOnly), tYT, lambda, CORE_ONLY_KEYS);
    const cM = fitPredict(train.map(r => r.xCombined), test.map(r => r.xCombined), tYM, lambda, COMBINED_KEYS);
    const cT = fitPredict(train.map(r => r.xCombined), test.map(r => r.xCombined), tYT, lambda, COMBINED_KEYS);
    // Ablation: champion features only vs champion + CORE cross terms (same as A vs C).
    if (![aM, aT, bM, bT, cM, cT].every(x => x.ok)) continue;

    const models = {
      champion: metricsBlock(yM, yT, aM.pred, aT.pred),
      coreOnly: metricsBlock(yM, yT, bM.pred, bT.pred),
      combined: metricsBlock(yM, yT, cM.pred, cT.pred),
    };
    models.deltaCoreVsChampion = {
      spreadMae: ROUND(models.coreOnly.spreadMae - models.champion.spreadMae),
      totalMae: ROUND(models.coreOnly.totalMae - models.champion.totalMae),
    };
    models.deltaCombinedVsChampion = {
      spreadMae: ROUND(models.combined.spreadMae - models.champion.spreadMae),
      totalMae: ROUND(models.combined.totalMae - models.champion.totalMae),
    };
    models.ablationCoreCrossValue = {
      spreadMaeReduction: ROUND(models.champion.spreadMae - models.combined.spreadMae),
      totalMaeReduction: ROUND(models.champion.totalMae - models.combined.totalMae),
      note: "Positive reduction means CORE offense-vs-defense cross terms improved MAE.",
    };

    const trainPredM = predictRidge(aM.fit, train.map(r => r.xChampion));
    const edgeT = selectEdgeThreshold(train, trainPredM);
    const market = {
      edgeThresholdSelectedOnTrain: edgeT,
      champion: marketEdgeForFold(test, aM.pred, aT.pred, edgeT),
      coreOnly: marketEdgeForFold(test, bM.pred, bT.pred, edgeT),
      combined: marketEdgeForFold(test, cM.pred, cT.pred, edgeT),
      gamesWithTimestampedMarket: test.filter(r => r.market).length,
      gamesMissingMarket: test.filter(r => !r.market).length,
    };
    marketFolds.push({ testSeason: season, ...market });

    folds.push({
      testSeason: season,
      trainSeasons: [...new Set(train.map(r => r.season))],
      nTrain: train.length,
      nTest: test.length,
      models,
      byConference: sliceMetrics(test, cM.pred, cT.pred, r => r.conference),
      byMatchupType: sliceMetrics(test, cM.pred, cT.pred, r => r.matchupType),
      byFavorite: sliceMetrics(test, cM.pred, cT.pred, r => r.favoriteSide),
      market,
    });

    for (let i = 0; i < test.length; i++) {
      pooled.A.push({ season, spreadErr: Math.abs(aM.pred[i] - yM[i]), totalErr: Math.abs(aT.pred[i] - yT[i]) });
      pooled.B.push({ season, spreadErr: Math.abs(bM.pred[i] - yM[i]), totalErr: Math.abs(bT.pred[i] - yT[i]) });
      pooled.C.push({ season, spreadErr: Math.abs(cM.pred[i] - yM[i]), totalErr: Math.abs(cT.pred[i] - yT[i]) });
      ablationPooled.withoutCross.push(Math.abs(aM.pred[i] - yM[i]));
      ablationPooled.withCross.push(Math.abs(cM.pred[i] - yM[i]));
    }
  }

  const avg = (arr, key) => arr.length ? ROUND(arr.reduce((s, r) => s + r[key], 0) / arr.length) : null;
  const comparison = {
    n: pooled.A.length,
    champion: { spreadMae: avg(pooled.A, "spreadErr"), totalMae: avg(pooled.A, "totalErr") },
    coreOnly: { spreadMae: avg(pooled.B, "spreadErr"), totalMae: avg(pooled.B, "totalErr") },
    combined: { spreadMae: avg(pooled.C, "spreadErr"), totalMae: avg(pooled.C, "totalErr") },
  };
  comparison.combinedVsChampion = {
    spreadMae: comparison.n != null && comparison.combined.spreadMae != null && comparison.champion.spreadMae != null
      ? ROUND(comparison.combined.spreadMae - comparison.champion.spreadMae) : null,
    totalMae: comparison.n != null && comparison.combined.totalMae != null && comparison.champion.totalMae != null
      ? ROUND(comparison.combined.totalMae - comparison.champion.totalMae) : null,
  };

  const ablation = {
    n: ablationPooled.withCross.length,
    spreadMaeWithoutCoreCross: ablationPooled.withoutCross.length
      ? ROUND(ablationPooled.withoutCross.reduce((a, b) => a + b, 0) / ablationPooled.withoutCross.length) : null,
    spreadMaeWithCoreCross: ablationPooled.withCross.length
      ? ROUND(ablationPooled.withCross.reduce((a, b) => a + b, 0) / ablationPooled.withCross.length) : null,
  };
  ablation.independentCoreCrossValue = ablation.spreadMaeWithoutCoreCross != null && ablation.spreadMaeWithCoreCross != null
    ? ROUND(ablation.spreadMaeWithoutCoreCross - ablation.spreadMaeWithCoreCross) : null;

  const marketSummary = {
    folds: marketFolds.length,
    note: "Thresholds selected on training folds only; no hindsight threshold shopping on test.",
    byFold: marketFolds,
  };

  const dataLimitations = [];
  if (safe.length === 0) dataLimitations.push("NO_ELIGIBLE_PIT_CORE_ROWS");
  if (seasons.length < 3) dataLimitations.push("INSUFFICIENT_MULTI_SEASON_COVERAGE");
  if (folds.length < minFolds) dataLimitations.push("INSUFFICIENT_OOS_FOLDS");
  if (marketFolds.every(f => f.gamesWithTimestampedMarket === 0)) {
    dataLimitations.push("NO_TIMESTAMPED_PINNODDS_ON_ELIGIBLE_ROWS");
  }
  const missingMarketN = safe.filter(r => !r.market).length;
  if (missingMarketN > 0) dataLimitations.push(`MISSING_MARKET_ON_${missingMarketN}_ELIGIBLE_ROWS`);

  const improved = comparison.combinedVsChampion.spreadMae != null &&
    comparison.combinedVsChampion.spreadMae < 0 &&
    comparison.combinedVsChampion.totalMae != null &&
    comparison.combinedVsChampion.totalMae < 0 &&
    folds.length >= minFolds &&
    folds.every(f => f.models.deltaCombinedVsChampion.spreadMae < 0 &&
      f.models.deltaCombinedVsChampion.totalMae < 0);

  let classification = "Unable to evaluate due to data limitations";
  if (dataLimitations.includes("NO_ELIGIBLE_PIT_CORE_ROWS") ||
      dataLimitations.includes("INSUFFICIENT_MULTI_SEASON_COVERAGE") ||
      dataLimitations.includes("INSUFFICIENT_OOS_FOLDS")) {
    classification = "Unable to evaluate due to data limitations";
  } else if (improved && !dataLimitations.includes("NO_TIMESTAMPED_PINNODDS_ON_ELIGIBLE_ROWS")) {
    classification = "Promising but insufficient evidence";
    // Full "Demonstrated added value" requires promotion gate + prospective consistency.
  } else if (improved) {
    classification = "Promising but insufficient evidence";
  } else if (comparison.combinedVsChampion.spreadMae != null &&
    comparison.combinedVsChampion.spreadMae > 0 &&
    comparison.combinedVsChampion.totalMae > 0) {
    classification = "Worse than the incumbent";
  } else if (folds.length > 0) {
    classification = "No measurable improvement";
  }

  const artifact = baselineWf.artifact && improved ? {
    ...baselineWf.artifact,
    evaluationClassification: classification,
    modelsCompared: ["champion", "coreOnly", "combined"],
  } : null;

  return {
    modelId: CFB_CORE_SHADOW_ID,
    authority: "research_only",
    canInfluenceProduction: false,
    canQualify: false,
    canAuthorizeWager: false,
    inputRows: rows.length,
    eligibleRows: safe.length,
    excluded: rejected,
    seasons,
    folds,
    comparison,
    ablation,
    marketSummary,
    dataLimitations,
    classification,
    verifiedOos: Boolean(artifact),
    artifact,
    decision: artifact ? "OOS_CORE_INCREMENT_RESEARCH_ONLY" : "INSUFFICIENT_OR_NO_INCREMENTAL_OOS_EDGE",
    walkForwardCompat: {
      verifiedOos: baselineWf.verifiedOos,
      decision: baselineWf.decision,
      comparison: baselineWf.comparison,
    },
    gameLinesOnly: true,
    playerPropsExcluded: true,
    noProviderCalls: true,
  };
}

export function classifyCfbCoreResearchOutcome(report) {
  return report?.classification || "Unable to evaluate due to data limitations";
}
