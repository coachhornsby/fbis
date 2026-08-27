/**
 * Bet-selection strategies are NOT forecasting models.
 * A 7-0 night must not rewrite blend weights, logistic k, or qualification gates.
 *
 * FBIS-HC-v1 is the conjunction that actually defines "high-conviction" on this board:
 * a qualified +EV ticket with EV >= 8% (tag CONVICTION). Leans are excluded.
 *
 * The 2026-08-26 seed is the operator-corrected list of 7 CONVICTION picks (not 8).
 * Positions are user-provided. EV/prices are left null when unknown. The seed sample
 * was MLB-heavy overs — that is an observation, not a qualification gate.
 */

import { tagFromEv, americanProfit } from "./pricing.js";

export const STRATEGY_HC_V1_SEED_GRADED_AT = "2026-08-27T05:00:00.000Z";

export const STRATEGY_HC_V1 = {
  id: "FBIS-HC-v1",
  name: "High-conviction qualified",
  version: 1,
  seedRevision: 1,
  seedDate: "2026-08-26",
  reportedRecord: "7-0",
  reconstructionConfidence: "user-provided",
  rules: {
    qualified: true,
    lean: false,
    minEv: 0.08,
    tag: "CONVICTION",
    marketComplete: true,
  },
  seedObservation:
    "The 2026-08-26 seed sample was MLB-heavy overs (5/7 totals at 8.5–9.5, 1 ML, 1 +1.5 RL). That is an observation, not a gate. Prospective tracking remains qualified CONVICTION / EV ≥ 8%.",
  notes:
    "Conjunction: qualified ticket AND EV ≥ 8% (CONVICTION). Not a lean. Complete two-way Pinnacle market. Champion weights stay frozen. N=7 is a sample, not proof the filter works.",
};

/** Operator-named 2026-08-26 CONVICTION positions. Matchups from MLB Stats finals. */
export const STRATEGY_HC_V1_SEED_SPEC = [
  {
    pick: "Tampa Bay ML",
    gameId: "824234",
    matchup: "TB @ DET",
    market: "ML",
    side: "AWAY",
    line: null,
    actualHome: 0,
    actualAway: 3,
  },
  {
    pick: "Col/Wash over 9.5",
    gameId: "822692",
    matchup: "COL @ WSH",
    market: "TOTAL",
    side: "OVER",
    line: 9.5,
    actualHome: 1,
    actualAway: 13,
  },
  {
    pick: "Hou/NYY over 9",
    gameId: "823506",
    matchup: "HOU @ NYY",
    market: "TOTAL",
    side: "OVER",
    line: 9,
    actualHome: 9,
    actualAway: 3,
  },
  {
    pick: "MIL/NYM over 8.5",
    gameId: "823584",
    matchup: "MIL @ NYM",
    market: "TOTAL",
    side: "OVER",
    line: 8.5,
    actualHome: 1,
    actualAway: 8,
  },
  {
    pick: "LAD/ATL over 8.5",
    gameId: "824878",
    matchup: "LAD @ ATL",
    market: "TOTAL",
    side: "OVER",
    line: 8.5,
    actualHome: 6,
    actualAway: 5,
  },
  {
    pick: "BAL/STL over 8.5",
    gameId: "823015",
    matchup: "BAL @ STL",
    market: "TOTAL",
    side: "OVER",
    line: 8.5,
    actualHome: 7,
    actualAway: 8,
  },
  {
    pick: "OAK +1.5",
    gameId: "824963",
    matchup: "MIN @ ATH",
    market: "SPREAD",
    side: "HOME",
    line: 1.5,
    actualHome: 7,
    actualAway: 4,
  },
];

export function dateCT(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function inSeedWindow(iso, seedDate = STRATEGY_HC_V1.seedDate) {
  const d = dateCT(iso);
  return d === seedDate;
}

export function ticketEv(ticket) {
  if (ticket?.ev != null && Number.isFinite(Number(ticket.ev))) return Number(ticket.ev);
  if (ticket?.evPct != null && Number.isFinite(Number(ticket.evPct))) return Number(ticket.evPct) / 100;
  return null;
}

export function ticketMatchesStrategy(ticket, strategy = STRATEGY_HC_V1) {
  if (!ticket) return false;
  if (ticket.qualified !== true && ticket.qualified !== 1) return false;
  if (ticket.lean === true) return false;
  if (ticket.marketComplete === false) return false;
  const ev = ticketEv(ticket);
  if (ev == null || ev < strategy.rules.minEv) return false;
  const tag = ticket.tag || tagFromEv(ev);
  if (strategy.rules.tag && tag !== strategy.rules.tag) return false;
  return true;
}

export function ticketId(ticket, date) {
  const day = date || ticket.date || dateCT(ticket.loggedAt) || "";
  return `${ticket.sport || ""}:${day}:${ticket.gameId}:${ticket.market}:${ticket.side}`;
}

export function characterizeTickets(tickets) {
  const xs = tickets || [];
  const n = xs.length;
  const count = (fn) => xs.filter(fn).length;
  const share = (fn) => (n ? count(fn) / n : null);
  const nums = (fn) => xs.map(fn).filter((v) => v != null && Number.isFinite(v));
  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  return {
    n,
    sports: tally(xs.map((t) => t.sport)),
    markets: tally(xs.map((t) => t.market)),
    sides: tally(xs.map((t) => t.side)),
    tags: tally(xs.map((t) => t.tag)),
    modelVersions: tally(xs.map((t) => t.modelVersion)),
    checkpoints: tally(xs.map((t) => t.checkpoint)),
    favoriteShare: share((t) => Number(t.fair ?? t.implied ?? 0) >= 0.5),
    homeShare: share((t) => t.side === "HOME"),
    overShare: share((t) => t.side === "OVER"),
    avgEv: mean(nums((t) => ticketEv(t))),
    avgEdge: mean(nums((t) => Number(t.edge ?? t.probEdge))),
    avgPinVig: mean(nums((t) => Number(t.pinVig))),
    avgDataQuality: mean(nums((t) => Number(t.dataQuality))),
  };
}

function tally(values) {
  const m = {};
  for (const v of values) {
    const k = v == null || v === "" ? "(none)" : String(v);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

export function strategyStats(tickets) {
  const xs = tickets || [];
  const settled = xs.filter((t) => t.result === "WON" || t.result === "LOST");
  const wins = settled.filter((t) => t.result === "WON").length;
  const losses = settled.filter((t) => t.result === "LOST").length;
  const profits = xs.map((t) => Number(t.profit) || 0);
  const roi = settled.length ? profits.reduce((s, p) => s + p, 0) / settled.length : null;
  const clvs = xs.map((t) => Number(t.clv)).filter((v) => Number.isFinite(v));
  const evs = settled.map((t) => ticketEv(t)).filter((v) => v != null);
  const realized = settled.length ? wins / settled.length : null;
  let peak = 0;
  let eq = 0;
  let maxDd = 0;
  for (const p of [...xs].sort((a, b) => String(a.gradedAt || a.loggedAt || "").localeCompare(String(b.gradedAt || b.loggedAt || "")))) {
    if (p.result === "OPEN" || !p.result) continue;
    eq += Number(p.profit) || 0;
    if (eq > peak) peak = eq;
    maxDd = Math.min(maxDd, eq - peak);
  }
  return {
    n: xs.length,
    open: xs.filter((t) => t.result === "OPEN" || !t.result).length,
    settled: settled.length,
    wins,
    losses,
    hitRate: settled.length ? wins / settled.length : null,
    roi,
    avgClv: clvs.length ? clvs.reduce((s, v) => s + v, 0) / clvs.length : null,
    avgEv: evs.length ? evs.reduce((s, v) => s + v, 0) / evs.length : null,
    realized,
    evVsRealized: evs.length && realized != null ? realized - evs.reduce((s, v) => s + v, 0) / evs.length : null,
    drawdown: maxDd,
    units: profits.reduce((s, p) => s + p, 0),
  };
}

export function packTicket(ticket, { role, date, strategyId = STRATEGY_HC_V1.id } = {}) {
  const ev = ticketEv(ticket);
  const day = date || ticket.date || dateCT(ticket.loggedAt);
  return {
    id: ticketId(ticket, day),
    strategyId,
    role: role || "prospective",
    sport: ticket.sport || null,
    date: day,
    gameId: String(ticket.gameId || ticket.id || ""),
    matchup: ticket.matchup || null,
    market: ticket.market || null,
    side: ticket.side || null,
    pick: ticket.pick || null,
    line: ticket.line ?? null,
    ev,
    edge: ticket.edge ?? ticket.probEdge ?? null,
    tag: ticket.tag || tagFromEv(ev),
    pinVig: ticket.pinVig ?? null,
    pinPrice: ticket.pinPrice ?? ticket.line ?? null,
    modelVersion: ticket.modelVersion || null,
    checkpoint: ticket.checkpoint || null,
    dataQuality: ticket.dataQuality ?? null,
    result: ticket.result || "OPEN",
    profit: ticket.profit ?? null,
    clv: ticket.clv ?? null,
    fair: ticket.fair ?? null,
    implied: ticket.implied ?? ticket.entryNoVig ?? null,
    traitsJson: JSON.stringify({
      homeAway: ticket.side === "HOME" || ticket.side === "AWAY" ? ticket.side : null,
      overUnder: ticket.side === "OVER" || ticket.side === "UNDER" ? ticket.side : null,
      favorite: ticket.fair != null ? ticket.fair >= 0.5 : null,
    }),
  };
}

export function gradeStrategyResult(ticket, game) {
  if (!game) return null;
  const hs = Number(game.home?.score);
  const as = Number(game.away?.score);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  if (!game.status?.completed && game.status?.completed !== undefined) return null;
  const odds = ticket.pinPrice ?? (ticket.market === "ML" || ticket.market === "F5 ML" ? ticket.line : ticket.pinPrice);
  const payout = americanProfit(odds, 1);
  const now = new Date().toISOString();
  if (ticket.market === "ML") {
    if (hs === as) return { result: "PUSH", profit: 0, gradedAt: now };
    const won = ticket.side === "HOME" ? hs > as : as > hs;
    return { result: won ? "WON" : "LOST", profit: payout == null ? null : won ? payout : -1, gradedAt: now };
  }
  if (ticket.market === "SPREAD") {
    const line = Number(ticket.line);
    const cover = ticket.side === "HOME" ? hs - as + line : as - hs + line;
    if (cover === 0) return { result: "PUSH", profit: 0, gradedAt: now };
    const won = cover > 0;
    return { result: won ? "WON" : "LOST", profit: payout == null ? null : won ? payout : -1, gradedAt: now };
  }
  if (ticket.market === "TOTAL") {
    const total = hs + as;
    const line = Number(ticket.line);
    if (total === line) return { result: "PUSH", profit: 0, gradedAt: now };
    const over = total > line;
    const won = ticket.side === "OVER" ? over : !over;
    return { result: won ? "WON" : "LOST", profit: payout == null ? null : won ? payout : -1, gradedAt: now };
  }
  return null;
}

export function buildHcV1SeedTicket(spec) {
  const packed = {
    ...packTicket(
      {
        sport: "mlb",
        date: STRATEGY_HC_V1.seedDate,
        gameId: spec.gameId,
        matchup: spec.matchup,
        market: spec.market,
        side: spec.side,
        pick: spec.pick,
        line: spec.line,
        tag: "CONVICTION",
        qualified: true,
        lean: false,
        marketComplete: true,
        ev: null,
        edge: null,
        pinVig: null,
        pinPrice: null,
        modelVersion: null,
        checkpoint: null,
        dataQuality: null,
        fair: null,
        implied: null,
      },
      { role: "seed", date: STRATEGY_HC_V1.seedDate }
    ),
    ev: null,
    edge: null,
    pinVig: null,
    pinPrice: null,
    modelVersion: null,
    checkpoint: null,
    dataQuality: null,
    fair: null,
    implied: null,
  };
  const completed = spec.actualHome != null && spec.actualAway != null;
  const graded = completed
    ? gradeStrategyResult(packed, {
        home: { score: spec.actualHome },
        away: { score: spec.actualAway },
        status: { completed: true },
      })
    : null;
  const traits = {
    namedPosition: spec.pick,
    reconstruction: "user-provided",
    actualHome: spec.actualHome ?? null,
    actualAway: spec.actualAway ?? null,
    homeAway: packed.side === "HOME" || packed.side === "AWAY" ? packed.side : null,
    overUnder: packed.side === "OVER" || packed.side === "UNDER" ? packed.side : null,
    favorite: null,
  };
  return {
    ...packed,
    ev: null,
    edge: null,
    pinVig: null,
    pinPrice: null,
    modelVersion: null,
    checkpoint: null,
    dataQuality: null,
    fair: null,
    implied: null,
    result: graded?.result || "OPEN",
    profit: graded?.profit ?? null,
    clv: null,
    gradedAt: graded ? STRATEGY_HC_V1_SEED_GRADED_AT : null,
    traitsJson: JSON.stringify(traits),
  };
}

export const STRATEGY_HC_V1_SEED_TICKETS = STRATEGY_HC_V1_SEED_SPEC.map(buildHcV1SeedTicket);

export const STRATEGY_HC_V1_SEED_IDS = new Set(STRATEGY_HC_V1_SEED_TICKETS.map((t) => t.id));

export function isCanonicalSeedId(id) {
  return STRATEGY_HC_V1_SEED_IDS.has(String(id || ""));
}

export function presentStrategyTicket(t) {
  if (!t) return t;
  let traits = t.traits;
  if (!traits && t.traitsJson) {
    try {
      traits = JSON.parse(t.traitsJson);
    } catch {
      traits = {};
    }
  }
  return {
    id: t.id,
    strategyId: t.strategyId || t.strategy_id || STRATEGY_HC_V1.id,
    role: t.role || "seed",
    sport: t.sport || null,
    date: t.date,
    gameId: t.gameId || t.game_id || null,
    matchup: t.matchup || null,
    market: t.market || null,
    side: t.side || null,
    pick: t.pick || null,
    line: t.line ?? null,
    ev: t.ev ?? null,
    edge: t.edge ?? null,
    tag: t.tag || "CONVICTION",
    pinVig: t.pinVig ?? t.pin_vig ?? null,
    pinPrice: t.pinPrice ?? t.pin_price ?? null,
    modelVersion: t.modelVersion || t.model_version || null,
    checkpoint: t.checkpoint || null,
    dataQuality: t.dataQuality ?? t.data_quality ?? null,
    result: t.result || "OPEN",
    profit: t.profit ?? null,
    clv: t.clv ?? null,
    fair: t.fair ?? null,
    implied: t.implied ?? null,
    traits: traits || {},
    createdAt: t.createdAt || t.created_at || null,
    gradedAt: t.gradedAt || t.graded_at || null,
  };
}

export function canonicalSeedTickets(dbRows = []) {
  const byId = new Map((dbRows || []).map((r) => [r.id, r]));
  return STRATEGY_HC_V1_SEED_TICKETS.map((seed) => {
    const row = byId.get(seed.id);
    const presented = presentStrategyTicket(seed);
    if (!row) return presented;
    const merged = presentStrategyTicket({ ...seed, ...row, pick: seed.pick, matchup: row.matchup || seed.matchup });
    if (!merged.result || merged.result === "OPEN") {
      return { ...merged, result: presented.result, profit: presented.profit ?? merged.profit, gradedAt: presented.gradedAt || merged.gradedAt };
    }
    return merged;
  });
}

export function strategyReconstruction() {
  return {
    confidence: "user-provided",
    n: STRATEGY_HC_V1_SEED_TICKETS.length,
    note: "Operator-corrected 2026-08-26 CONVICTION cohort (N=7). Immutable seed. MLB-heavy overs in the sample is an observation, not a gate.",
  };
}
