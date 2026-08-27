/**
 * Bet-selection strategies are NOT forecasting models.
 * A 7-0 night must not rewrite blend weights, logistic k, or qualification gates.
 *
 * FBIS-HC-v1 is a strategy cohort (conjunction), not a model version:
 * a qualified +EV ticket with EV >= 8% (tag CONVICTION). Leans are excluded.
 *
 * The 2026-08-26 seed names are operator-declared identity, not a recovered journal.
 * EV / prices / qualification timestamps stay null until the browser journal is imported.
 * The seed sample was MLB-heavy overs — that is an observation, not a qualification gate.
 */

import { tagFromEv, americanProfit, probabilityClv } from "./pricing.js";

export const STRATEGY_HC_V1_SEED_GRADED_AT = "2026-08-27T05:00:00.000Z";
export const EXPECTED_SEED_N = 7;
export const LINE_MARKETS = new Set(["SPREAD", "TOTAL", "F5 SPREAD", "F5 TOTAL"]);
export const STRATEGY_MARKETS = new Set(["ML", "SPREAD", "TOTAL", "F5 ML", "F5 SPREAD", "F5 TOTAL"]);

export const STRATEGY_HC_V1 = {
  id: "FBIS-HC-v1",
  name: "High-conviction qualified",
  version: 1,
  seedRevision: 1,
  seedDate: "2026-08-26",
  reportedRecord: "7-0",
  reconstructionConfidence: "operator-declared",
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
    "Conjunction: qualified ticket AND EV ≥ 8% (CONVICTION). Not a lean. Complete two-way Pinnacle market. Champion weights stay frozen. N=7 is a sample, not proof the filter works. FBIS-HC-v1 is a strategy cohort, not a model version.",
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
  const day = date || ticket.date || dateCT(ticket.qualifiedAt || ticket.loggedAt) || "";
  return `${ticket.sport || ""}:${day}:${ticket.gameId || ticket.game_id}:${ticket.market}:${ticket.side}`;
}

export function requiresLine(market) {
  return LINE_MARKETS.has(String(market || ""));
}

/** American odds only. Never treat a spread/total point (8.5, +1.5, -3.5) as a price. */
export function americanPriceOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  if (Math.abs(n) < 100) return null;
  return n;
}

function finiteOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    favoriteShare: share((t) => {
      const p = t.fair ?? t.implied;
      return p != null && Number(p) >= 0.5;
    }),
    homeShare: share((t) => t.side === "HOME"),
    overShare: share((t) => t.side === "OVER"),
    avgEv: mean(nums((t) => ticketEv(t))),
    avgEdge: mean(nums((t) => finiteOrNull(t.edge ?? t.probEdge))),
    avgPinVig: mean(nums((t) => finiteOrNull(t.pinVig))),
    avgDataQuality: mean(nums((t) => finiteOrNull(t.dataQuality))),
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
  const pushes = xs.filter((t) => t.result === "PUSH").length;
  const profits = xs.map((t) => finiteOrNull(t.profit)).filter((v) => v != null);
  const settledWithProfit = settled.filter((t) => finiteOrNull(t.profit) != null);
  const roi =
    settledWithProfit.length != null && settledWithProfit.length
      ? settledWithProfit.reduce((s, t) => s + Number(t.profit), 0) / settledWithProfit.length
      : null;
  const clvs = xs.map((t) => finiteOrNull(t.clv)).filter((v) => v != null);
  const evs = settled.map((t) => ticketEv(t)).filter((v) => v != null);
  const realized = settled.length ? wins / settled.length : null;
  let peak = 0;
  let eq = 0;
  let maxDd = 0;
  for (const p of [...xs].sort((a, b) =>
    String(a.gradedAt || a.loggedAt || a.qualifiedAt || "").localeCompare(String(b.gradedAt || b.loggedAt || b.qualifiedAt || ""))
  )) {
    if (p.result === "OPEN" || !p.result) continue;
    const profit = finiteOrNull(p.profit);
    if (profit == null) continue;
    eq += profit;
    if (eq > peak) peak = eq;
    maxDd = Math.min(maxDd, eq - peak);
  }
  return {
    n: xs.length,
    open: xs.filter((t) => t.result === "OPEN" || !t.result).length,
    settled: settled.length,
    wins,
    losses,
    pushes,
    hitRate: settled.length ? wins / settled.length : null,
    roi,
    roiN: settledWithProfit.length,
    avgClv: clvs.length ? clvs.reduce((s, v) => s + v, 0) / clvs.length : null,
    clvN: clvs.length,
    avgEv: evs.length ? evs.reduce((s, v) => s + v, 0) / evs.length : null,
    evN: evs.length,
    realized,
    evVsRealized: evs.length && realized != null ? realized - evs.reduce((s, v) => s + v, 0) / evs.length : null,
    drawdown: profits.length ? maxDd : null,
    units: profits.length ? profits.reduce((s, p) => s + p, 0) : null,
    gradedRecord: settled.length ? `${wins}-${losses}` : null,
    missingExecutionPrice: xs.filter((t) => t.missingExecutionPrice).length,
  };
}

export function packTicket(ticket, { role, date, strategyId = STRATEGY_HC_V1.id } = {}) {
  const ev = ticketEv(ticket);
  const day = date || ticket.date || dateCT(ticket.qualifiedAt || ticket.loggedAt);
  const market = ticket.market || null;
  const executionPrice = americanPriceOrNull(ticket.executionPrice ?? ticket.execution_price);
  const benchmarkPrice = americanPriceOrNull(
    ticket.benchmarkPrice ?? ticket.benchmark_price ?? ticket.pinPrice ?? ticket.pin_price
  );
  const pinPrice = executionPrice ?? benchmarkPrice;
  const entryNoVig = finiteOrNull(ticket.entryNoVig ?? ticket.entry_no_vig ?? ticket.implied);
  const closingNoVig = finiteOrNull(ticket.closingNoVig ?? ticket.closing_no_vig ?? ticket.closeNoVig);
  const rawPoint = requiresLine(market)
    ? finiteOrNull(ticket.executionLine ?? ticket.execution_line ?? ticket.line)
    : null;
  const pointLine = rawPoint != null && Math.abs(rawPoint) < 100 ? rawPoint : null;
  const missingExecutionPrice = executionPrice == null;
  return {
    id: ticket.id || ticketId(ticket, day),
    strategyId,
    role: role || "prospective",
    sport: ticket.sport || null,
    date: day,
    gameId: String(ticket.gameId || ticket.game_id || ticket.id || ""),
    matchup: ticket.matchup || null,
    market,
    side: ticket.side || null,
    pick: ticket.pick || null,
    line: pointLine,
    ev,
    edge: ticket.edge ?? ticket.probEdge ?? null,
    tag: ticket.tag || tagFromEv(ev),
    pinVig: ticket.pinVig ?? ticket.pin_vig ?? null,
    pinPrice,
    executionLine: pointLine,
    executionPrice,
    benchmarkLine: pointLine,
    benchmarkPrice,
    entryNoVig,
    closingLine: ticket.closingLine ?? ticket.closing_line ?? null,
    closingPrice: americanPriceOrNull(ticket.closingPrice ?? ticket.closing_price),
    closingNoVig,
    stake: finiteOrNull(ticket.stake) ?? 1,
    missingExecutionPrice,
    qualifiedAt: ticket.qualifiedAt || ticket.loggedAt || ticket.qualificationTimestamp || null,
    modelVersion: ticket.modelVersion || ticket.model_version || null,
    checkpoint: ticket.checkpoint || null,
    dataQuality: ticket.dataQuality ?? ticket.data_quality ?? null,
    result: ticket.result || "OPEN",
    profit: ticket.profit ?? null,
    clv: ticket.clv ?? null,
    fair: ticket.fair ?? null,
    implied: entryNoVig,
    traitsJson:
      ticket.traitsJson ||
      JSON.stringify({
        homeAway: ticket.side === "HOME" || ticket.side === "AWAY" ? ticket.side : null,
        overUnder: ticket.side === "OVER" || ticket.side === "UNDER" ? ticket.side : null,
        favorite: ticket.fair != null ? ticket.fair >= 0.5 : null,
        missingExecutionPrice,
      }),
  };
}

function fgScores(game) {
  const hs = Number(game?.home?.score ?? game?.actualHome);
  const as = Number(game?.away?.score ?? game?.actualAway);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  return { hs, as };
}

function f5Scores(game) {
  if (game?.f5Score?.complete) {
    const hs = Number(game.f5Score.home);
    const as = Number(game.f5Score.away);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
    return { hs, as };
  }
  if (game?.f5ActualHome == null || game?.f5ActualAway == null) return null;
  const hs = Number(game.f5ActualHome);
  const as = Number(game.f5ActualAway);
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  return { hs, as };
}

function isF5Market(market) {
  return String(market || "").startsWith("F5");
}

function clvFromTicket(ticket, game) {
  const entry = finiteOrNull(ticket.entryNoVig ?? ticket.implied);
  const close =
    finiteOrNull(ticket.closingNoVig) ??
    closeNoVigFromGame(ticket, game);
  return probabilityClv(entry, close);
}

function closeNoVigFromGame(ticket, game) {
  const pin = game?.pin;
  if (!pin) return null;
  if (ticket.market === "ML") {
    return ticket.side === "HOME" ? pin.ml?.noVigA ?? null : pin.ml?.noVigB ?? null;
  }
  if (ticket.market === "SPREAD") {
    return ticket.side === "HOME" ? pin.spread?.noVigA ?? null : pin.spread?.noVigB ?? null;
  }
  if (ticket.market === "TOTAL") {
    return ticket.side === "OVER" ? pin.total?.noVigA ?? null : pin.total?.noVigB ?? null;
  }
  if (ticket.market === "F5 ML") {
    return ticket.side === "HOME" ? pin.f5ml?.noVigA ?? null : pin.f5ml?.noVigB ?? null;
  }
  if (ticket.market === "F5 TOTAL") {
    return ticket.side === "OVER" ? pin.f5total?.noVigA ?? null : pin.f5total?.noVigB ?? null;
  }
  if (ticket.market === "F5 SPREAD") {
    return ticket.side === "HOME" ? pin.f5spread?.noVigA ?? null : pin.f5spread?.noVigB ?? null;
  }
  return null;
}

export function gradeStrategyResult(ticket, game) {
  if (!game) return null;
  if (!game.status?.completed && game.status?.completed !== undefined && !isF5Market(ticket.market)) {
    if (fgScores(game) == null) return null;
  }
  const scores = isF5Market(ticket.market) ? f5Scores(game) : fgScores(game);
  if (!scores) return null;
  const { hs, as } = scores;
  const price = americanPriceOrNull(ticket.executionPrice ?? ticket.execution_price ?? ticket.pinPrice);
  const stake = finiteOrNull(ticket.stake) ?? 1;
  const payout = price != null ? americanProfit(price, stake) : null;
  const missingExecutionPrice = price == null;
  const profitFor = (won) => {
    if (missingExecutionPrice) return null;
    return won ? payout : -stake;
  };
  const now = new Date().toISOString();
  const clv = clvFromTicket(ticket, game);
  const wrap = (result, won) => ({
    result,
    profit: result === "PUSH" ? (missingExecutionPrice ? null : 0) : profitFor(won),
    clv,
    missingExecutionPrice,
    gradedAt: now,
  });

  const market = ticket.market;
  if (market === "ML" || market === "F5 ML") {
    if (hs === as) return wrap("PUSH", false);
    const won = ticket.side === "HOME" ? hs > as : as > hs;
    return wrap(won ? "WON" : "LOST", won);
  }
  if (market === "SPREAD" || market === "F5 SPREAD") {
    const line = Number(ticket.executionLine ?? ticket.line);
    if (!Number.isFinite(line)) return null;
    const cover = ticket.side === "HOME" ? hs - as + line : as - hs + line;
    if (cover === 0) return wrap("PUSH", false);
    const won = cover > 0;
    return wrap(won ? "WON" : "LOST", won);
  }
  if (market === "TOTAL" || market === "F5 TOTAL") {
    const line = Number(ticket.executionLine ?? ticket.line);
    if (!Number.isFinite(line)) return null;
    const total = hs + as;
    if (total === line) return wrap("PUSH", false);
    const over = total > line;
    const won = ticket.side === "OVER" ? over : !over;
    return wrap(won ? "WON" : "LOST", won);
  }
  return null;
}

export function buildHcV1SeedTicket(spec) {
  const packed = packTicket(
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
      executionPrice: null,
      modelVersion: null,
      checkpoint: null,
      dataQuality: null,
      fair: null,
      implied: null,
    },
    { role: "seed", date: STRATEGY_HC_V1.seedDate }
  );
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
    reconstruction: "operator-declared",
    actualHome: spec.actualHome ?? null,
    actualAway: spec.actualAway ?? null,
    homeAway: packed.side === "HOME" || packed.side === "AWAY" ? packed.side : null,
    overUnder: packed.side === "OVER" || packed.side === "UNDER" ? packed.side : null,
    favorite: null,
    missingExecutionPrice: true,
  };
  return {
    ...packed,
    ev: null,
    edge: null,
    pinVig: null,
    pinPrice: null,
    executionPrice: null,
    modelVersion: null,
    checkpoint: null,
    dataQuality: null,
    fair: null,
    implied: null,
    qualifiedAt: null,
    result: graded?.result || "OPEN",
    profit: null,
    clv: null,
    missingExecutionPrice: true,
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
  const executionPrice = americanPriceOrNull(t.executionPrice ?? t.execution_price ?? t.pinPrice ?? t.pin_price);
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
    line: t.line ?? t.executionLine ?? t.execution_line ?? null,
    ev: t.ev ?? null,
    edge: t.edge ?? null,
    tag: t.tag || "CONVICTION",
    pinVig: t.pinVig ?? t.pin_vig ?? null,
    pinPrice: executionPrice,
    executionLine: t.executionLine ?? t.execution_line ?? t.line ?? null,
    executionPrice,
    benchmarkLine: t.benchmarkLine ?? t.benchmark_line ?? t.line ?? null,
    benchmarkPrice: americanPriceOrNull(t.benchmarkPrice ?? t.benchmark_price ?? t.pinPrice ?? t.pin_price),
    entryNoVig: t.entryNoVig ?? t.entry_no_vig ?? t.implied ?? null,
    closingLine: t.closingLine ?? t.closing_line ?? null,
    closingPrice: americanPriceOrNull(t.closingPrice ?? t.closing_price),
    closingNoVig: t.closingNoVig ?? t.closing_no_vig ?? null,
    stake: t.stake ?? 1,
    missingExecutionPrice: executionPrice == null,
    qualifiedAt: t.qualifiedAt || t.qualified_at || t.loggedAt || null,
    modelVersion: t.modelVersion || t.model_version || null,
    checkpoint: t.checkpoint || null,
    dataQuality: t.dataQuality ?? t.data_quality ?? null,
    result: t.result || "OPEN",
    profit: t.profit ?? null,
    clv: t.clv ?? null,
    fair: t.fair ?? null,
    implied: t.implied ?? t.entryNoVig ?? t.entry_no_vig ?? null,
    traits: traits || {},
    createdAt: t.createdAt || t.created_at || null,
    gradedAt: t.gradedAt || t.graded_at || null,
  };
}

export function hasJournalGradeFields(t) {
  if (!t) return false;
  const gameId = t.gameId || t.game_id;
  if (!gameId) return false;
  if (!t.sport || !t.market || !t.side) return false;
  if (!STRATEGY_MARKETS.has(String(t.market))) return false;
  if (requiresLine(t.market) && t.line == null && t.executionLine == null) return false;
  if (ticketEv(t) == null) return false;
  if (!(t.qualifiedAt || t.qualified_at || t.loggedAt)) return false;
  if (!(t.modelVersion || t.model_version)) return false;
  return true;
}

export function canonicalSeedTickets(dbRows = []) {
  const byId = new Map((dbRows || []).map((r) => [r.id, r]));
  return STRATEGY_HC_V1_SEED_TICKETS.map((seed) => {
    const row = byId.get(seed.id);
    const presented = presentStrategyTicket(seed);
    if (!row) return presented;
    const merged = presentStrategyTicket({
      ...seed,
      ...row,
      pick: seed.pick,
      matchup: row.matchup || seed.matchup,
    });
    if (!merged.result || merged.result === "OPEN") {
      return {
        ...merged,
        result: presented.result,
        profit: presented.profit ?? merged.profit,
        gradedAt: presented.gradedAt || merged.gradedAt,
        missingExecutionPrice: true,
      };
    }
    return { ...merged, missingExecutionPrice: merged.executionPrice == null };
  });
}

function invalidResultPattern(tickets) {
  return (tickets || []).some((t) => t.result && !["OPEN", "WON", "LOST", "PUSH"].includes(t.result));
}

/**
 * Ticket count and graded record are separate.
 * recovered does not mean graded 7-0.
 * Operator-declared names are not journal-recovered.
 */
export function strategyReconstruction(seedTickets = []) {
  const named = STRATEGY_HC_V1_SEED_TICKETS;
  const rows = (seedTickets || []).map(presentStrategyTicket);
  const unique = new Map();
  for (const t of rows) unique.set(t.id, t);
  const distinct = [...unique.values()];
  const extras = distinct.filter((t) => !isCanonicalSeedId(t.id));
  const journal = distinct.filter((t) => isCanonicalSeedId(t.id) && hasJournalGradeFields(t));
  const recoveredN = journal.length;
  const seedN = distinct.length;
  const stats = strategyStats(named.map((t) => presentStrategyTicket(t)));
  const gradedFromNamed = strategyStats(canonicalSeedTickets(rows));

  let state = "unrecovered";
  let note =
    "Operator-declared 2026-08-26 CONVICTION names exist in-repo. Journal EV, prices, and qualification timestamps are unrecovered until exact journal tickets are imported.";

  if (seedN > EXPECTED_SEED_N || extras.length > 0 || invalidResultPattern(distinct)) {
    state = "conflict";
    note =
      seedN > EXPECTED_SEED_N
        ? `Integrity conflict: seed N=${seedN} exceeds expected ${EXPECTED_SEED_N}.`
        : extras.length
          ? "Integrity conflict: non-canonical seed ids present."
          : "Integrity conflict: invalid result pattern.";
  } else if (recoveredN === EXPECTED_SEED_N && journal.every(hasJournalGradeFields)) {
    state = "recovered";
    note = "All seven seed tickets passed journal-grade validation. Recovered does not automatically mean graded 7-0.";
  } else if (recoveredN >= 1 && recoveredN <= 6) {
    state = "partial";
    note = `Journal-recovered N=${recoveredN} of ${EXPECTED_SEED_N}. Identity of the seven named positions is operator-declared.`;
  } else if (named.length === EXPECTED_SEED_N) {
    state = "operator-declared";
    note =
      "Identity is operator-declared (seven named 2026-08-26 CONVICTION picks). Journal fields unrecovered. Do not treat this as a reconstructed journal import.";
  }

  return {
    state,
    confidence: state,
    expectedN: EXPECTED_SEED_N,
    namedN: named.length,
    seedN,
    recoveredN,
    gradedRecord: gradedFromNamed.gradedRecord,
    gradedWins: gradedFromNamed.wins,
    gradedLosses: gradedFromNamed.losses,
    reportedRecord: STRATEGY_HC_V1.reportedRecord,
    note,
    filterClaim: false,
  };
}

export function assignTicketRole(ticket) {
  const ts = ticket.qualifiedAt || ticket.loggedAt || ticket.qualificationTimestamp || ticket.date;
  const id = ticketId(ticket, ticket.date || dateCT(ts));
  if (inSeedWindow(ts) && ticket.sport && ticket.gameId && ticket.market && ticket.side) {
    return { role: "seed", id };
  }
  return { role: "prospective", id };
}

export function validateImportedTicket(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["ticket"] };
  const strategyId = raw.strategyId || raw.strategy_id;
  const sport = raw.sport;
  const gameId = raw.gameId || raw.game_id;
  const market = raw.market;
  const side = raw.side;
  const qualifiedAt = raw.qualifiedAt || raw.loggedAt || raw.qualificationTimestamp;
  const modelVersion = raw.modelVersion || raw.model_version;
  const ev = ticketEv(raw);
  const tag = raw.tag;
  const roleField = raw.role;
  if (strategyId !== STRATEGY_HC_V1.id) errors.push("strategy_id");
  if (!sport) errors.push("sport");
  if (!gameId) errors.push("game_id");
  if (!market || !STRATEGY_MARKETS.has(market)) errors.push("market");
  if (!side) errors.push("side");
  if (requiresLine(market) && (raw.line == null || raw.line === "")) errors.push("line");
  if (!qualifiedAt) errors.push("qualification_timestamp");
  if (!modelVersion) errors.push("model_version");
  if (ev == null) errors.push("ev");
  if (!tag) errors.push("tag");
  if (roleField == null || roleField === "") errors.push("role");
  if (errors.length) return { ok: false, errors };

  const normalized = {
    ...raw,
    strategyId: STRATEGY_HC_V1.id,
    sport,
    gameId: String(gameId),
    market,
    side,
    qualifiedAt,
    modelVersion,
    ev,
    tag,
    qualified: raw.qualified !== false,
    lean: raw.lean === true,
    marketComplete: raw.marketComplete !== false,
  };
  if (!ticketMatchesStrategy(normalized)) {
    return { ok: false, errors: ["strategy_rules"] };
  }
  const assigned = assignTicketRole(normalized);
  return { ok: true, ticket: { ...normalized, ...assigned }, clientRole: roleField, role: assigned.role };
}

const IDENTITY_KEYS = ["strategyId", "sport", "gameId", "market", "side", "line", "role"];
const IMMUTABLE_KEYS = [...IDENTITY_KEYS, "qualifiedAt", "modelVersion", "ev", "tag"];

function normField(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "" && String(v) === String(n)) return n;
  return String(v);
}

export function fieldsConflict(existing, incoming, keys = IMMUTABLE_KEYS) {
  if (!existing) return false;
  for (const k of keys) {
    const a = normField(existing[k] ?? existing[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)]);
    const b = normField(incoming[k]);
    if (a == null || b == null) continue;
    if (String(a) !== String(b)) return true;
  }
  return false;
}

export function immutableFieldsConflict(existing, incoming) {
  return fieldsConflict(existing, incoming, IMMUTABLE_KEYS);
}

export function identityFieldsConflict(existing, incoming) {
  return fieldsConflict(existing, incoming, IDENTITY_KEYS);
}

export { IMMUTABLE_KEYS, IDENTITY_KEYS };
