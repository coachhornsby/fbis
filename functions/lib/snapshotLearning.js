/**
 * Canonical all-sport learning loop for frozen production snapshots.
 *
 * Uses prediction_snapshots because that ledger is shared by every board sport.
 * College shadow/challenger learning remains in collegeJobs.js; this module
 * evaluates the production/research projection actually frozen for each game.
 *
 * Learning is automatic. Production mutation is not: findings and validation
 * runs are persisted as evidence only and never auto-promote or authorize bets.
 */

import { querySnapshots } from "./store.js";
import {
  evaluateModelRows,
  buildLearningFindings,
} from "./modelLab.js";
import {
  insertValidationRun,
  insertModelLearningFinding,
} from "./collegeStore.js";

export const LEARNING_SPORTS = Object.freeze([
  "mlb",
  "nfl",
  "cfb",
  "cbb",
  "nba",
  "wnba",
  "nhl",
  "soccer",
]);

const SUPPORTED = new Set(LEARNING_SPORTS);

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function millis(v) {
  const n = Date.parse(String(v || ""));
  return Number.isFinite(n) ? n : null;
}

function safeId(v, max = 64) {
  return String(v || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max) || "unknown";
}

export function snapshotModelId(row = {}) {
  const engine = String(row.engine || "").trim();
  const version = String(row.modelVersion || "").trim();
  if (engine && version && engine !== version) return `${engine}@${version}`;
  return engine || version || `${String(row.sport || "unknown").toUpperCase()}-SNAPSHOT`;
}

export function snapshotMarketInformed(row = {}) {
  const kind = String(row.projectionKind || "").toUpperCase();
  const engine = String(row.engine || "").toUpperCase();
  const flags = Array.isArray(row.projectionFlags)
    ? row.projectionFlags
    : String(row.projectionFlags || "").split(/[|,]/).filter(Boolean);
  const engineMarketInformed =
    /PINNACLE|MARKET[-_ ]?IMPLIED|BOARD[-_ ]?LINE[-_ ]?IMPLIED/.test(engine);
  // A final independent FBIS engine can inherit an upstream diagnostic flag
  // such as pinnacle_implied_score from the raw scoreboard shell. Once the
  // promoted projection is explicitly FBIS and the selected engine itself is
  // independent, that stale diagnostic must not reclassify the model.
  if (kind === "FBIS" && engine && !engineMarketInformed) return false;
  return (
    kind.includes("PINNACLE_IMPLIED") ||
    kind.includes("MARKET_IMPLIED") ||
    engineMarketInformed ||
    flags.some((f) => /pinnacle_implied_score|market_implied/i.test(String(f)))
  );
}

function gradedScoreRow(row = {}) {
  return (
    finite(row.actualHome) != null &&
    finite(row.actualAway) != null &&
    finite(row.projHome) != null &&
    finite(row.projAway) != null
  );
}

function isPregame(row = {}) {
  const frozen = millis(row.frozenAt);
  const start = millis(row.start);
  if (frozen == null) return false;
  if (start == null) return true;
  return frozen <= start;
}

/**
 * Select one canonical pregame snapshot per game/model identity.
 *
 * Multiple checkpoints are expected. We learn from the latest snapshot frozen
 * at or before event start, never from a post-start row.
 */
export function selectCanonicalLearningSnapshots(rows = []) {
  const groups = new Map();
  let rejectedPostStart = 0;
  let rejectedUngraded = 0;

  for (const row of rows || []) {
    if (String(row?.projectionState || "").toUpperCase() === "LEARNING_EXCLUDED") continue;
    if (!gradedScoreRow(row)) {
      rejectedUngraded += 1;
      continue;
    }
    if (!isPregame(row)) {
      rejectedPostStart += 1;
      continue;
    }
    const modelId = snapshotModelId(row);
    const key = [
      String(row.sport || "").toLowerCase(),
      String(row.gameId || row.id || ""),
      modelId,
    ].join("|");
    if (!String(row.gameId || row.id || "")) continue;
    const current = groups.get(key);
    if (!current || millis(row.frozenAt) > millis(current.frozenAt)) {
      groups.set(key, { ...row, learningModelId: modelId });
    }
  }

  return {
    rows: [...groups.values()],
    rejectedPostStart,
    rejectedUngraded,
  };
}

/**
 * Existing NHL snapshots may contain a legacy generic blended probability
 * falsely labeled NHL-PRO-v2. Preserve raw frozen values, but do not count
 * them as NHL calibrated probability learning without source-specific lineage.
 * Goals/margin/total remain independently gradeable.
 */
export function nhlMoneylineSnapshotEvidence(row = {}) {
  if(String(row.sport||"").toLowerCase()!=="nhl")
    return {ok:true,reason:null,scope:"NON_NHL"};
  const layer=row.layers||{};
  const eventId=String(row.gameId||row.id||"");
  const t=Date.parse(layer.probabilityFeatureCutoffTimestamp||"");
  const freeze=Date.parse(row.frozenAt||"");
  const start=Date.parse(row.start||"");
  const p=row.pHomeFinal??row.pHome;
  if(String(row.engine||"")!=="NHL-PRO-v2"||
     layer.probabilitySource!=="NHL-PRO-v2:FULL_GAME_INCLUDING_OT_SHOOTOUT"||
     String(layer.probabilitySourceEventId||"")!==eventId||
     !layer.probabilityModelVersion||
     String(layer.probabilityModelVersion)!==String(row.modelVersion||"")||
     !Number.isFinite(t)||!Number.isFinite(freeze)||t>freeze||
     !Number.isFinite(start)||freeze>=start||
     p==null||!Number.isFinite(Number(p))||Number(p)<0||Number(p)>1)
    return {ok:false,reason:"NHL_FULL_GAME_PROBABILITY_PROVENANCE_UNVERIFIED",scope:"FULL_GAME_INCLUDING_OT_SHOOTOUT"};
  return {ok:true,reason:null,scope:"FULL_GAME_INCLUDING_OT_SHOOTOUT"};
}

export function toModelLabRow(row = {}) {
  const audit=nhlMoneylineSnapshotEvidence(row);
  const pHome = audit.ok?finite(row.pHomeFinal ?? row.pHome):null;
  return {
    ...row,
    model_id: row.learningModelId || snapshotModelId(row),
    game_id: String(row.gameId || row.id || ""),
    frozen_at: row.frozenAt,
    proj_home: finite(row.projHome),
    proj_away: finite(row.projAway),
    proj_margin: finite(row.projMargin),
    proj_total: finite(row.projTotal),
    actual_home: finite(row.actualHome),
    actual_away: finite(row.actualAway),
    p_home_win: pHome,
    probability_evidence_status:audit.ok?"VERIFIED":"LEGACY_EXCLUDED",
    probability_evidence_reason:audit.reason,
  };
}

function timingSummary(rows = []) {
  let startKnown = 0;
  let postStart = 0;
  for (const row of rows) {
    const start = millis(row.start);
    const frozen = millis(row.frozenAt);
    if (start == null) continue;
    startKnown += 1;
    if (frozen == null || frozen > start) postStart += 1;
  }
  const missingStart = rows.length - startKnown;
  return {
    n: rows.length,
    startKnown,
    missingStart,
    postStart,
    leakageOk: postStart === 0 && missingStart === 0,
  };
}

function mean(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function absMean(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length : null;
}

function clamp01(v) {
  return Math.max(0.001, Math.min(0.999, Number(v)));
}

export function weeklyTrainingArtifact(modelRows = [], { sport, modelId } = {}) {
  const rows = modelRows
    .map(toModelLabRow)
    .filter((row) =>
      Number.isFinite(row.proj_home) &&
      Number.isFinite(row.proj_away) &&
      Number.isFinite(row.actual_home) &&
      Number.isFinite(row.actual_away)
    )
    .slice()
    .sort((a, b) => String(a.frozen_at || "").localeCompare(String(b.frozen_at || "")));

  if (rows.length < 30) {
    return {
      status: "INSUFFICIENT_DATA",
      sport,
      modelId,
      n: rows.length,
      minimumN: 30,
      targets: {},
    };
  }

  const holdoutN = Math.max(10, Math.min(50, Math.floor(rows.length * 0.2)));
  const train = rows.slice(0, rows.length - holdoutN);
  const holdout = rows.slice(rows.length - holdoutN);

  const rowValues = (row) => {
    const actualMargin = row.actual_home - row.actual_away;
    const actualTotal = row.actual_home + row.actual_away;
    const marginError = row.proj_margin - actualMargin;
    const totalError = row.proj_total - actualTotal;
    const y = row.actual_home === row.actual_away ? null : row.actual_home > row.actual_away ? 1 : 0;
    const p = Number.isFinite(row.p_home_win) ? row.p_home_win : null;
    return { actualMargin, actualTotal, marginError, totalError, y, p };
  };

  const trainVals = train.map(rowValues);
  const marginOffset = -(mean(trainVals.map((x) => x.marginError)) ?? 0);
  const totalOffset = -(mean(trainVals.map((x) => x.totalError)) ?? 0);
  const probTrain = trainVals.filter((x) => x.y != null && x.p != null);
  const probabilityOffset = probTrain.length
    ? -(mean(probTrain.map((x) => x.p - x.y)) ?? 0)
    : null;

  const validation = holdout.map((row) => {
    const v = rowValues(row);
    return {
      ...v,
      calibratedMarginError: v.marginError + marginOffset,
      calibratedTotalError: v.totalError + totalOffset,
      rawBrier: v.y != null && v.p != null ? (v.p - v.y) ** 2 : null,
      calibratedBrier:
        v.y != null && v.p != null && probabilityOffset != null
          ? (clamp01(v.p + probabilityOffset) - v.y) ** 2
          : null,
    };
  });

  const probValidation = validation.filter((x) => x.rawBrier != null);

  return {
    status: "TRAINED",
    sport,
    modelId,
    n: rows.length,
    trainN: train.length,
    holdoutN: holdout.length,
    trainUntil: train.at(-1)?.frozen_at || null,
    validateFrom: holdout[0]?.frozen_at || null,
    validateUntil: holdout.at(-1)?.frozen_at || null,
    targets: {
      margin: {
        correction: marginOffset,
        trainBiasBefore: mean(trainVals.map((x) => x.marginError)),
        holdoutMaeBefore: absMean(validation.map((x) => x.marginError)),
        holdoutMaeAfter: absMean(validation.map((x) => x.calibratedMarginError)),
        holdoutBiasBefore: mean(validation.map((x) => x.marginError)),
        holdoutBiasAfter: mean(validation.map((x) => x.calibratedMarginError)),
      },
      total: {
        correction: totalOffset,
        trainBiasBefore: mean(trainVals.map((x) => x.totalError)),
        holdoutMaeBefore: absMean(validation.map((x) => x.totalError)),
        holdoutMaeAfter: absMean(validation.map((x) => x.calibratedTotalError)),
        holdoutBiasBefore: mean(validation.map((x) => x.totalError)),
        holdoutBiasAfter: mean(validation.map((x) => x.calibratedTotalError)),
      },
      homeWinProbability: {
        correction: probabilityOffset,
        trainN: probTrain.length,
        holdoutN: probValidation.length,
        holdoutBrierBefore: mean(probValidation.map((x) => x.rawBrier)),
        holdoutBrierAfter: mean(probValidation.map((x) => x.calibratedBrier)),
      },
    },
    note:
      "Weekly sport/model-specific calibration challenger. Margin, total, and win probability are trained independently. No cross-sport pooling and no automatic production promotion.",
  };
}

function weeklyTrainingId(sport, modelId, artifact) {
  const day = String(artifact?.validateUntil || artifact?.trainUntil || "undated").slice(0, 10);
  return `weekly-autotrain:${safeId(sport, 12)}:${safeId(modelId, 72)}:${day}`;
}

function learningFindingId(sport, modelId, finding) {
  const day = String(finding?.windowEnd || "undated").slice(0, 10);
  return [
    "snapshot-learning",
    safeId(sport, 12),
    safeId(modelId, 72),
    safeId(finding?.findingType, 24),
    safeId(finding?.metric, 32),
    safeId(finding?.sliceKey, 32),
    day,
  ].join(":");
}

function validationId(sport, modelId, rows) {
  const latest = rows
    .map((r) => String(r.frozenAt || ""))
    .filter(Boolean)
    .sort()
    .at(-1) || "undated";
  return `snapshot-learning:validation:${safeId(sport, 12)}:${safeId(modelId, 72)}:${latest.slice(0, 10)}`;
}

export async function runSnapshotLearning(env, { sport, recentN = 50 } = {}) {
  const id = String(sport || "").toLowerCase();
  if (!SUPPORTED.has(id)) {
    return {
      ok: false,
      status: "failed",
      error: "unsupported-sport",
      supportedSports: [...LEARNING_SPORTS],
    };
  }

  const queried = await querySnapshots(env, {
    sport: id,
    since: "2000-01-01",
  });
  if (!queried.ok) {
    return {
      ok: false,
      status: "failed",
      sport: id,
      source: "prediction_snapshots",
      error: queried.reason || "snapshot-query-failed",
    };
  }

  const selected = selectCanonicalLearningSnapshots(queried.rows || []);
  const byModel = new Map();
  for (const row of selected.rows) {
    const modelId = row.learningModelId || snapshotModelId(row);
    if (!byModel.has(modelId)) byModel.set(modelId, []);
    byModel.get(modelId).push(row);
  }

  const models = [];
  const persistedFindings = [];
  const errors = [];

  for (const [modelId, modelRows] of byModel.entries()) {
    const labRows = modelRows.map(toModelLabRow);
    const metrics = evaluateModelRows(labRows, { sport: id });
    const timing = timingSummary(modelRows);
    const marketInformed = modelRows.some(snapshotMarketInformed);
    const findings = buildLearningFindings(labRows, {
      sport: id,
      modelId,
      recentN,
    });
    const training = weeklyTrainingArtifact(modelRows, { sport: id, modelId });
    if (training.status === "TRAINED") {
      const trained = await insertValidationRun(env, {
        id: weeklyTrainingId(id, modelId, training),
        modelId,
        method: "weekly-auto-train-calibration-v1",
        trainUntil: training.trainUntil,
        validateFrom: training.validateFrom,
        validateUntil: training.validateUntil,
        n: training.n,
        metrics: {
          source: "prediction_snapshots",
          autoTrain: true,
          separatedBySport: true,
          separatedTargets: ["margin", "total", "homeWinProbability"],
          artifact: training,
        },
        leakageOk: timing.leakageOk,
      });
      if (!trained.ok) {
        errors.push(`${modelId}:autotrain:${trained.reason || "write-failed"}`);
      }
    }

    const ordered = modelRows
      .slice()
      .sort((a, b) => String(a.frozenAt || "").localeCompare(String(b.frozenAt || "")));
    const validation = await insertValidationRun(env, {
      id: validationId(id, modelId, modelRows),
      modelId,
      method: "canonical-pregame-snapshot-v1",
      trainUntil: ordered.length > 1 ? ordered[Math.max(0, ordered.length - Math.max(20, Math.floor(ordered.length / 4)) - 1)]?.frozenAt : null,
      validateFrom: ordered.length ? ordered[Math.max(0, ordered.length - Math.max(20, Math.floor(ordered.length / 4)))]?.frozenAt : null,
      validateUntil: ordered.at(-1)?.frozenAt || null,
      n: metrics.n,
      metrics: {
        ...metrics,
        source: "prediction_snapshots",
        canonicalSelection: "latest-pregame-per-game-model",
        marketInformed,
        timing,
      },
      leakageOk: timing.leakageOk,
    });
    if (!validation.ok) {
      errors.push(`${modelId}:validation:${validation.reason || "write-failed"}`);
    }

    let inserted = 0;
    let already = 0;
    let failed = 0;
    for (const finding of findings) {
      const persisted = await insertModelLearningFinding(env, {
        id: learningFindingId(id, modelId, finding),
        sport: id,
        modelId,
        ...finding,
        evidence: {
          ...(finding.evidence || {}),
          source: "prediction_snapshots",
          canonicalSelection: "latest-pregame-per-game-model",
          marketInformed,
          timing,
        },
        createdAt: new Date().toISOString(),
      });
      if (persisted.ok) {
        inserted += Number(persisted.inserted || 0);
        already += Number(persisted.already || 0);
      } else {
        failed += 1;
        errors.push(`${modelId}:finding:${persisted.reason || "write-failed"}`);
      }
    }

    models.push({
      modelId,
      n: metrics.n,
      metrics,
      marketInformed,
      promotionEligible: !marketInformed && timing.leakageOk,
      timing,
      training,
      findingCount: findings.length,
      inserted,
      already,
      failed,
    });
    persistedFindings.push(
      ...findings.map((finding) => ({
        modelId,
        marketInformed,
        ...finding,
      }))
    );
  }

  return {
    ok: errors.length === 0,
    status: errors.length ? "degraded" : "success",
    sport: id,
    source: "prediction_snapshots",
    queriedRows: (queried.rows || []).length,
    canonicalRows: selected.rows.length,
    rejectedPostStart: selected.rejectedPostStart,
    rejectedUngraded: selected.rejectedUngraded,
    noData: selected.rows.length === 0,
    models,
    findings: persistedFindings,
    errors,
    governance: {
      autoTrain: true,
      autoTrainCadence: "MONDAY_05:30_AMERICA_CHICAGO",
      autoTrainScope: "SPORT_AND_MODEL_SEPARATED; MARGIN_TOTAL_PROBABILITY_SEPARATED",
      autoPromote: false,
      autoWagerAuthority: false,
      note:
        "Weekly calibration challengers train automatically from graded frozen projections. Sports and projection targets never pool. Production promotion and wager authority remain separately gated.",
    },
    generatedAt: new Date().toISOString(),
  };
}
