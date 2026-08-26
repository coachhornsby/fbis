const KEY = "fbis-learning-v1";

export const DEFAULT_WEIGHTS = {
  market: 0.4,
  espn: 0.35,
  form: 0.25,
};

const EMPTY = {
  version: 1,
  weights: { ...DEFAULT_WEIGHTS },
  bets: [],
  weightLog: [],
  layerScores: { market: 0, espn: 0, form: 0 },
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(EMPTY),
      ...parsed,
      weights: { ...DEFAULT_WEIGHTS, ...(parsed.weights || {}) },
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
      },
      ...state.bets,
    ],
  };
  saveState(next);
  return next;
}

function americanProfit(odds, stake = 1) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return stake;
  if (n > 0) return (n / 100) * stake;
  return (100 / Math.abs(n)) * stake;
}

function gradeSide(bet, game) {
  if (!game?.status?.completed) return null;
  const hs = Number(game.home.score);
  const as = Number(game.away.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  if (bet.market === "ML") {
    const homeWin = hs > as;
    const won = bet.side === "HOME" ? homeWin : !homeWin;
    if (hs === as) return { result: "PUSH", profit: 0 };
    return { result: won ? "WON" : "LOST", profit: won ? americanProfit(bet.line) : -1 };
  }
  if (bet.market === "SPREAD") {
    const margin = hs - as;
    const line = Number(bet.line);
    const covered = bet.side === "HOME" ? margin + line > 0 : -margin + line > 0;
    const push = bet.side === "HOME" ? margin + line === 0 : -margin + line === 0;
    if (push) return { result: "PUSH", profit: 0 };
    return { result: covered ? "WON" : "LOST", profit: covered ? 0.91 : -1 };
  }
  if (bet.market === "TOTAL") {
    const total = hs + as;
    const line = Number(bet.line);
    const over = total > line;
    const push = total === line;
    if (push) return { result: "PUSH", profit: 0 };
    const won = bet.side === "OVER" ? over : !over;
    return { result: won ? "WON" : "LOST", profit: won ? 0.91 : -1 };
  }
  if (bet.market === "F5 ML") {
    const f5 = game.f5Score;
    if (!f5?.complete) return null;
    if (f5.home === f5.away) return { result: "PUSH", profit: 0 };
    const homeLead = f5.home > f5.away;
    const won = bet.side === "HOME" ? homeLead : !homeLead;
    return { result: won ? "WON" : "LOST", profit: won ? americanProfit(bet.line) : -1 };
  }
  if (bet.market === "F5 TOTAL") {
    const f5 = game.f5Score;
    if (!f5?.complete) return null;
    const total = f5.home + f5.away;
    const line = Number(bet.line);
    const over = total > line;
    const push = total === line;
    if (push) return { result: "PUSH", profit: 0 };
    const won = bet.side === "OVER" ? over : !over;
    return { result: won ? "WON" : "LOST", profit: won ? 0.91 : -1 };
  }
  return null;
}

function closestLayer(bet, game) {
  const layers = game?.model?.layers || {};
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
    const closeHome = game?.model?.impliedHome;
    const clv =
      bet.market === "ML" && closeHome != null
        ? (bet.side === "HOME" ? bet.fair - closeHome : bet.fair - (1 - closeHome)) * 100
        : null;
    return { ...bet, ...graded, gradedAt: new Date().toISOString(), clv, winnerLayer: winner };
  });

  if (!changed) return state;

  // Champion weights do not auto-shift from last night's W/L.
  // Diagnostics (layer hits, CLV) still accumulate for the SYS tab.
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
  const clv = clvBets.length ? clvBets.reduce((s, b) => s + b.clv, 0) / clvBets.length : 0;
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
    winPct: settled.length ? wins / settled.length : 0,
    units,
    clv,
    settled: settled.length,
    curve,
  };
}
