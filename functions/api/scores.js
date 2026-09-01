import { authorizeExecutedBetWrite, unauthorizedBody } from "../lib/auth.js";
import { validateManualScore, previewManualScore } from "../lib/manualScore.js";
import {
  gradeSnapshotsForGame,
  queryStrategyTickets,
  gradeStrategyTicket,
  queryExecutedBets,
  updateExecutedBet,
  hasDb,
} from "../lib/store.js";
import { STRATEGY_HC_V1 } from "../lib/strategy.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function payload(env, input) {
  const checked = validateManualScore(input);
  if (!checked.ok) return { ok: false, status: 400, body: { ok: false, error: "Invalid final score", fields: checked.errors } };
  const strategy = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id });
  const executed = await queryExecutedBets(env, { sport: checked.score.sport || undefined });
  const preview = previewManualScore(checked.score, strategy, executed.rows || []);
  return {
    ok: true,
    score: checked.score,
    preview,
    body: {
      ok: true,
      preview: true,
      score: checked.score,
      strategy: preview.strategy.map(({ ticket, settlement }) => ({ id: ticket.id, matchup: ticket.matchup, market: ticket.market, side: ticket.side, result: settlement.result, profit: settlement.profit })),
      bets: preview.bets.map(({ bet, settlement }) => ({ id: bet.id, ticketId: bet.externalTicketId, matchup: bet.matchup, market: bet.market, result: settlement.result, profit: settlement.profit })),
      frozenSnapshots: "all snapshots with this game ID",
    },
  };
}

export async function handleScoresPost(env, input) {
  if (!hasDb(env)) return { status: 503, body: { ok: false, error: "Research database unavailable" } };
  const p = await payload(env, input);
  if (!p.ok) return { status: p.status, body: p.body };
  if (input.confirm !== true) return { status: 200, body: p.body };
  if (!p.preview.strategy.length && !p.preview.bets.length) {
    return { status: 409, body: { ...p.body, ok: false, error: "No open tickets match this game. Nothing was changed." } };
  }
  const at = new Date().toISOString();
  if (p.score.gameId) {
    const snapshot = await gradeSnapshotsForGame(env, { gameId: p.score.gameId, actualHome: p.score.homeScore, actualAway: p.score.awayScore, gradedAt: at });
    if (!snapshot.ok) return { status: 500, body: { ok: false, error: snapshot.reason || "Could not save final score" } };
  }
  for (const { ticket, settlement } of p.preview.strategy) {
    const saved = await gradeStrategyTicket(env, ticket.id, { ...settlement, gradedAt: at });
    if (!saved.ok) return { status: 409, body: { ok: false, error: `Strategy ticket ${ticket.id}: ${saved.reason}` } };
  }
  for (const { bet, settlement } of p.preview.bets) {
    const saved = await updateExecutedBet(env, bet.id, { ...settlement, gradedAt: at }, "manual-final-score");
    if (!saved.ok) return { status: 500, body: { ok: false, error: `Bet ${bet.id}: ${saved.reason}` } };
  }
  try {
    await env.DB.prepare(
      `INSERT INTO manual_score_audit (sport, game_id, home_score, away_score, affected_strategy, affected_bets, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'operator-confirmed', ?)`
    ).bind(p.score.sport, p.score.gameId || `bet:${p.score.betId}`, p.score.homeScore, p.score.awayScore, p.preview.strategy.length, p.preview.bets.length, at).run();
  } catch (err) {
    return { status: 500, body: { ok: false, error: `Score saved but audit failed: ${String(err?.message || err)}` } };
  }
  return { status: 200, body: { ...p.body, preview: false, applied: true, gradedAt: at } };
}

export async function onRequestPost(context) {
  const auth = authorizeExecutedBetWrite(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);
  let input;
  try { input = await context.request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const result = await handleScoresPost({ DB: context.env.DB }, input || {});
  return json(result.body, result.status);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type" } });
}
