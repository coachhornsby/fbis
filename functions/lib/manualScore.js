import { gradeStrategyResult } from "./strategy.js";
import { settleExecutedBet } from "./executedBets.js";

export function validateManualScore(input = {}) {
  const sport = String(input.sport || "").toLowerCase();
  const gameId = String(input.gameId || "").trim();
  const betId = String(input.betId || "").trim();
  const home = Number(input.homeScore);
  const away = Number(input.awayScore);
  const errors = [];
  if (!gameId && !betId) errors.push("gameIdOrBetId");
  if (!Number.isInteger(home) || home < 0) errors.push("homeScore");
  if (!Number.isInteger(away) || away < 0) errors.push("awayScore");
  if (sport === "mlb" && home === away) errors.push("mlbTie");
  return errors.length ? { ok: false, errors } : { ok: true, score: { sport, gameId, betId, homeScore: home, awayScore: away } };
}

export function manualFinal(score) {
  return {
    id: score.gameId || `manual:${score.betId}`,
    gameStatus: "Final (manual operator resolution)",
    status: { completed: true, detail: "Final" },
    home: { score: score.homeScore },
    away: { score: score.awayScore },
    actualHome: score.homeScore,
    actualAway: score.awayScore,
  };
}

export function previewManualScore(score, strategyTickets = [], executedBets = []) {
  const game = manualFinal(score);
  const strategy = strategyTickets
    .filter((t) => String(t.gameId) === String(score.gameId) && (!t.result || t.result === "OPEN"))
    .map((ticket) => ({ ticket, settlement: gradeStrategyResult(ticket, game) }))
    .filter((row) => row.settlement);
  const bets = executedBets
    .filter((t) => {
      const selected = score.betId ? String(t.id) === String(score.betId) : String(t.gameId) === String(score.gameId);
      return selected && (!t.result || t.result === "OPEN");
    })
    .map((bet) => ({ bet, settlement: settleExecutedBet(bet, game) }))
    .filter((row) => row.settlement?.result && row.settlement.result !== "OPEN");
  return { game, strategy, bets };
}
