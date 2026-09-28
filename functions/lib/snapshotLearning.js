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
  "nhl",
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
  return (
    kind.includes("PINNACLE_IMPLIED") ||
    kind.includes("MARKET_IMPLIED") ||
    /PINNACLE|MARKET[-_ ]?IMPLIED|BOARD[-_ ]?LINE[-_ ]?IMPLIED/.test(engine) ||
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

export function toModelLabRow(row = {}) {
  const pHome = finite(row.pHomeFinal ?? row.pHome);
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
  return {
    n: rows.length,
    startKnown,
    missingStart: rows.length - startKnown,
    postStart,
    leakageOk: postStart === 0,
  };
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
      autoTrain: false,
      autoPromote: false,
      autoWagerAuthority: false,
      note:
        "Learning evidence updates automatically from graded frozen projections. Production mutation remains gated by out-of-sample validation and explicit promotion.",
    },
    generatedAt: new Date().toISOString(),
  };
}
