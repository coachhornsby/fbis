/**
 * NHL probability and calibration workstream.
 *
 * Promotion of every NHL betting model is frozen. The freeze does not rewrite a
 * frozen projection and does not grant qualification or wager authority.
 * Challengers are scored on game-level samples: several lines or snapshots from
 * one game are one observation. A missing price is not a probability, and an
 * in-sample base rate is a hindsight reference, not a forecast.
 */

import { brierScore, logLoss, pairedSkill, calibrationBins } from "./nhlMarketEvaluation.js";

export const NHL_BETTING_PROMOTION_FROZEN = true;
export const NHL_PROMOTION_FREEZE_REASON = "NHL_PROBABILITY_CALIBRATION_WORKSTREAM";
export const NHL_CALIBRATION_PRIORITY = Object.freeze([
  "totals",
  "goalie_contribution",
  "moneyline",
]);
export const NHL_PROSPECTIVE_GAME_TARGET = 100;

export function nhlLivePromotionAllowed() {
  return !NHL_BETTING_PROMOTION_FROZEN;
}

export function nhlCalibrationWorkstream() {
  return {
    id: NHL_PROMOTION_FREEZE_REASON,
    promotionFrozen: NHL_BETTING_PROMOTION_FROZEN,
    livePromotionEligible: nhlLivePromotionAllowed(),
    priority: NHL_CALIBRATION_PRIORITY,
    prospectiveGameTarget: NHL_PROSPECTIVE_GAME_TARGET,
    sampleRule: "EVERY_SCHEDULED_GAME_RETAINED",
    canQualify: false,
    canAuthorizeWager: false,
    modelChanges: "BLOCKED_UNTIL_PROSPECTIVE_EVIDENCE",
  };
}

/**
 * One row for every scheduled game. A game with no quote or no starter
 * announcement stays in the prospective sample. Skill computed only on the
 * fully observed subset is conditional and must be read next to these counts.
 */
export function scheduleEvidenceLedger(games = [], { markets = [], goalies = [] } = {}) {
  const marketById = new Map((markets || []).map((row) => [String(row.gameId), row]));
  const goalieById = new Map((goalies || []).map((row) => [String(row.gameId), row]));
  const rows = (games || []).map((game) => {
    const gameId = String(game.id);
    const market = marketById.get(gameId) || null;
    const goalie = goalieById.get(gameId) || null;
    const marketEvidence = market?.evidenceClass || "MISSING";
    const goalieHome = goalie?.home || "MISSING";
    const goalieAway = goalie?.away || "MISSING";
    const starterAnnounced = goalieHome === "POSITIVE" && goalieAway === "POSITIVE";
    const marketQuotePresent = marketEvidence === "POSITIVE";
    return {
      gameId,
      scheduled: true,
      retainedInProspectiveSample: true,
      marketEvidence,
      goalieHome,
      goalieAway,
      starterAnnounced,
      marketQuotePresent,
      fullyObserved: starterAnnounced && marketQuotePresent,
    };
  });
  return {
    scheduled: rows.length,
    fullyObserved: rows.filter((row) => row.fullyObserved).length,
    missingMarket: rows.filter((row) => row.marketEvidence === "MISSING").length,
    negativeMarket: rows.filter((row) => row.marketEvidence === "NEGATIVE").length,
    missingStarter: rows.filter((row) => !row.starterAnnounced).length,
    retained: rows.length,
    dropped: 0,
    rows,
    canQualify: false,
    canAuthorizeWager: false,
  };
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Collapse every line and snapshot that shares a game id. The returned row is
 * the one independent sample used for Brier, log loss and paired tests.
 */
export function clusterGameSamples(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    if (!row?.gameId) throw new Error("NHL_GAME_ID_REQUIRED");
    if (!Number.isFinite(row.probability) || !Number.isFinite(row.outcome)) {
      throw new Error("NHL_CHALLENGER_ROW_INCOMPLETE");
    }
    const key = String(row.gameId);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([gameId, items]) => {
    const priced = items.filter((item) => item.evidenceClass === "POSITIVE" && Number.isFinite(item.marketProbability));
    const negative = items.some((item) => item.evidenceClass === "NEGATIVE");
    return {
      gameId,
      probability: mean(items.map((item) => item.probability)),
      outcome: mean(items.map((item) => item.outcome)),
      marketProbability: priced.length ? mean(priced.map((item) => item.marketProbability)) : null,
      lines: items.length,
      marketEvidence: priced.length ? "POSITIVE" : negative ? "NEGATIVE" : "MISSING",
    };
  });
}

function clvReport(rows) {
  const verified = rows.length > 0 && rows.every((row) => row.clvVerified === true && Number.isFinite(row.clv));
  if (!verified) return { status: "UNVERIFIED", value: null, games: null };
  const byGame = new Map();
  for (const row of rows) {
    const list = byGame.get(String(row.gameId)) || [];
    list.push(row.clv);
    byGame.set(String(row.gameId), list);
  }
  const gameMeans = [...byGame.values()].map((values) => mean(values));
  return { status: "VERIFIED", value: mean(gameMeans), games: gameMeans.length };
}

function economicReport(rows) {
  const byGame = new Map();
  for (const row of rows) {
    const key = String(row.gameId);
    const list = byGame.get(key) || [];
    list.push(row);
    byGame.set(key, list);
  }
  const games = [...byGame.values()];
  const priced = games.filter((items) => items.every((item) => item.pricesVerified === true && Number.isFinite(item.unitReturn)));
  if (priced.length !== games.length || !priced.length) {
    return { status: "UNVERIFIED_PRICES", units: null, games: priced.length, gamesRequired: NHL_PROSPECTIVE_GAME_TARGET };
  }
  if (priced.length < NHL_PROSPECTIVE_GAME_TARGET) {
    return { status: "INSUFFICIENT_EVIDENCE", units: null, games: priced.length, gamesRequired: NHL_PROSPECTIVE_GAME_TARGET };
  }
  const units = priced.reduce((sum, items) => sum + mean(items.map((item) => item.unitReturn)), 0);
  return { status: "REPORTABLE", units, games: priced.length, gamesRequired: NHL_PROSPECTIVE_GAME_TARGET };
}

/**
 * One challenger card. Market skill uses only games that carry a positive
 * pregame de-vigged price. Games without that price stay in the model sample
 * and are counted as missing or negative evidence, never as a market probability.
 */
export function challengerReport({ family, challenger, rows = [], schedule = null } = {}) {
  const games = rows.length ? clusterGameSamples(rows) : [];
  const n = games.length;
  const probabilities = games.map((game) => game.probability);
  const outcomes = games.map((game) => game.outcome);
  const base = n ? mean(outcomes) : null;
  const priced = games.filter((game) => game.marketProbability != null);
  const pairedOrNull = (left, right, labels) => (left.length >= 2 ? pairedSkill(left, right, labels) : null);
  return {
    family,
    challenger,
    independentGames: n,
    lineObservations: rows.length,
    sameGameLinesCollapsed: rows.length - n,
    brier: n ? brierScore(probabilities, outcomes) : null,
    logLoss: n ? logLoss(probabilities, outcomes) : null,
    calibration: n ? calibrationBins(probabilities, outcomes) : [],
    versus: {
      coin: pairedOrNull(probabilities, outcomes.map(() => 0.5), outcomes),
      hindsightBaseRate: {
        label: "IN_SAMPLE_BASE_RATE_NOT_A_FORECAST",
        comparison: pairedOrNull(probabilities, outcomes.map(() => base), outcomes),
      },
      deviggedMarket: pairedOrNull(
        priced.map((game) => game.probability),
        priced.map((game) => game.marketProbability),
        priced.map((game) => game.outcome),
      ),
    },
    marketGames: priced.length,
    missingMarketGames: games.filter((game) => game.marketEvidence === "MISSING").length,
    negativeMarketGames: games.filter((game) => game.marketEvidence === "NEGATIVE").length,
    clv: clvReport(rows),
    economicReturns: economicReport(rows),
    schedule: scheduleCompleteness(schedule, games),
    canQualify: false,
    canAuthorizeWager: false,
  };
}

function scheduleCompleteness(schedule, scoredGames) {
  if (!schedule) return null;
  const scored = new Set(scoredGames.map((game) => game.gameId));
  const absent = (schedule.rows || []).filter((row) => !scored.has(row.gameId));
  return {
    scheduled: schedule.scheduled,
    fullyObserved: schedule.fullyObserved,
    missingMarket: schedule.missingMarket,
    negativeMarket: schedule.negativeMarket,
    missingStarter: schedule.missingStarter,
    retained: schedule.retained,
    dropped: schedule.dropped,
    scoredGames: scoredGames.length,
    scheduledGamesAbsentFromScore: absent.length,
    absentGameIds: absent.map((row) => row.gameId),
    note: "Every scheduled game stays in the ledger. A score that omits games with no quote or no starter announcement is conditional on the observed subset.",
  };
}

export function orderChallengerReports(reports = []) {
  const rank = new Map(NHL_CALIBRATION_PRIORITY.map((family, index) => [family, index]));
  return [...reports].sort((a, b) => (rank.get(a.family) ?? 99) - (rank.get(b.family) ?? 99)
    || String(a.challenger).localeCompare(String(b.challenger)));
}
