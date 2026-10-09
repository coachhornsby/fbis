/** Pure research settlement kernel. No fitted parameters, live routes, or authority. */
const EPSILON = 1e-10;
const MAX_CELLS = 4096;
const MAX_MARKETS = 128;
const FINAL_BASIS = "NHL_FINAL_ONE_DECIDING_GOAL";

function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}

function provenance(p, eventId) {
  requireValue(p && p.eventId === eventId && typeof eventId === "string" && eventId.length > 0,
    "EVENT_PROVENANCE_MISMATCH");
  requireValue(typeof p.homeTeamId === "string" && p.homeTeamId.length > 0 &&
    typeof p.awayTeamId === "string" && p.awayTeamId.length > 0 &&
    p.homeTeamId !== p.awayTeamId, "TEAM_PROVENANCE_REQUIRED");
  requireValue(typeof p.modelId === "string" && p.modelId.length > 0 &&
    typeof p.modelVersion === "string" && p.modelVersion.length > 0 &&
    /^[a-f0-9]{64}$/.test(p.artifactSha256 || ""), "MODEL_PROVENANCE_REQUIRED");
  for (const key of ["trainedAtMs", "featureCutoffAtMs", "snapshotAtMs", "eventStartMs"])
    requireValue(Number.isSafeInteger(p[key]), "TEMPORAL_PROVENANCE_REQUIRED");
  requireValue(p.trainedAtMs <= p.snapshotAtMs && p.featureCutoffAtMs <= p.snapshotAtMs &&
    p.snapshotAtMs < p.eventStartMs, "POST_CUTOFF_EVIDENCE");
  return { ...p };
}

function distribution(input, basis, eventId) {
  requireValue(input?.scoreBasis === basis, "SCORING_TARGET_MISMATCH");
  const source = provenance(input.provenance, eventId);
  requireValue(Array.isArray(input.cells) && input.cells.length > 0 &&
    input.cells.length <= MAX_CELLS, "BOUNDED_PMF_REQUIRED");
  const keys = new Set();
  let mass = 0;
  const cells = input.cells.map(({ home, away, probability }) => {
    requireValue(Number.isSafeInteger(home) && home >= 0 && home <= 64 &&
      Number.isSafeInteger(away) && away >= 0 && away <= 64 &&
      Number.isFinite(probability) && probability >= 0 && probability <= 1, "INVALID_PMF_CELL");
    const key = `${home}:${away}`;
    requireValue(!keys.has(key), "DUPLICATE_PMF_CELL");
    keys.add(key);
    mass += probability;
    return { home, away, probability };
  });
  requireValue(Math.abs(mass - 1) <= EPSILON, "PMF_MASS_NOT_ONE");
  // The caller must supply a complete, normalized law. No silent tail renormalization.
  return { cells, provenance: source, massError: Math.abs(mass - 1) };
}

function quote(win, lose, push = 0) {
  requireValue(Math.abs(win + lose + push - 1) <= EPSILON, "SETTLEMENT_MASS_NOT_ONE");
  // Normalization tolerance must not erase positive resolved settlement mass.
  const conditional = win + lose > 0 ? win / (win + lose) : null;
  const decimal = conditional > 0 ? 1 / conditional : null;
  const american = decimal == null ? null : conditional >= 0.5
    ? (conditional === 1 ? null : -100 * conditional / (1 - conditional))
    : 100 * (1 - conditional) / conditional;
  // Accepted PMF mass is not altered to manufacture representable odds.
  // Treat the quote as unavailable if either odds format exceeds finite Number range.
  const numericUnavailable = (decimal != null && !Number.isFinite(decimal)) ||
    (american != null && !Number.isFinite(american));
  return { win, lose, push, conditionalOnNoPush: conditional,
    fairDecimalOdds: numericUnavailable ? null : decimal,
    fairAmericanOdds: numericUnavailable ? null : american,
    fairOddsStatus: conditional == null ? "ALL_PUSH" : conditional === 0 || conditional === 1
      ? "DEGENERATE" : numericUnavailable ? "NUMERIC_DOMAIN_UNAVAILABLE" : "AVAILABLE",
    qualification: "UNVALIDATED_RESEARCH", canQualify: false, canAuthorizeWager: false };
}

function outcomes(cells) {
  let home = 0, away = 0, draw = 0;
  for (const c of cells) {
    if (c.home > c.away) home += c.probability;
    else if (c.home < c.away) away += c.probability;
    else draw += c.probability;
  }
  return { home: quote(home, away + draw), away: quote(away, home + draw),
    draw: quote(draw, home + away) };
}

function settle(cells, compare) {
  let win = 0, lose = 0, push = 0;
  for (const c of cells) {
    const value = compare(c);
    if (value > 0) win += c.probability;
    else if (value < 0) lose += c.probability;
    else push += c.probability;
  }
  return quote(win, lose, push);
}

function lineMarkets(cells, requests, period = false) {
  requireValue(Array.isArray(requests) && requests.length <= MAX_MARKETS, "BOUNDED_MARKET_REQUESTS_REQUIRED");
  return requests.map(({ family, line, side }) => {
    requireValue(Number.isFinite(line) && Number.isSafeInteger(line * 2), "UNSUPPORTED_LINE");
    let compare;
    if (family === "TOTAL") compare = c => c.home + c.away - line;
    else if (family === "TEAM_TOTAL" && ["home", "away"].includes(side)) compare = c => c[side] - line;
    else if (!period && family === "PUCK_LINE" && ["home", "away"].includes(side))
      compare = c => c[side] + line - c[side === "home" ? "away" : "home"];
    else throw new Error("UNSUPPORTED_MARKET_FAMILY");
    const selection = settle(cells, compare);
    return { family, line, side: side ?? null, selection,
      opposite: quote(selection.lose, selection.win, selection.push),
      availability: "MODEL_ONLY", verifiedBettingEdge: null };
  });
}

function finalDistribution(regulation, overtime, eventId) {
  const ties = regulation.cells.filter(c => c.home === c.away && c.probability > 0);
  if (!ties.length) return { cells: regulation.cells, provenance: null };
  if (!overtime) return null;
  requireValue(overtime.scoreBasis === FINAL_BASIS, "SETTLEMENT_CONTRACT_REQUIRED");
  const source = provenance(overtime.provenance, eventId);
  requireValue(source.eventStartMs === regulation.provenance.eventStartMs,
    "EVENT_START_MISMATCH");
  requireValue(source.homeTeamId === regulation.provenance.homeTeamId &&
    source.awayTeamId === regulation.provenance.awayTeamId, "TEAM_ORDER_MISMATCH");
  requireValue(Array.isArray(overtime.ties) && overtime.ties.length <= MAX_CELLS,
    "BOUNDED_OVERTIME_KERNEL_REQUIRED");
  const probabilities = new Map();
  for (const { goals, homeWinProbability } of overtime.ties) {
    requireValue(Number.isSafeInteger(goals) && goals >= 0 &&
      Number.isFinite(homeWinProbability) && homeWinProbability >= 0 && homeWinProbability <= 1,
    "INVALID_OVERTIME_PROBABILITY");
    requireValue(!probabilities.has(goals), "DUPLICATE_OVERTIME_STATE");
    probabilities.set(goals, homeWinProbability);
  }
  const cells = [];
  for (const c of regulation.cells) {
    if (c.home !== c.away || c.probability === 0) { cells.push(c); continue; }
    requireValue(probabilities.has(c.home), "OVERTIME_STATE_MISSING");
    const p = probabilities.get(c.home);
    cells.push({ home: c.home + 1, away: c.away, probability: c.probability * p },
      { home: c.home, away: c.away + 1, probability: c.probability * (1 - p) });
  }
  return { cells, provenance: source };
}

/**
 * Inputs are caller-supplied research laws, not expected-goal differences.
 * Full-game markets follow ONLY the explicit one-deciding-goal contract.
 * Book-specific settlement equivalence and independent validation remain external gates.
 */
export function buildNhlResearchMarkets({ eventId, regulation, overtime = null,
  marketLines = [], firstPeriod = null, firstPeriodLines = [] }) {
  const reg = distribution(regulation, "REGULATION", eventId);
  const final = finalDistribution(reg, overtime, eventId);
  // Validate requested lines even if full-game probabilities are unavailable.
  const requested = lineMarkets(reg.cells, marketLines);
  const result = {
    modelId: "NHL-PMF-SETTLEMENT-RESEARCH", version: "research-contract-v1",
    eventId, provenance: { regulation: reg.provenance, overtime: final?.provenance ?? null },
    authority: "RESEARCH_ONLY", canQualify: false, canAuthorizeWager: false,
    regulation: outcomes(reg.cells),
    expectedRegulationGoals: reg.cells.reduce((s, c) => ({ home: s.home + c.home * c.probability,
      away: s.away + c.away * c.probability }), { home: 0, away: 0 }),
    fullGame: final ? {
      scoreBasis: FINAL_BASIS, moneyline: outcomes(final.cells),
      markets: lineMarkets(final.cells, marketLines),
      expectedFinalGoals: final.cells.reduce((s, c) => ({ home: s.home + c.home * c.probability,
        away: s.away + c.away * c.probability }), { home: 0, away: 0 }),
    } : null,
    unavailable: final ? [] : ["INDEPENDENT_OVERTIME_KERNEL_REQUIRED"],
    requestedMarkets: requested.map(({ family, line, side }) => ({ family, line, side })),
    uncertainty: { status: "UNVALIDATED", estimationInterval: null,
      pmfMassError: reg.massError, cells: reg.cells.length,
      tailMass: null, tailStatus: "CALLER_COMPLETE_LAW_NOT_INDEPENDENTLY_VERIFIED" },
    firstPeriod: null,
  };
  if (firstPeriod) {
    const period = distribution(firstPeriod, "FIRST_PERIOD", eventId);
    requireValue(period.provenance.eventStartMs === reg.provenance.eventStartMs, "EVENT_START_MISMATCH");
    requireValue(period.provenance.homeTeamId === reg.provenance.homeTeamId &&
      period.provenance.awayTeamId === reg.provenance.awayTeamId, "TEAM_ORDER_MISMATCH");
    result.firstPeriod = { outcomes: outcomes(period.cells),
      markets: lineMarkets(period.cells, firstPeriodLines, true), provenance: period.provenance,
      qualification: "UNVALIDATED_RESEARCH", canQualify: false };
  } else {
    requireValue(firstPeriodLines.length === 0, "FIRST_PERIOD_INPUTS_REQUIRED");
    result.unavailable.push("INDEPENDENT_FIRST_PERIOD_LAW_REQUIRED");
  }
  return result;
}
