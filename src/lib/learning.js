import { DEFAULT_WEIGHTS as CHAMPION_WEIGHTS } from "../../functions/lib/weights.js";
import { probabilityClv } from "../../functions/lib/pricing.js";
import { americanPriceOrNull, gradeStrategyResult } from "../../functions/lib/strategy.js";

const KEY = "fbis-learning-v1";

export const DEFAULT_WEIGHTS = { ...CHAMPION_WEIGHTS };

const EMPTY = {
  version: 2,
  weights: { ...DEFAULT_WEIGHTS },
  bets: [],
  weightLog: [],
  layerScores: { market: 0, espn: 0, score: 0, pal: 0, form: 0 },
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    const legacy = parsed.weights && parsed.weights.score == null;
    return {
      ...structuredClone(EMPTY),
      ...parsed,
      weights: { ...DEFAULT_WEIGHTS },
      bets: Array.isArray(parsed.bets) ? parsed.bets : [],
      weightLog: Array.isArray(parsed.weightLog) ? parsed.weightLog : [],
      layerScores: { ...EMPTY.layerScores, ...(parsed.layerScores || {}) },
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function betKey(bet) {
  return `${bet.sport}:${bet.gameId}:${bet.market}:${bet.side}`;
}

export function logBet(state, bet) {
  const id = betKey(bet);
  if (state.bets.some((b) => betKey(b) === id && b.result === "OPEN")) return state;
  const next = {
    ...state,
    bets: [
      {
        ...bet,
        id,
        loggedAt: new Date().toISOString(),
        result: "OPEN",
        profit: 0,
        clv: null,
        executionBook: bet.executionBook || "Heritage",
        benchmarkBook: bet.benchmarkBook || "Pinnacle",
        executionPrice: bet.executionPrice ?? null,
        pinPrice: bet.pinPrice ?? null,
        entryNoVig: bet.entryNoVig ?? bet.implied ?? null,
        entryAmerican: bet.entryAmerican ?? bet.pinPrice ?? null,
        stake: bet.stake ?? 1,
      },
      ...state.bets,
    ],
  };
  saveState(next);
  return next;
}

function ticketOdds(bet) {
  if (bet.executionPrice != null) return americanPriceOrNull(bet.executionPrice);
  if (bet.pinPrice != null) return americanPriceOrNull(bet.pinPrice);
  if (bet.entryAmerican != null) return americanPriceOrNull(bet.entryAmerican);
  if (bet.market === "ML" || bet.market === "F5 ML") return americanPriceOrNull(bet.line);
  return null;
}

function gradeSide(bet, game) {
  return gradeStrategyResult(
    {
      ...bet,
      executionPrice: ticketOdds(bet),
      executionLine: bet.line,
      stake: bet.stake ?? 1,
    },
    game
  );
}

function closeNoVig(bet, game) {
  const pin = game?.pin;
  if (bet.market === "ML") {
    if (bet.side === "HOME") return pin?.ml?.noVigA ?? game?.model?.impliedHome ?? null;
    return pin?.ml?.noVigB ?? (game?.model?.impliedHome != null ? 1 - game.model.impliedHome : null);
  }
  if (bet.market === "SPREAD") {
    return bet.side === "HOME" ? pin?.spread?.noVigA ?? null : pin?.spread?.noVigB ?? null;
  }
  if (bet.market === "TOTAL") {
    return bet.side === "OVER" ? pin?.total?.noVigA ?? null : pin?.total?.noVigB ?? null;
  }
  if (bet.market === "F5 ML") {
    return bet.side === "HOME" ? pin?.f5ml?.noVigA ?? null : pin?.f5ml?.noVigB ?? null;
  }
  if (bet.market === "F5 TOTAL") {
    return bet.side === "OVER" ? pin?.f5total?.noVigA ?? null : pin?.f5total?.noVigB ?? null;
  }
  return null;
}

function closestLayer(bet, game) {
  const layers = bet.layers || game?.model?.layers || {};
  const actualHome = Number(game.home.score) > Number(game.away.score) ? 1 : 0;
  let best = null;
  let bestErr = Infinity;
  for (const [name, p] of Object.entries(layers)) {
    if (p == null) continue;
    const err = Math.abs(p - actualHome);
    if (err < bestErr) {
      bestErr = err;
      best = name;
    }
  }
  return best;
}

export function gradeOpenBets(state, games) {
  const byId = new Map(games.map((g) => [g.id, g]));
  let changed = false;
  const layerScores = { ...state.layerScores };
  const bets = state.bets.map((bet) => {
    if (bet.result !== "OPEN") return bet;
    const game = byId.get(bet.gameId);
    const graded = gradeSide(bet, game);
    if (!graded) return bet;
    changed = true;
    const winner = closestLayer(bet, game);
    if (winner) layerScores[winner] = (layerScores[winner] || 0) + 1;
    const close = closeNoVig(bet, game);
    const clv = close != null ? probabilityClv(bet.entryNoVig ?? bet.implied, close) : bet.clv;
    return { ...bet, ...graded, gradedAt: new Date().toISOString(), clv, closeNoVig: close, winnerLayer: winner };
  });

  if (!changed) return state;

  const next = { ...state, bets, layerScores };
  saveState(next);
  return next;
}

export function summarize(state, sport) {
  const bets = sport ? state.bets.filter((b) => b.sport === sport) : state.bets;
  const settled = bets.filter((b) => b.result === "WON" || b.result === "LOST");
  const wins = settled.filter((b) => b.result === "WON").length;
  const losses = settled.filter((b) => b.result === "LOST").length;
  const units = bets.reduce((s, b) => s + (b.profit || 0), 0);
  const clvBets = bets.filter((b) => b.clv != null);
  const clv = clvBets.length ? clvBets.reduce((s, b) => s + b.clv, 0) / clvBets.length : null;
  const curve = [];
  let running = 0;
  [...bets].reverse().forEach((b) => {
    if (b.result === "OPEN") return;
    running += b.profit || 0;
    curve.push({ t: b.gradedAt || b.loggedAt, y: running, result: b.result });
  });
  return {
    open: bets.filter((b) => b.result === "OPEN").length,
    wins,
    losses,
    winPct: settled.length ? wins / settled.length : null,
    units,
    clv,
    settled: settled.length,
    curve,
  };
}
