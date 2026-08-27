/**
 * Heritage executed-bet matching, attribution, Pin CLV, and settlement.
 * Separate from FBIS-HC-v1 / qualified tickets / 7–0 seed.
 */

import { namesMatch, teamsMatch, kickoffProximity } from "./match.js";
import { EXECUTION_BOOK } from "./books.js";
import { probabilityClv } from "./pricing.js";
import { selectPinAtOrBefore, selectClose, marketKey, periodOf } from "./closeCapture.js";
import { expectedProfit, executedBetId, fbisSideOf, HERITAGE_CLV_METHOD, hashText } from "./heritageSlip.js";
import { identityFromName } from "./teams.js";

export const OPERATOR_ONLY = "OPERATOR BET · NOT ATTRIBUTED TO FBIS";

export function resolveSelectedSide(ticket, game) {
  if (ticket.selectedSide === "OVER" || ticket.selectedSide === "UNDER") return ticket.selectedSide;
  if (ticket.selectedSide === "HOME" || ticket.selectedSide === "AWAY") return ticket.selectedSide;
  const team = ticket.selectedTeam;
  if (!game || !team) return null;
  const home = namesMatch(game.home?.name || game.homeName, team) || namesMatch(game.home?.abbr || game.homeAbbr, team);
  const away = namesMatch(game.away?.name || game.awayName, team) || namesMatch(game.away?.abbr || game.awayAbbr, team);
  if (home && !away) return "HOME";
  if (away && !home) return "AWAY";
  if (home && away) return null;
  return null;
}

function bothTeams(game, awayName, homeName) {
  return (
    teamsMatch(game.home, game.away, homeName, awayName) ||
    teamsMatch(game.home, game.away, awayName, homeName)
  );
}

export function matchExecutedBet(ticket, games) {
  const list = (games || []).filter((g) => {
    if (ticket.sport && g.sport && ticket.sport !== g.sport) return false;
    if (ticket.date && g.date && ticket.date !== g.date) return false;
    return bothTeams(
      {
        home: { name: g.home?.name || g.homeName, abbr: g.home?.abbr || g.homeAbbr },
        away: { name: g.away?.name || g.awayName, abbr: g.away?.abbr || g.awayAbbr },
      },
      ticket.awayTeam,
      ticket.homeTeam
    );
  });
  const timed = list.filter((g) => kickoffProximity(ticket.executedAt, g.start, 18));
  const pool = timed.length ? timed : list;
  if (!pool.length) {
    return { status: "unmatched", confidence: "none", game: null, candidates: [], warning: "unmatched games" };
  }
  if (pool.length > 1) {
    return {
      status: "ambiguous",
      confidence: "low",
      game: null,
      candidates: pool.map(slimGame),
      warning: "ambiguous team matches",
    };
  }
  const game = pool[0];
  return { status: "matched", confidence: "high", game, candidates: [slimGame(game)], warning: null };
}

function slimGame(g) {
  return {
    id: String(g.id || g.gameId),
    sport: g.sport,
    date: g.date,
    start: g.start,
    home: g.home?.name || g.homeName,
    away: g.away?.name || g.awayName,
    homeAbbr: g.home?.abbr || g.homeAbbr,
    awayAbbr: g.away?.abbr || g.awayAbbr,
  };
}

export function attributeRecommendation(ticket, { snapshots = [], strategyTickets = [] } = {}) {
  const executedAt = Date.parse(ticket.executedAt || "");
  const gameId = String(ticket.gameId || "");
  const priorSnaps = (snapshots || [])
    .filter((s) => String(s.gameId || s.id) === gameId || String(s.id) === gameId)
    .filter((s) => {
      const t = Date.parse(s.frozenAt || s.frozen_at || s.asOf || "");
      return Number.isFinite(executedAt) && Number.isFinite(t) && t <= executedAt;
    })
    .sort((a, b) => String(a.frozenAt || "").localeCompare(String(b.frozenAt || "")));
  const snap = priorSnaps.at(-1) || null;
  const market = ticket.market;
  const side = ticket.selectedSide;
  const priorTickets = (strategyTickets || []).filter((t) => {
    if (String(t.gameId || t.game_id) !== gameId) return false;
    const at = Date.parse(t.qualifiedAt || t.qualified_at || t.createdAt || "");
    if (Number.isFinite(executedAt) && Number.isFinite(at) && at > executedAt) return false;
    if (!market || !side) return false;
    if (String(t.market || "").toUpperCase() !== String(market).toUpperCase()) return false;
    if (String(t.side || "").toUpperCase() !== String(side).toUpperCase()) return false;
    return true;
  });
  const rec = priorTickets.sort((a, b) => String(a.qualifiedAt || "").localeCompare(String(b.qualifiedAt || ""))).at(-1) || null;
  const projected = Boolean(snap && (snap.projHome != null || snap.pHomeFinal != null));
  const recommended = Boolean(rec);
  const qualified = Boolean(rec?.qualified || rec?.tag && rec.tag !== "LEAN");
  const conviction = String(rec?.tag || "").toUpperCase() === "CONVICTION";
  const lean = String(rec?.tag || "").toUpperCase() === "LEAN" || Boolean(rec?.lean && !rec?.qualified);
  const noFreeze = !snap;
  const operatorOnly = !recommended;
  return {
    projected,
    recommended,
    qualified: recommended ? qualified : false,
    conviction: recommended ? conviction : false,
    lean: recommended ? lean : false,
    operatorOnly,
    noFreeze,
    recommendationStatus: noFreeze
      ? "NO_FREEZE"
      : recommended
        ? conviction
          ? "CONVICTION"
          : qualified
            ? "QUALIFIED"
            : lean
              ? "LEAN"
              : "RECOMMENDED"
        : "OPERATOR_ONLY",
    label: recommended ? (conviction ? "CONVICTION" : qualified ? "QUALIFIED" : lean ? "MODEL LEAN" : "RECOMMENDED") : OPERATOR_ONLY,
    matchedPredictionId: snap ? `${snap.date}:${snap.id || snap.gameId}:${snap.checkpoint}` : null,
    matchedStrategyTicketId: rec?.id || null,
    modelVersionAtEntry: snap?.modelVersion || rec?.modelVersion || null,
    checkpointAtEntry: snap?.checkpoint || rec?.checkpoint || null,
    frozenAt: snap?.frozenAt || null,
    modelProbability: snap?.pHomeFinal ?? rec?.fair ?? null,
    marketProbability: snap?.pMarket ?? rec?.implied ?? null,
    ev: rec?.ev ?? null,
    tag: rec?.tag || null,
    evidence: {
      predictionId: snap ? `${snap.date}:${snap.id || snap.gameId}:${snap.checkpoint}` : null,
      strategyTicketId: rec?.id || null,
      modelVersion: snap?.modelVersion || rec?.modelVersion || null,
      checkpoint: snap?.checkpoint || null,
      frozenAt: snap?.frozenAt || null,
    },
  };
}

export function attachPinnacleClv(ticket, snapshots, start) {
  const side = ticket.selectedSide;
  const market = ticket.market;
  const period = ticket.period === "F5" ? "f5" : "fg";
  const line = ticket.executionLine;
  const heritageCurrent = {
    line: ticket.heritageCurrentLine ?? null,
    price: ticket.heritageCurrentPrice ?? null,
    raw: ticket.heritageCurrentRaw || null,
    note: "Heritage current line is execution-book context, not Pinnacle CLV.",
  };
  if (!ticket.gameId || !side || !market) {
    return {
      pinEntry: null,
      pinClose: null,
      clv: null,
      clvStatus: "unavailable",
      clvReason: "unmatched or incomplete contract",
      clvMethodVersion: HERITAGE_CLV_METHOD,
      heritageCurrent,
    };
  }
  const entry = selectPinAtOrBefore(snapshots, {
    at: ticket.executedAt,
    start,
    market,
    period,
    side,
    line: market === "ML" || market === "F5 ML" ? null : line,
  });
  const closePick = selectClose(snapshots, {
    start,
    market,
    period,
    side,
    entryLine: market === "ML" || market === "F5 ML" ? null : line,
  });
  const close = closePick.close;
  const sameLine = closePick.sameLine !== false;
  const clv = entry && close && sameLine ? probabilityClv(entry.noVig, close.noVig) : null;
  let reason = null;
  if (!entry) reason = "missing Pinnacle entry at or before execution";
  else if (!close) reason = closePick.reason === "line-mismatch" ? "different-contract close" : "missing Pinnacle close before kickoff";
  else if (!sameLine) reason = "entry and close points differ; same-line CLV unavailable";
  return {
    pinEntry: entry
      ? { line: entry.line, price: entry.price, noVig: entry.noVig, at: entry.capturedAt }
      : null,
    pinClose: close
      ? { line: close.line, price: close.price, noVig: close.noVig, at: close.capturedAt }
      : null,
    clv,
    clvStatus: clv == null ? "unavailable" : "ok",
    clvReason: reason,
    clvMethodVersion: HERITAGE_CLV_METHOD,
    lineMovement: closePick.lineMovement,
    heritageCurrent,
  };
}

export function settleExecutedBet(ticket, game) {
  if (!game) return { result: ticket.result || "OPEN", profit: ticket.profit ?? null, settledReturn: null, gradedAt: null };
  const detail = String(game.status?.detail || game.gameStatus || "").toLowerCase();
  if (/postpone/.test(detail)) return { result: "POSTPONED", profit: null, settledReturn: null, gradedAt: null };
  if (/suspend/.test(detail)) return { result: "SUSPENDED", profit: null, settledReturn: null, gradedAt: null };
  if (/cancel|void/.test(detail)) return { result: "VOID", profit: 0, settledReturn: ticket.riskAmount, gradedAt: new Date().toISOString(), voidReason: "canceled" };
  const f5 = String(ticket.period || ticket.market || "").includes("F5");
  const hs = f5 ? Number(game.f5Score?.home ?? game.f5ActualHome) : Number(game.home?.score ?? game.actualHome);
  const as = f5 ? Number(game.f5Score?.away ?? game.f5ActualAway) : Number(game.away?.score ?? game.actualAway);
  const complete = f5 ? Boolean(game.f5Score?.complete || (game.f5ActualHome != null && game.f5ActualAway != null)) : Boolean(game.status?.completed || (game.actualHome != null && game.actualAway != null));
  if (!complete || !Number.isFinite(hs) || !Number.isFinite(as)) {
    return { result: "OPEN", profit: null, settledReturn: null, gradedAt: null };
  }
  const market = ticket.market;
  const side = ticket.selectedSide;
  const line = Number(ticket.executionLine);
  let won = null;
  let push = false;
  if (market === "ML" || market === "F5 ML") {
    if (hs === as) push = true;
    else won = side === "HOME" ? hs > as : as > hs;
  } else if (market === "SPREAD" || market === "F5 SPREAD") {
    if (!Number.isFinite(line)) return { result: "MANUAL_REVIEW", profit: null, settledReturn: null, gradedAt: null };
    const cover = side === "HOME" ? hs - as + line : as - hs + line;
    if (cover === 0) push = true;
    else won = cover > 0;
  } else if (market === "TOTAL" || market === "F5 TOTAL") {
    if (!Number.isFinite(line)) return { result: "MANUAL_REVIEW", profit: null, settledReturn: null, gradedAt: null };
    const tot = hs + as;
    if (tot === line) push = true;
    else won = side === "OVER" ? tot > line : tot < line;
  } else {
    return { result: "MANUAL_REVIEW", profit: null, settledReturn: null, gradedAt: null };
  }
  if (push) {
    return { result: "PUSH", profit: 0, settledReturn: ticket.riskAmount, gradedAt: new Date().toISOString() };
  }
  const result = won ? "WON" : "LOST";
  const profit = expectedProfit(result, ticket.riskAmount, ticket.toWinAmount);
  const settledReturn = won ? ticket.potentialPayout : 0;
  return { result, profit, settledReturn, gradedAt: new Date().toISOString() };
}

export function immutableConflict(existing, next) {
  const keys = [
    ["selectedSide", "selected_side"],
    ["executionLine", "execution_line"],
    ["executionPrice", "execution_price"],
    ["riskAmount", "risk_amount"],
    ["executedAt", "executed_at"],
  ];
  for (const [camel, snake] of keys) {
    const a = existing[camel] ?? existing[snake];
    const b = next[camel] ?? next[snake];
    if (a == null || b == null) continue;
    if (String(a) !== String(b)) return true;
  }
  return false;
}

export function summarizeExecutedBets(rows) {
  const xs = rows || [];
  const settled = xs.filter((t) => t.result === "WON" || t.result === "LOST");
  const wins = settled.filter((t) => t.result === "WON").length;
  const losses = settled.filter((t) => t.result === "LOST").length;
  const risk = xs.reduce((s, t) => s + (Number(t.riskAmount ?? t.risk_amount) || 0), 0);
  const profits = settled.map((t) => t.profit).filter((v) => v != null && Number.isFinite(Number(v)));
  const profit = profits.length ? profits.reduce((s, v) => s + Number(v), 0) : null;
  const clvs = xs.map((t) => t.clv).filter((v) => v != null && Number.isFinite(Number(v)));
  const n = xs.length;
  return {
    bets: n,
    open: xs.filter((t) => !t.result || t.result === "OPEN").length,
    settled: settled.length,
    record: settled.length ? `${wins}-${losses}` : null,
    risk: n ? Math.round(risk * 100) / 100 : null,
    profit: profits.length ? Math.round(profit * 100) / 100 : null,
    roi: profits.length && risk ? profit / risk : null,
    validClvN: clvs.length,
    avgClv: clvs.length ? clvs.reduce((s, v) => s + Number(v), 0) / clvs.length : null,
    positiveClvShare: clvs.length ? clvs.filter((v) => v > 0).length / clvs.length : null,
    message: settled.length ? null : n ? "No settled Heritage bets yet." : "No imported Heritage bets yet.",
  };
}

export async function decoratePreview(ticket, { games = [], existing = [], snapshots = [], oddsSnapshots = [], strategyTickets = [] } = {}) {
  const match = matchExecutedBet(ticket, games);
  const game = match.game;
  const side = resolveSelectedSide(ticket, game);
  const next = {
    ...ticket,
    gameId: game?.id ? String(game.id) : ticket.gameId || null,
    selectedSide: side || ticket.selectedSide,
    matchStatus: match.status,
    matchConfidence: match.confidence,
    matchCandidates: match.candidates,
    duplicateStatus: existing.some((e) => String(e.externalTicketId || e.external_ticket_id).toUpperCase() === String(ticket.externalTicketId).toUpperCase())
      ? "existing"
      : ticket.duplicateInPaste
        ? "paste-duplicate"
        : "new",
  };
  if (match.warning && !(next.warnings || []).includes(match.warning)) next.warnings = [...(next.warnings || []), match.warning];
  if (next.duplicateStatus === "existing") {
    const prev = existing.find((e) => String(e.externalTicketId || e.external_ticket_id).toUpperCase() === String(ticket.externalTicketId).toUpperCase());
    if (prev && immutableConflict(prev, next)) {
      next.duplicateStatus = "conflict";
      next.warnings = [...(next.warnings || []), "conflicting existing records"];
    }
  }
  const attr = game
    ? attributeRecommendation(next, { snapshots, strategyTickets })
    : {
        projected: false,
        recommended: false,
        qualified: false,
        conviction: false,
        lean: false,
        operatorOnly: true,
        noFreeze: true,
        recommendationStatus: "UNMATCHED",
        label: OPERATOR_ONLY,
      };
  const pinRows = (oddsSnapshots.length ? oddsSnapshots : snapshots).filter((s) => String(s.gameId) === String(game?.id || ticket.gameId || ""));
  const clv = game ? attachPinnacleClv(next, pinRows, game.start) : attachPinnacleClv(next, [], null);
  next.attribution = attr;
  next.clvPack = clv;
  next.id = executedBetId(EXECUTION_BOOK, ticket.externalTicketId);
  next.rawTextHash = await hashText(ticket.rawText || "");
  return next;
}

export function packExecutedBetRow(ticket) {
  const attr = ticket.attribution || {};
  const clv = ticket.clvPack || {};
  return {
    id: ticket.id || executedBetId(ticket.executionBook, ticket.externalTicketId),
    externalTicketId: ticket.externalTicketId,
    executionBook: ticket.executionBook || EXECUTION_BOOK,
    executedAt: ticket.executedAt,
    timezone: ticket.timezone || "America/Chicago",
    sport: ticket.sport || "mlb",
    date: ticket.date,
    gameId: ticket.gameId || null,
    sourceEventId: ticket.sourceEventId || null,
    sourceUrl: ticket.sourceUrl || null,
    matchupText: ticket.matchupText,
    awayTeam: ticket.awayTeam,
    homeTeam: ticket.homeTeam,
    awayIdentity: ticket.awayIdentity || identityFromName(ticket.awayTeam),
    homeIdentity: ticket.homeIdentity || identityFromName(ticket.homeTeam),
    market: ticket.market,
    period: ticket.period,
    selectedSide: ticket.selectedSide,
    selectedTeam: ticket.selectedTeam,
    executionLine: ticket.executionLine,
    executionPrice: ticket.executionPrice,
    riskAmount: ticket.riskAmount,
    toWinAmount: ticket.toWinAmount,
    potentialPayout: ticket.potentialPayout,
    currency: ticket.currency || "USD",
    importedAt: ticket.importedAt || new Date().toISOString(),
    importSource: ticket.importSource || "heritage-slip",
    rawTextHash: ticket.rawTextHash,
    rawText: ticket.rawText || null,
    matchStatus: ticket.matchStatus,
    matchConfidence: ticket.matchConfidence,
    matchedPredictionId: ticket.matchedPredictionId || attr.matchedPredictionId || null,
    matchedStrategyTicketId: ticket.matchedStrategyTicketId || attr.matchedStrategyTicketId || null,
    recommendationStatus: ticket.recommendationStatus || attr.recommendationStatus || "OPERATOR_ONLY",
    modelVersionAtEntry: ticket.modelVersionAtEntry || attr.modelVersionAtEntry || null,
    checkpointAtEntry: ticket.checkpointAtEntry || attr.checkpointAtEntry || null,
    result: ticket.result || "OPEN",
    settledReturn: ticket.settledReturn ?? null,
    profit: ticket.profit ?? null,
    gradedAt: ticket.gradedAt || null,
    voidReason: ticket.voidReason || null,
    heritageCurrentLine: ticket.heritageCurrentLine ?? clv.heritageCurrent?.line ?? null,
    heritageCurrentPrice: ticket.heritageCurrentPrice ?? clv.heritageCurrent?.price ?? null,
    heritageCurrentAt: ticket.heritageCurrentAt || ticket.executedAt || null,
    pinEntryLine: ticket.pinEntryLine ?? clv.pinEntry?.line ?? null,
    pinEntryPrice: ticket.pinEntryPrice ?? clv.pinEntry?.price ?? null,
    pinEntryNoVig: ticket.pinEntryNoVig ?? clv.pinEntry?.noVig ?? null,
    pinCloseLine: ticket.pinCloseLine ?? clv.pinClose?.line ?? null,
    pinClosePrice: ticket.pinClosePrice ?? clv.pinClose?.price ?? null,
    pinCloseNoVig: ticket.pinCloseNoVig ?? clv.pinClose?.noVig ?? null,
    clv: ticket.clv ?? clv.clv ?? null,
    clvStatus: ticket.clvStatus || clv.clvStatus || "unavailable",
    clvMethodVersion: ticket.clvMethodVersion || clv.clvMethodVersion || HERITAGE_CLV_METHOD,
    attributionLabel: ticket.attributionLabel || attr.label || OPERATOR_ONLY,
  };
}

export function attachMyBetsToBoard(board, bets) {
  const list = bets || [];
  const byGame = new Map();
  for (const b of list) {
    if (!b.gameId) continue;
    const k = String(b.gameId);
    if (!byGame.has(k)) byGame.set(k, []);
    byGame.get(k).push(b);
  }
  const decorate = (g) => {
    const mine = byGame.get(String(g.id)) || [];
    return {
      ...g,
      myBets: mine,
      myBet: mine[0] || null,
    };
  };
  const games = (board.games || []).map(decorate);
  return {
    ...board,
    games,
    groups: (board.groups || []).map((gr) => ({ ...gr, games: (gr.games || []).map(decorate) })),
    counts: {
      ...(board.counts || {}),
      myBets: list.length,
    },
  };
}

export { executedBetId };
