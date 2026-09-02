/**
 * Phase 1 MLB full-game data contract.
 * Research-only surfaces (F5, player props, other sports) stay visible as labeled,
 * but this module never treats them as Phase 1 CONVICTION markets.
 */

import { canonFromTeamId, resolveMlbCanon, sameMlbTeam } from "./mlbCanonical.js";
import { expectedRoi, validAmericanOdds } from "./pricing.js";
import { validateCanonicalProbability } from "./probability.js";

export const PHASE1_PERIOD = "FULL_GAME";

export const PHASE1_MARKETS = Object.freeze({
  MONEYLINE: "MLB:FULL_GAME:MONEYLINE",
  RUN_LINE: "MLB:FULL_GAME:RUN_LINE",
  TOTAL: "MLB:FULL_GAME:TOTAL",
});

export const PHASE1_MARKET_FAMILIES = Object.freeze(["MONEYLINE", "RUN_LINE", "TOTAL"]);

export const SOURCE_ROLES = Object.freeze({
  Heritage: "actual operator execution",
  Pinnacle: "benchmark, no-vig market probability, and close for CLV",
  "Ballpark Pal": "matchup, lineup, park, projected runs, and F5 analytical context",
  Savant: "pitcher/batter and run-environment analytical inputs",
  Kalshi: "sentiment only",
  Parlay: "market aggregation only according to documented source identity",
});

export const MATCH_STATUS = Object.freeze({
  MATCHED: "MATCHED",
  UNMATCHED: "UNMATCHED",
  AMBIGUOUS: "AMBIGUOUS",
  CONFLICT: "CONFLICT",
});

export const CLV_STATUS = Object.freeze({
  PRICE_SAME_LINE: "PRICE_CLV_SAME_LINE",
  LINE_MOVEMENT: "LINE_MOVEMENT",
  MISSING_ENTRY: "MISSING_ENTRY",
  MISSING_CLOSE: "MISSING_CLOSE",
  LINE_MISMATCH: "LINE_MISMATCH",
  UNMATCHED_CONTRACT: "UNMATCHED_CONTRACT",
});

export const QUALIFICATION_LABEL = Object.freeze({
  CONVICTION: "CONVICTION",
  QUALIFIED: "QUALIFIED",
  MODEL_LEAN: "MODEL LEAN",
  MARKET_UNAVAILABLE: "MARKET UNAVAILABLE",
  PROJECTION_INCOMPLETE: "PROJECTION INCOMPLETE",
  QUALIFICATION_PAUSED: "QUALIFICATION PAUSED",
  CANARY: "CANARY",
});

export const PHASE1_OUTSIDE_LABEL = "F5 and player props are outside Phase 1 qualification.";

export const START_TIME_TOLERANCE_MS = 3 * 60 * 60 * 1000;

const INTERNAL_TO_CONTRACT = {
  ML: PHASE1_MARKETS.MONEYLINE,
  SPREAD: PHASE1_MARKETS.RUN_LINE,
  TOTAL: PHASE1_MARKETS.TOTAL,
};

export function phase1ContractId(market) {
  const m = String(market || "").toUpperCase();
  if (Object.values(PHASE1_MARKETS).includes(m)) return m;
  if (m === "ML") return PHASE1_MARKETS.MONEYLINE;
  if (m === "SPREAD" || m === "RUN_LINE" || m === "RL") return PHASE1_MARKETS.RUN_LINE;
  if (m === "TOTAL") return PHASE1_MARKETS.TOTAL;
  return INTERNAL_TO_CONTRACT[m] || null;
}

export function isPhase1FullGameMarket(market) {
  return Boolean(phase1ContractId(market));
}

export function isPhase1ExcludedMarket(market) {
  const m = String(market || "").toUpperCase();
  return m.startsWith("F5") || m.includes("PROP") || m.includes("TEAM TOTAL") || m.includes("ALT");
}

export function americanToDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  if (a > 0) return 1 + a / 100;
  return 1 + 100 / Math.abs(a);
}

export function packPhase1MarketSnapshot({
  eventId,
  marketFamily,
  selection,
  line = null,
  americanPrice,
  book,
  sourceMarketId = null,
  observedAt,
  operatorDate,
  homeAwayOrientation,
  opposingSelection = null,
  opposingAmericanPrice = null,
  completeness = null,
  freshness = null,
} = {}) {
  const contractId = phase1ContractId(marketFamily);
  const decimal = americanToDecimal(americanPrice);
  const opposingDecimal = opposingAmericanPrice == null ? null : americanToDecimal(opposingAmericanPrice);
  const complete =
    completeness != null
      ? completeness
      : Boolean(eventId && contractId && selection && validAmericanOdds(americanPrice) && observedAt);
  return {
    eventId: eventId ? String(eventId) : null,
    marketFamily: contractId,
    periodFamily: PHASE1_PERIOD,
    selection: selection || null,
    line: line == null || line === "" ? null : Number(line),
    americanPrice: validAmericanOdds(americanPrice) ? Number(americanPrice) : null,
    decimalPrice: decimal,
    book: book || null,
    sourceMarketId: sourceMarketId || null,
    observedAt: observedAt || null,
    operatorDate: operatorDate || null,
    homeAwayOrientation: homeAwayOrientation || null,
    opposingSelection: opposingSelection || null,
    opposingAmericanPrice: validAmericanOdds(opposingAmericanPrice) ? Number(opposingAmericanPrice) : null,
    opposingDecimalPrice: opposingDecimal,
    marketCompletenessState: complete ? "COMPLETE" : "INCOMPLETE",
    marketFreshnessState: freshness || "UNKNOWN",
  };
}

export function forbiddenSourceSubstitution({ displayedAs, actualSource } = {}) {
  const shown = String(displayedAs || "");
  const actual = String(actualSource || "");
  if (!shown || !actual) return false;
  const pairs = [
    ["Pinnacle close", "Heritage"],
    ["Pinnacle", "Heritage current"],
    ["sportsbook price", "Kalshi"],
    ["sportsbook price", "Ballpark Pal"],
    ["sportsbook price", "model fair"],
    ["game total", "team total"],
    ["full game", "F5"],
    ["standard run line", "alternate"],
  ];
  return pairs.some(([as, from]) => shown.toLowerCase().includes(as.toLowerCase()) && actual.toLowerCase().includes(from.toLowerCase()));
}

function parseTs(value) {
  const n = Date.parse(String(value || ""));
  return Number.isFinite(n) ? n : null;
}

function teamIdsOf(team = {}) {
  const ids = [team.mlbId, team.mlbTeamId, team.statsId, team.teamId, team.id, team.espnId]
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(ids)];
}

function gamePkOf(row = {}) {
  const raw = row.gamePk ?? row.gamepk ?? row.mlbGamePk ?? row.mlbGameId ?? row.canonicalGameId;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : String(raw);
}

/**
 * Canonical MLB event match. Fail closed on ambiguous/conflict.
 * Order: canonical game ID → team IDs + start-time tolerance → explicit reviewed alias.
 * Never match solely on abbreviations or display names.
 */
export function matchCanonicalMlbEvent(source = {}, canonical = {}, { aliases = [] } = {}) {
  const sourcePk = gamePkOf(source);
  const canonicalPk = gamePkOf(canonical);
  if (sourcePk && canonicalPk) {
    if (sourcePk === canonicalPk) {
      return { status: MATCH_STATUS.MATCHED, reason: "canonical-game-id", eventId: canonicalPk };
    }
    return { status: MATCH_STATUS.CONFLICT, reason: "game-id-mismatch", eventId: null };
  }

  const srcAway = teamIdsOf(source.away || {});
  const srcHome = teamIdsOf(source.home || {});
  const canAway = teamIdsOf(canonical.away || {});
  const canHome = teamIdsOf(canonical.home || {});
  const awayHit = srcAway.some((id) => canAway.includes(id));
  const homeHit = srcHome.some((id) => canHome.includes(id));
  const swapped = srcAway.some((id) => canHome.includes(id)) && srcHome.some((id) => canAway.includes(id));
  const srcStart = parseTs(source.start || source.scheduledStartUtc);
  const canStart = parseTs(canonical.start || canonical.scheduledStartUtc);
  const startOk =
    srcStart == null || canStart == null || Math.abs(srcStart - canStart) <= START_TIME_TOLERANCE_MS;

  if (awayHit && homeHit && startOk) {
    return { status: MATCH_STATUS.MATCHED, reason: "team-ids-start", eventId: canonicalPk || gamePkOf(canonical) };
  }
  if (swapped && startOk) {
    return { status: MATCH_STATUS.CONFLICT, reason: "home-away-swap", eventId: null };
  }
  if ((awayHit || homeHit) && !(awayHit && homeHit)) {
    return { status: MATCH_STATUS.AMBIGUOUS, reason: "partial-team-id", eventId: null };
  }

  const alias = (aliases || []).find((row) => {
    if (!row?.sourceEventId || !row?.canonicalEventId) return false;
    return String(row.sourceEventId) === String(source.id || sourcePk || source.sourceEventId)
      && String(row.canonicalEventId) === String(canonicalPk || canonical.id);
  });
  if (alias) {
    return { status: MATCH_STATUS.MATCHED, reason: "reviewed-alias", eventId: String(alias.canonicalEventId) };
  }

  const abbrOnly =
    sameMlbTeam(source.away, canonical.away) && sameMlbTeam(source.home, canonical.home);
  if (abbrOnly && !srcAway.length && !canAway.length) {
    return { status: MATCH_STATUS.UNMATCHED, reason: "abbr-or-name-only-forbidden", eventId: null };
  }
  return { status: MATCH_STATUS.UNMATCHED, reason: "no-canonical-key", eventId: null };
}

export function classifyMatchPool(candidates = []) {
  if (!candidates.length) return { status: MATCH_STATUS.UNMATCHED, n: 0 };
  const matched = candidates.filter((c) => c.status === MATCH_STATUS.MATCHED);
  const conflicts = candidates.filter((c) => c.status === MATCH_STATUS.CONFLICT);
  if (conflicts.length) return { status: MATCH_STATUS.CONFLICT, n: conflicts.length };
  if (matched.length > 1) return { status: MATCH_STATUS.AMBIGUOUS, n: matched.length };
  if (matched.length === 1) return { status: MATCH_STATUS.MATCHED, n: 1 };
  if (candidates.some((c) => c.status === MATCH_STATUS.AMBIGUOUS)) {
    return { status: MATCH_STATUS.AMBIGUOUS, n: candidates.length };
  }
  return { status: MATCH_STATUS.UNMATCHED, n: 0 };
}

export function matchingHealthCounts(rows = []) {
  const tally = { MATCHED: 0, UNMATCHED: 0, AMBIGUOUS: 0, CONFLICT: 0 };
  for (const row of rows || []) {
    const s = String(row.status || row.matchStatus || "").toUpperCase();
    if (tally[s] != null) tally[s] += 1;
    else tally.UNMATCHED += 1;
  }
  return { ...tally, n: (rows || []).length };
}

export function projectionInvariants({
  projAway,
  projHome,
  pHome,
  pAway,
  selectedSide,
  selectedMarket,
  selectedLine,
  selectedPrice,
  selectedProbability,
  expectedRoiValue,
  uiAwayName,
  uiHomeName,
  calcAwayId,
  calcHomeId,
  runLineSignTeam,
} = {}) {
  const violations = [];
  const away = Number(projAway);
  const home = Number(projHome);
  if (Number.isFinite(away) && Number.isFinite(home)) {
    const winner = home > away ? "HOME" : away > home ? "AWAY" : "TIE";
    if (selectedMarket === "ML" && selectedSide && winner !== "TIE" && selectedSide !== winner && selectedProbability > 0.5) {
      violations.push("projected-winner-score-direction");
    }
  }
  const ph = validateCanonicalProbability(pHome);
  const pa = pAway != null ? validateCanonicalProbability(pAway) : { ok: true, modelProbability: ph.ok ? 1 - ph.modelProbability : null };
  if (ph.ok && pa.ok && Math.abs(ph.modelProbability + pa.modelProbability - 1) > 1e-6) {
    violations.push("home-away-probability-sum");
  }
  if (selectedMarket === "ML" && ph.ok && selectedSide === "HOME" && selectedProbability != null) {
    if (Math.abs(Number(selectedProbability) - ph.modelProbability) > 1e-6) violations.push("ml-side-probability");
  }
  if (selectedMarket === "ML" && ph.ok && selectedSide === "AWAY" && selectedProbability != null) {
    if (Math.abs(Number(selectedProbability) - (1 - ph.modelProbability)) > 1e-6) violations.push("ml-side-probability");
  }
  if ((selectedMarket === "SPREAD" || selectedMarket === "RUN_LINE") && runLineSignTeam && selectedSide && runLineSignTeam !== selectedSide) {
    violations.push("run-line-sign-team");
  }
  if (selectedMarket === "TOTAL" && selectedLine == null) violations.push("total-line-missing");
  if (selectedProbability != null && validAmericanOdds(selectedPrice) && expectedRoiValue != null) {
    const recomputed = expectedRoi(Number(selectedProbability), selectedPrice);
    if (recomputed == null || Math.abs(recomputed - Number(expectedRoiValue)) > 1e-8) {
      violations.push("expected-roi-price");
    }
  }
  if (uiAwayName && calcAwayId && uiHomeName && calcHomeId) {
    const uiAway = resolveMlbCanon({ name: uiAwayName }) || canonFromTeamId(calcAwayId);
    const uiHome = resolveMlbCanon({ name: uiHomeName }) || canonFromTeamId(calcHomeId);
    const calcAway = canonFromTeamId(calcAwayId);
    const calcHome = canonFromTeamId(calcHomeId);
    if (uiAway && calcAway && uiAway !== calcAway) violations.push("ui-calc-away-mismatch");
    if (uiHome && calcHome && uiHome !== calcHome) violations.push("ui-calc-home-mismatch");
  }
  return {
    ok: violations.length === 0,
    violations,
    quarantine: violations.length ? "projection-invariant-violation" : null,
  };
}

export function clvContractMatch({
  entryEventId,
  closeEventId,
  entryMarket,
  closeMarket,
  entryPeriod,
  closePeriod,
  entrySelection,
  closeSelection,
  entryLine,
  closeLine,
  entryNoVig,
  closeNoVig,
} = {}) {
  if (!entryEventId || !closeEventId || String(entryEventId) !== String(closeEventId)) {
    return { status: CLV_STATUS.UNMATCHED_CONTRACT, clv: null };
  }
  if (phase1ContractId(entryMarket) !== phase1ContractId(closeMarket)) {
    return { status: CLV_STATUS.UNMATCHED_CONTRACT, clv: null };
  }
  if (String(entryPeriod || PHASE1_PERIOD) !== String(closePeriod || PHASE1_PERIOD)) {
    return { status: CLV_STATUS.UNMATCHED_CONTRACT, clv: null };
  }
  if (String(entrySelection || "").toUpperCase() !== String(closeSelection || "").toUpperCase()) {
    return { status: CLV_STATUS.UNMATCHED_CONTRACT, clv: null };
  }
  const market = phase1ContractId(entryMarket);
  const needsLine = market === PHASE1_MARKETS.RUN_LINE || market === PHASE1_MARKETS.TOTAL;
  if (needsLine) {
    if (entryLine == null || closeLine == null) return { status: CLV_STATUS.LINE_MISMATCH, clv: null };
    if (Number(entryLine) !== Number(closeLine)) {
      return { status: CLV_STATUS.LINE_MISMATCH, clv: null, lineMovement: Number(closeLine) - Number(entryLine) };
    }
  }
  if (entryNoVig == null) return { status: CLV_STATUS.MISSING_ENTRY, clv: null };
  if (closeNoVig == null) return { status: CLV_STATUS.MISSING_CLOSE, clv: null };
  return {
    status: CLV_STATUS.PRICE_SAME_LINE,
    clv: Number(closeNoVig) - Number(entryNoVig),
  };
}

export function displayPlayLabel({ rec, lean, paused = false, canary = false, marketUnavailable = false, projectionIncomplete = false } = {}) {
  if (canary) return QUALIFICATION_LABEL.CANARY;
  if (paused && rec) return QUALIFICATION_LABEL.QUALIFICATION_PAUSED;
  if (marketUnavailable) return QUALIFICATION_LABEL.MARKET_UNAVAILABLE;
  if (projectionIncomplete) return QUALIFICATION_LABEL.PROJECTION_INCOMPLETE;
  if (rec?.tag === "CONVICTION" && !paused) return QUALIFICATION_LABEL.CONVICTION;
  if (rec?.qualified || rec?.tag === "QUALIFIED") return QUALIFICATION_LABEL.QUALIFIED;
  if (lean) return QUALIFICATION_LABEL.MODEL_LEAN;
  return null;
}

export function recHasMarketAndLine(rec) {
  if (!rec) return false;
  const market = String(rec.market || "");
  if (!market) return false;
  if (market === "ML" || market === "F5 ML") return Boolean(rec.pick || rec.side);
  return rec.line != null && Number.isFinite(Number(rec.line));
}

export const PROJECTION_INPUT_CATALOG = [
  { id: "starting-pitcher", label: "Starting pitcher", source: "Ballpark Pal / MLB Stats", required: false, affectsQualification: false, beforeStart: true },
  { id: "starter-handedness", label: "Starter handedness", source: "Ballpark Pal / Savant", required: false, affectsQualification: false, beforeStart: true },
  { id: "expected-innings", label: "Expected innings / TTO", source: "Savant / Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "bullpen-quality", label: "Bullpen quality and availability", source: "Ballpark Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "bullpen-workload", label: "Bullpen recent workload", source: "Ballpark Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "lineup", label: "Confirmed or projected lineup", source: "Ballpark Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "platoon", label: "Batter handedness and platoon splits", source: "Savant", required: false, affectsQualification: false, beforeStart: true },
  { id: "park-factors", label: "Park factors", source: "Ballpark Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "weather", label: "Weather", source: "MLB Stats / Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "wind", label: "Wind direction/speed", source: "MLB Stats / Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "temperature", label: "Temperature", source: "MLB Stats / Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "humidity", label: "Humidity", source: "MLB Stats / Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "roof", label: "Roof status", source: "MLB Stats / Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "umpire", label: "Umpire", source: "optional pregame feed", required: false, affectsQualification: false, beforeStart: true },
  { id: "team-offense", label: "Team offensive strength", source: "Savant / FBIS", required: true, affectsQualification: true, beforeStart: true },
  { id: "recent-form", label: "Recent form (regressed)", source: "FBIS / Savant", required: false, affectsQualification: false, beforeStart: true },
  { id: "travel-rest", label: "Travel/rest", source: "schedule", required: false, affectsQualification: false, beforeStart: true },
  { id: "pal-overlay", label: "Ballpark Pal overlay", source: "Ballpark Pal", required: false, affectsQualification: false, beforeStart: true },
  { id: "savant", label: "Savant inputs", source: "Baseball Savant", required: false, affectsQualification: false, beforeStart: true },
];
