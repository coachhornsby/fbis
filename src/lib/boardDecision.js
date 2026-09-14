/**
 * Presentation-layer board decision, sort, and display helpers.
 * Does not change qualification / betting logic — only maps existing fields.
 *
 * PASS means: an eligible FBIS model evaluated this market and no qualifying
 * wager was found. Missing PURE projection is NO_MODEL, never PASS.
 */

import {
  buildProbabilityProvenance,
  probabilityDisplayContract,
  PROBABILITY_SOURCE,
} from "../../functions/lib/canonical/probabilityAuthority.js";

export const DECISION_ORDER = Object.freeze({
  CONVICTION: 0,
  QUALIFIED: 1,
  LEAN: 2,
  RESEARCH: 3,
  PASS: 4,
  NO_MODEL: 5,
  BLOCKED: 6,
});

/** Canonical misprice / decision states (board + research share these). */
export const BOARD_MISPRICE_STATE = Object.freeze({
  NO_MODEL: "NO_MODEL",
  MODEL_ONLY: "MODEL_ONLY",
  MODEL_DISAGREEMENT: "MODEL_DISAGREEMENT",
  CALIBRATED_EDGE: "CALIBRATED_EDGE",
  QUALIFIED: "QUALIFIED",
  AUTHORIZED: "AUTHORIZED",
  BLOCKED: "BLOCKED",
});

const CT = "America/Chicago";

const MARKET_IMPLIED_KINDS = new Set([
  "PINNACLE_IMPLIED",
  "PINNACLE_IMPLIED_SCORE",
  "MARKET_IMPLIED",
  "MARKET_BENCHMARK",
]);

/** Coerce any UI value to a safe display string — never "[object Object]". */
export function safeDisplayString(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.state === "string" && value.state.trim()) return value.state.trim();
    if (typeof value.detail === "string" && value.detail.trim()) return value.detail.trim();
    if (typeof value.name === "string" && value.name.trim()) return value.name.trim();
    if (typeof value.label === "string" && value.label.trim()) return value.label.trim();
    if (typeof value.fullName === "string" && value.fullName.trim()) return value.fullName.trim();
    if (typeof value.status === "string" && value.status.trim()) return value.status.trim();
    return fallback;
  }
  return fallback;
}

export function teamCardTitle(team) {
  if (!team || typeof team !== "object") return "Team";
  const full = safeDisplayString(team.fullName);
  const name = safeDisplayString(team.name);
  const school = safeDisplayString(team.school);
  const abbr = safeDisplayString(team.abbr);
  // Prefer a single canonical name — never concatenate school + nickname when fullName exists.
  const primary = full || name || school || abbr || "Team";
  // Guard against accidental "Green Bay Packers Packers" / duplicate tokens.
  const nick = safeDisplayString(team.nickname);
  if (nick && primary.endsWith(` ${nick} ${nick}`)) {
    return primary.slice(0, primary.length - nick.length - 1);
  }
  return primary;
}

export function isResearchProjection(game) {
  if (!game) return false;
  if (String(game.projectionMaturity || game.model?.maturity || "").toUpperCase() === "RESEARCH") return true;
  if (game.publicationStatus === "RESEARCH_PUBLISHABLE") return true;
  if (game.researchProjection) return true;
  return false;
}

function finiteScore(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pairScores(away, home) {
  const a = finiteScore(away);
  const h = finiteScore(home);
  if (a == null || h == null) return null;
  return { away: a, home: h };
}

/**
 * Independent FBIS / research scores only — never market-implied headline numbers.
 * Shared by compact rows and expanded detail.
 */
export function resolveIndependentScores(game) {
  if (!game) return null;
  if (game.projectionUnavailable) return null;
  if (game.pureProjectionAvailable === false) return null;
  if (game.cfb?.projectionState === "LEAGUE_AVERAGE_ONLY") return null;

  const rp = game.researchProjection;
  if (rp && typeof rp === "object") {
    const fromResearch = pairScores(
      rp.away ?? rp.projAway ?? rp.awayScore,
      rp.home ?? rp.projHome ?? rp.homeScore
    );
    if (fromResearch) {
      return { ...fromResearch, source: "researchProjection", fromResearch: true };
    }
  }

  const kind = String(
    game.projectionKind || game.projectionState || game.model?.projectionKind || ""
  ).toUpperCase();
  if (kind === "UNAVAILABLE" || kind === "NONE" || kind === "NO_MODEL") return null;

  const modelPair = pairScores(
    game?.model?.projAway ?? game?.projAwayScore ?? game?.projAway,
    game?.model?.projHome ?? game?.projHomeScore ?? game?.projHome
  );

  const research =
    isResearchProjection(game) ||
    String(game.projectionMaturity || game.model?.maturity || "").toUpperCase() === "RESEARCH";
  const pureFlag = game.pureProjectionAvailable === true;

  // Explicit FBIS / PURE kinds — independent when scores exist.
  if (modelPair && (kind === "FBIS" || kind === "PURE" || kind === "FBIS_PURE")) {
    return { ...modelPair, source: "model", fromResearch: research };
  }

  // Research / pure flags win even if a stale market kind label remains.
  if (modelPair && (research || pureFlag)) {
    return {
      ...modelPair,
      source: MARKET_IMPLIED_KINDS.has(kind) ? "research-over-market-kind" : "model",
      fromResearch: true,
    };
  }

  if (MARKET_IMPLIED_KINDS.has(kind)) return null;

  const sport = String(game.sport || "").toLowerCase();
  if (sport === "nfl") return null;

  if (modelPair) return { ...modelPair, source: "model", fromResearch: false };
  return null;
}

/**
 * Canonical board projection resolver — compact rows and expanded detail must share this.
 * Never headlines PINNACLE_IMPLIED when an FBIS research projection exists.
 */
export function resolveBoardProjection(game) {
  const independent = resolveIndependentScores(game);
  const market = marketImpliedScores(game);
  const rawKind = String(
    game?.projectionKind || game?.model?.projectionKind || game?.projectionState || ""
  ).toUpperCase() || null;

  if (independent) {
    const away = independent.away;
    const home = independent.home;
    // Prefer explicit board margin/total when present; otherwise derive and round to 1dp.
    const derivedMargin = Math.round((home - away) * 10) / 10;
    const derivedTotal = Math.round((away + home) * 10) / 10;
    const explicitMargin = finiteScore(game?.model?.projMargin ?? game?.projMargin);
    const explicitTotal = finiteScore(game?.model?.projTotal ?? game?.projTotal);
    const margin = explicitMargin != null ? explicitMargin : derivedMargin;
    const total = explicitTotal != null ? explicitTotal : derivedTotal;
    const research = Boolean(independent.fromResearch || isResearchProjection(game));
    return {
      available: true,
      independent: true,
      away,
      home,
      total,
      margin,
      fairHomeSpread: -margin,
      fairTotal: total,
      kind: "FBIS",
      displayKind: "FBIS",
      headlineLabel: research ? "FBIS RESEARCH" : "FBIS",
      state: game?.cfb?.projectionState || game?.projectionState || null,
      marketBenchmark: market.available ? market : null,
      source: independent.source,
      research,
    };
  }

  return {
    available: false,
    independent: false,
    away: null,
    home: null,
    total: null,
    margin: null,
    fairHomeSpread: null,
    fairTotal: null,
    kind: rawKind,
    displayKind: MARKET_IMPLIED_KINDS.has(rawKind || "") ? rawKind : rawKind,
    headlineLabel: null,
    state: game?.cfb?.projectionState || game?.projectionState || null,
    marketBenchmark: market.available ? market : null,
    source: null,
    research: false,
  };
}

export function hasPureFbisProjection(game) {
  return resolveIndependentScores(game) != null;
}

export function isBlockedGame(game) {
  if (!game) return true;
  // Research models are qualification-blocked by design — that is not a board BLOCKED state.
  if (isResearchProjection(game)) {
    if (game.projectionUnavailable) return true;
    return false;
  }
  if (game.qualificationBlocked) return true;
  if (game.projectionUnavailable) return true;
  if (game.cfb && game.cfb.bettingAllowed === false) return true;
  if (game.cfb?.projectionState === "LEAGUE_AVERAGE_ONLY") return true;
  if (game.blockReason && !game.rec && !game.lean) return true;
  return false;
}

/**
 * Derive canonical misprice state for a board/research row.
 * qualified=false alone never implies PASS / CALIBRATED_EDGE.
 */
export function deriveBoardMispriceState(game = {}) {
  if (game.mispriceState && BOARD_MISPRICE_STATE[game.mispriceState]) {
    return game.mispriceState;
  }
  if (game.authorized === true || game.decision?.authorized === true) {
    return BOARD_MISPRICE_STATE.AUTHORIZED;
  }
  if (game.rec || game.qualified === true || game.decision?.qualified === true) {
    return BOARD_MISPRICE_STATE.QUALIFIED;
  }
  if (isBlockedGame(game) && hasPureFbisProjection(game)) {
    return BOARD_MISPRICE_STATE.BLOCKED;
  }
  if (!hasPureFbisProjection(game)) {
    return BOARD_MISPRICE_STATE.NO_MODEL;
  }
  const kind = String(game.projectionKind || "").toUpperCase();
  if (MARKET_IMPLIED_KINDS.has(kind)) {
    return BOARD_MISPRICE_STATE.NO_MODEL;
  }
  if (game.calibratedEdge === true || game.edgeState === "CALIBRATED_EDGE") {
    return BOARD_MISPRICE_STATE.CALIBRATED_EDGE;
  }
  if (game.lean || game.modelDisagreement === true) {
    return BOARD_MISPRICE_STATE.MODEL_DISAGREEMENT;
  }
  if (game.modelOnly === true) {
    return BOARD_MISPRICE_STATE.MODEL_ONLY;
  }
  // Eligible model present, no lean/rec → still not a misprice PASS signal here.
  return BOARD_MISPRICE_STATE.MODEL_ONLY;
}

/**
 * Map existing rec/lean/block fields onto the customer board taxonomy.
 * STRONG/STANDARD qualified tags display as QUALIFIED (not a new taxonomy).
 * Missing PURE projection → NO_MODEL (never PASS).
 */
export function boardDecision(game) {
  const mispriceState = deriveBoardMispriceState(game);

  if (game?.rec && hasPureFbisProjection(game)) {
    const tag = String(game.rec.tag || "QUALIFIED").toUpperCase();
    const tier = tag === "CONVICTION" ? "CONVICTION" : "QUALIFIED";
    return {
      tier,
      label: tier,
      pick: game.rec.pick || null,
      market: game.rec.market || null,
      edge: game.rec.edge ?? null,
      evPct: game.rec.evPct ?? (game.rec.ev != null ? game.rec.ev * 100 : null),
      reason: null,
      mispriceState:
        tier === "QUALIFIED" || tier === "CONVICTION"
          ? BOARD_MISPRICE_STATE.QUALIFIED
          : mispriceState,
    };
  }

  if (!hasPureFbisProjection(game)) {
    const kind = String(game?.projectionKind || game?.projectionState || "").toUpperCase();
    const marketImplied = MARKET_IMPLIED_KINDS.has(kind);
    return {
      tier: "NO_MODEL",
      label: marketImplied ? "RESEARCH · NO PURE MODEL" : "NO MODEL",
      pick: null,
      market: null,
      reason:
        game?.blockReason ||
        game?.cfb?.blockReason ||
        game?.noPlayReason ||
        (marketImplied
          ? "No independent FBIS PURE projection — market-implied scores are benchmarks only"
          : "No independent FBIS PURE projection"),
      mispriceState: BOARD_MISPRICE_STATE.NO_MODEL,
    };
  }

  if (isBlockedGame(game)) {
    return {
      tier: "BLOCKED",
      label: "BLOCKED",
      pick: null,
      market: null,
      reason: game?.cfb?.blockReason || game?.blockReason || game?.noPlayReason || "Unavailable",
      mispriceState: BOARD_MISPRICE_STATE.BLOCKED,
    };
  }

  if (game?.lean) {
    return {
      tier: "LEAN",
      label: "LEAN",
      pick: game.lean.pick || null,
      market: game.lean.market || null,
      edge: game.lean.edge ?? null,
      evPct: game.lean.evPct ?? (game.lean.ev != null ? game.lean.ev * 100 : null),
      reason: game.lean.pauseReason || game.lean.reason || null,
      mispriceState: BOARD_MISPRICE_STATE.MODEL_DISAGREEMENT,
    };
  }

  // Research projections display scores but never PASS (PASS requires wager-eligible model).
  if (isResearchProjection(game)) {
    return {
      tier: "RESEARCH",
      label: "RESEARCH",
      pick: null,
      market: null,
      reason: "Research projection — not wager-authorized",
      mispriceState: BOARD_MISPRICE_STATE.MODEL_ONLY,
      publicationStatus: game.publicationStatus || "RESEARCH_PUBLISHABLE",
      bettingAuthority: "NOT_ELIGIBLE",
    };
  }

  // Eligible FBIS model evaluated the market; nothing qualified.
  return {
    tier: "PASS",
    label: "PASS",
    pick: null,
    market: null,
    reason: null,
    mispriceState: BOARD_MISPRICE_STATE.MODEL_ONLY,
  };
}

export function decisionSortKey(game) {
  const { tier } = boardDecision(game);
  return DECISION_ORDER[tier] ?? DECISION_ORDER.PASS;
}

export function sortBoardGames(games = []) {
  return [...games].sort((a, b) => {
    const da = decisionSortKey(a);
    const db = decisionSortKey(b);
    if (da !== db) return da - db;
    const ta = Date.parse(a?.start || "") || Number.POSITIVE_INFINITY;
    const tb = Date.parse(b?.start || "") || Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

export function filterBoardGames(games = [], filter = "ALL") {
  const f = String(filter || "ALL").toUpperCase();
  if (f === "ALL") return games;
  if (f === "HIDE_BLOCKED") {
    return games.filter((g) => {
      const tier = boardDecision(g).tier;
      return tier !== "BLOCKED" && tier !== "NO_MODEL";
    });
  }
  return games.filter((g) => boardDecision(g).tier === f);
}

export function boardDecisionCounts(games = []) {
  const counts = {
    ALL: games.length,
    CONVICTION: 0,
    QUALIFIED: 0,
    LEAN: 0,
    PASS: 0,
    NO_MODEL: 0,
    BLOCKED: 0,
  };
  for (const g of games) {
    const tier = boardDecision(g).tier;
    counts[tier] = (counts[tier] || 0) + 1;
  }
  return counts;
}

export function formatBoardDate(iso, { now = new Date() } = {}) {
  if (!iso) return { dateLine: "—", timeLine: "—", isToday: false, raw: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { dateLine: "—", timeLine: "—", isToday: false, raw: iso };
  const dateLine = d
    .toLocaleDateString("en-US", { timeZone: CT, weekday: "short", month: "short", day: "numeric" })
    .replace(/,/g, "")
    .toUpperCase();
  const timeLine = `${d.toLocaleTimeString("en-US", {
    timeZone: CT,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} CT`;
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: CT });
  const gameKey = d.toLocaleDateString("en-CA", { timeZone: CT });
  return { dateLine, timeLine, isToday: todayKey === gameKey, raw: iso };
}

export function fbisProjection(game) {
  // Compact + detail share resolveBoardProjection.
  const resolved = resolveBoardProjection(game);
  return {
    available: resolved.available,
    away: resolved.away,
    home: resolved.home,
    total: resolved.total,
    margin: resolved.margin,
    fairHomeSpread: resolved.fairHomeSpread,
    fairTotal: resolved.fairTotal,
    kind: resolved.displayKind || resolved.kind,
    state: resolved.state,
    headlineLabel: resolved.headlineLabel,
    independent: resolved.independent,
    marketBenchmark: resolved.marketBenchmark,
    research: resolved.research,
  };
}

export function marketImpliedScores(game) {
  const away = game?.marketProjAway ?? game?.model?.marketProjAway ?? null;
  const home = game?.marketProjHome ?? game?.model?.marketProjHome ?? null;
  if (away == null || home == null || Number.isNaN(Number(away)) || Number.isNaN(Number(home))) {
    return { available: false, away: null, home: null };
  }
  return { available: true, away: Number(away), home: Number(home) };
}

export function marketLines(game) {
  // Prefer canonical market roles when present (board payload).
  const m = game?.market;
  if (m && typeof m === "object") {
    const exec = m.execution || {};
    const cons = m.consensus || {};
    const ref = m.reference || {};
    const useExec = Boolean(exec.available);
    const useCons = !useExec && Boolean(cons.available);
    const useRef = !useExec && !useCons && Boolean(ref.available);
    const spread = useExec ? exec.spread : useCons ? cons.spread : useRef ? ref.spread : null;
    const total = useExec ? exec.total : useCons ? cons.total : useRef ? ref.total : null;
    const homeMl = useExec
      ? exec.moneyline?.home
      : useCons
        ? cons.moneyline?.home ?? game?.odds?.homeMl ?? null
        : useRef
          ? ref.moneyline?.home
          : null;
    const awayMl = useExec
      ? exec.moneyline?.away
      : useCons
        ? cons.moneyline?.away ?? game?.odds?.awayMl ?? null
        : useRef
          ? ref.moneyline?.away
          : null;
    let book = "Market";
    if (useExec) book = exec.book || "Execution";
    else if (useCons) book = cons.source === "ACTION" ? "Consensus" : cons.source || "Consensus";
    else if (useRef) book = "Reference";
    return {
      spread: spread == null || Number.isNaN(Number(spread)) ? null : Number(spread),
      total: total == null || Number.isNaN(Number(total)) ? null : Number(total),
      homeMl: homeMl == null || Number.isNaN(Number(homeMl)) ? null : Number(homeMl),
      awayMl: awayMl == null || Number.isNaN(Number(awayMl)) ? null : Number(awayMl),
      book,
      pinPresent: Boolean(ref.available || game?.odds?.pinPresent),
      marketRole: useExec ? "EXECUTION_MARKET" : useCons ? "CONSENSUS_MARKET" : useRef ? "REFERENCE_MARKET" : null,
      marketAvailable: Boolean(m.marketAvailable),
      referenceOnly: Boolean(!m.marketAvailable && ref.available),
    };
  }
  // Legacy fallback: soft/observed before Pinnacle; Pinnacle is reference-only.
  // Heritage alone is NOT execution unless explicitly listed in operatorExecutionBooks.
  const heritage = Boolean(game?.odds?.heritageListed);
  const soft = Boolean(game?.odds?.softPresent || game?.odds?.softSource);
  const pinPresent = Boolean(game?.odds?.pinPresent);
  const operatorBooks = [
    ...(Array.isArray(game?.operatorExecutionBooks) ? game.operatorExecutionBooks : []),
    ...(Array.isArray(game?.market?.operatorExecutionBooks)
      ? game.market.operatorExecutionBooks
      : []),
  ].map((b) => String(b || "").toLowerCase());
  const heritageConfigured = operatorBooks.some((b) => b.includes("heritage"));
  let spread = null;
  let total = null;
  let homeMl = null;
  let awayMl = null;
  let book = "Market";
  let marketRole = null;
  if (heritage && heritageConfigured) {
    book = "Heritage";
    marketRole = "EXECUTION_MARKET";
    spread = game?.odds?.spread ?? null;
    total = game?.odds?.total ?? null;
    homeMl = game?.odds?.heritageHomeMl ?? game?.odds?.homeMl ?? null;
    awayMl = game?.odds?.heritageAwayMl ?? game?.odds?.awayMl ?? null;
  } else if (
    heritage ||
    soft ||
    (!pinPresent && (game?.odds?.spread != null || game?.odds?.total != null))
  ) {
    if (heritage && !heritageConfigured) {
      book = "Heritage";
    } else {
      book = game?.odds?.softSource ? String(game.odds.softSource) : "Consensus";
      const softName = String(game?.odds?.softSource || "").toLowerCase();
      if (softName.includes("sharp")) book = "DK/FD";
      else if (softName.includes("rundown")) book = "Soft";
    }
    marketRole = "CONSENSUS_MARKET";
    spread = game?.odds?.spread ?? null;
    total = game?.odds?.total ?? null;
    homeMl =
      game?.odds?.heritageHomeMl ?? game?.odds?.homeMl ?? null;
    awayMl =
      game?.odds?.heritageAwayMl ?? game?.odds?.awayMl ?? null;
  } else if (pinPresent || game?.odds?.pinSpread != null || game?.odds?.pinHomeMl != null) {
    book = "Reference";
    marketRole = "REFERENCE_MARKET";
    spread = game?.odds?.pinSpread ?? game?.odds?.spread ?? null;
    total = game?.odds?.pinTotal ?? game?.odds?.total ?? null;
    homeMl = game?.odds?.pinHomeMl ?? null;
    awayMl = game?.odds?.pinAwayMl ?? null;
  }
  const marketAvailable = marketRole === "EXECUTION_MARKET" || marketRole === "CONSENSUS_MARKET";
  return {
    spread: spread == null || Number.isNaN(Number(spread)) ? null : Number(spread),
    total: total == null || Number.isNaN(Number(total)) ? null : Number(total),
    homeMl: homeMl == null || Number.isNaN(Number(homeMl)) ? null : Number(homeMl),
    awayMl: awayMl == null || Number.isNaN(Number(awayMl)) ? null : Number(awayMl),
    book,
    pinPresent,
    marketRole,
    marketAvailable,
    referenceOnly: Boolean(!marketAvailable && pinPresent),
  };
}

export function marketDeltas(game) {
  const proj = fbisProjection(game);
  const mkt = marketLines(game);
  if (!proj.available) {
    return {
      spreadDelta: null,
      totalDelta: null,
      fairHomeSpread: null,
      fairTotal: null,
      marketSpread: mkt.spread,
      marketTotal: mkt.total,
    };
  }
  const spreadDelta =
    proj.fairHomeSpread != null && mkt.spread != null ? proj.fairHomeSpread - mkt.spread : null;
  const totalDelta = proj.fairTotal != null && mkt.total != null ? proj.fairTotal - mkt.total : null;
  return {
    spreadDelta,
    totalDelta,
    fairHomeSpread: proj.fairHomeSpread,
    fairTotal: proj.fairTotal,
    marketSpread: mkt.spread,
    marketTotal: mkt.total,
  };
}

/**
 * Separate model quality from market/data quality.
 * When no applicable PURE model exists, modelQuality is null — never show a
 * market/data score as "Model Quality".
 */
export function modelQualityView(game) {
  const score = game?.cfb?.dataQuality ?? game?.quality?.score ?? null;
  const state = game?.cfb?.projectionState || game?.projectionState || null;
  const flags = game?.cfb?.flags || game?.quality?.flags || [];
  const early =
    state === "PRIOR_ONLY" ||
    flags.some((f) => /early_season|prior_only|form_missing/i.test(String(f)));
  const pure = hasPureFbisProjection(game);

  let uncertainty = "MEDIUM";
  if (early || (score != null && score < 50)) uncertainty = "HIGH";
  else if (score != null && score >= 75) uncertainty = "LOW";

  const numericScore = score == null || Number.isNaN(Number(score)) ? null : Number(score);

  const sportData =
    game?.sportDataState ||
    (early ? "EARLY-SEASON" : game?.sportDataUnavailable ? "MISSING" : "READY");
  const marketData =
    game?.marketUnresolved
      ? "PARTIAL"
      : game?.marketAvailable || game?.odds?.heritageListed || game?.odds?.softPresent || (game?.odds?.spread != null && !game?.odds?.pinPresent)
        ? "READY"
        : game?.odds?.pinPresent
          ? "REFERENCE_ONLY"
          : game?.marketUnavailable
            ? "MISSING"
            : game?.odds?.spread != null
              ? "READY"
              : "MISSING";
  const modelInputs = pure
    ? early
      ? "PARTIAL"
      : "READY"
    : "MISSING";
  const projection = pure ? "READY" : "MISSING";

  let dataState = "COMPLETE";
  if (!pure) dataState = "MARKET ONLY";
  else if (state === "LEAGUE_AVERAGE_ONLY") dataState = "BLOCKED";
  else if (early || state === "PRIOR_ONLY" || state === "PARTIAL") dataState = "EARLY-SEASON DATA";
  else if (game?.marketUnresolved || game?.marketUnavailable) dataState = "PARTIAL";
  else if (sportData !== "READY" || marketData !== "READY" || modelInputs !== "READY") {
    dataState = "PARTIAL";
  }

  return {
    // Back-compat: score only when a PURE model exists; otherwise null.
    score: pure ? numericScore : null,
    modelQuality: pure ? numericScore : null,
    marketDataQuality: numericScore,
    uncertainty: pure ? uncertainty : "N/A",
    dataState,
    sportDataState: sportData,
    marketDataState: marketData,
    modelInputsState: modelInputs,
    projectionState: projection,
    rawState: state,
    earlySeason: Boolean(early),
    hasPureModel: pure,
  };
}

export function mlbModelAgreement(game) {
  const fbisAway = game?.model?.projAway ?? game?.projAwayScore;
  const fbisHome = game?.model?.projHome ?? game?.projHomeScore;
  const palAway = game?.bpp?.awayRuns;
  const palHome = game?.bpp?.homeRuns;
  if ([fbisAway, fbisHome, palAway, palHome].some((n) => n == null || Number.isNaN(Number(n)))) {
    return { available: false, agreement: null };
  }
  const totalDelta = Number(fbisAway) + Number(fbisHome) - (Number(palAway) + Number(palHome));
  const marginDelta = Number(fbisHome) - Number(fbisAway) - (Number(palHome) - Number(palAway));
  const maxDelta = Math.max(Math.abs(totalDelta), Math.abs(marginDelta));
  const agreement = maxDelta <= 0.75 ? "AGREE" : maxDelta <= 1.5 ? "MIXED" : "DISAGREE";
  return {
    available: true,
    agreement,
    fbisAway: Number(fbisAway),
    fbisHome: Number(fbisHome),
    palAway: Number(palAway),
    palHome: Number(palHome),
  };
}

export function glowClassForTier(tier) {
  switch (tier) {
    case "CONVICTION":
      return "gc-glow-conviction";
    case "QUALIFIED":
      return "gc-glow-qualified";
    case "LEAN":
      return "gc-glow-lean";
    case "RESEARCH":
      return "gc-glow-research";
    case "RESEARCH":
      return "gc-glow-research";
    case "NO_MODEL":
      return "gc-glow-no-model";
    case "BLOCKED":
      return "gc-glow-blocked";
    default:
      return "gc-glow-pass";
  }
}

export function formatSpreadLabel(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return v > 0 ? `+${v.toFixed(1).replace(/\.0$/, "")}` : String(Number(v.toFixed(1)));
}

export function favoriteFairLabel(proj, awayAbbr, homeAbbr) {
  if (!proj?.available || proj.fairHomeSpread == null) return null;
  const line = Number(proj.fairHomeSpread);
  if (line === 0) return `PICK'EM · TOTAL ${Number(proj.fairTotal).toFixed(1)}`;
  if (line < 0) return `${homeAbbr || "HOME"} ${formatSpreadLabel(line)}`;
  return `${awayAbbr || "AWAY"} ${formatSpreadLabel(-line)}`;
}

function researchModelVersion(game) {
  return String(
    game?.researchProjection?.modelVersion ||
      game?.modelVersion ||
      game?.model?.recipe?.version ||
      game?.model?.version ||
      ""
  );
}

/**
 * Infer probability provenance for board display when the payload omits it.
 * research-v0-form is heuristic-sigma research and fails the authority contract.
 */
export function inferBoardProbabilityProvenance(game = {}) {
  if (game?.probabilityProvenance && typeof game.probabilityProvenance === "object") {
    return buildProbabilityProvenance(game.probabilityProvenance);
  }
  if (game?.model?.probabilityProvenance && typeof game.model.probabilityProvenance === "object") {
    return buildProbabilityProvenance(game.model.probabilityProvenance);
  }
  const version = researchModelVersion(game);
  const researchForm =
    version.includes("research-v0-form") ||
    (isResearchProjection(game) && String(game?.sport || "").toLowerCase() === "nfl");
  if (researchForm) {
    return buildProbabilityProvenance({
      probabilitySource: PROBABILITY_SOURCE.HEURISTIC_SIGMA,
      modelId:
        game?.researchProjection?.modelId ||
        game?.projectionEngine ||
        game?.model?.recipe?.engine ||
        "NFL-FBIS-PURE",
      modelVersion: version || "research-v0-form",
      validationStatus: "RESEARCH",
      rawProbability: finiteScore(game?.pHome ?? game?.model?.pHomeFinal ?? game?.model?.pHome),
    });
  }
  if (game?.probabilityProvenance == null && game?.model?.probabilityProvenance == null) {
    return buildProbabilityProvenance({
      probabilitySource: PROBABILITY_SOURCE.UNKNOWN,
      modelId: game?.projectionEngine || game?.model?.recipe?.engine || null,
      modelVersion: version || null,
      rawProbability: finiteScore(game?.pHome ?? game?.model?.pHomeFinal ?? game?.model?.pHome),
    });
  }
  return buildProbabilityProvenance({});
}

/** True only when probability provenance passes the probability-authority contract. */
export function boardShowsFairProbability(game) {
  const contract = probabilityDisplayContract(inferBoardProbabilityProvenance(game));
  return Boolean(contract.showFairProbability);
}

export function boardProbabilityDisplay(game) {
  return probabilityDisplayContract(inferBoardProbabilityProvenance(game));
}
