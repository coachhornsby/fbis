/**
 * Presentation-layer board decision, sort, and display helpers.
 * Does not change qualification / betting logic — only maps existing fields.
 *
 * PASS means: an eligible FBIS model evaluated this market and no qualifying
 * wager was found. Missing PURE projection is NO_MODEL, never PASS.
 */

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

export function hasPureFbisProjection(game) {
  if (!game) return false;
  if (game.projectionUnavailable) return false;
  if (game.pureProjectionAvailable === false) return false;
  if (game.cfb?.projectionState === "LEAGUE_AVERAGE_ONLY") return false;

  const kind = String(
    game.projectionKind || game.projectionState || game.model?.projectionKind || ""
  ).toUpperCase();
  if (MARKET_IMPLIED_KINDS.has(kind)) return false;
  if (kind === "UNAVAILABLE" || kind === "NONE" || kind === "NO_MODEL") return false;

  // Research FBIS scores count as pure for display / freeze / publish — not for PASS.
  if (kind === "FBIS" || kind === "PURE" || kind === "FBIS_PURE") {
    const away = game?.model?.projAway ?? game?.projAwayScore ?? null;
    const home = game?.model?.projHome ?? game?.projHomeScore ?? null;
    if (away == null || home == null) return false;
    if (Number.isNaN(Number(away)) || Number.isNaN(Number(home))) return false;
    return true;
  }

  const sport = String(game.sport || "").toLowerCase();
  if (sport === "nfl") return false;

  const away = game?.model?.projAway ?? game?.projAwayScore ?? null;
  const home = game?.model?.projHome ?? game?.projHomeScore ?? null;
  if (away == null || home == null) return false;
  if (Number.isNaN(Number(away)) || Number.isNaN(Number(home))) return false;
  return true;
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
  const available = hasPureFbisProjection(game);
  const away = game?.model?.projAway ?? game?.projAwayScore ?? null;
  const home = game?.model?.projHome ?? game?.projHomeScore ?? null;
  if (!available) {
    return {
      available: false,
      away: null,
      home: null,
      total: null,
      margin: null,
      fairHomeSpread: null,
      fairTotal: null,
      kind: game?.projectionKind || null,
      state: game?.cfb?.projectionState || game?.projectionState || null,
    };
  }
  const a = Number(away);
  const h = Number(home);
  const margin = h - a;
  const total = a + h;
  return {
    available: true,
    away: a,
    home: h,
    total,
    margin,
    // Home spread: if home favored by M, line is -M.
    fairHomeSpread: -margin,
    fairTotal: total,
    kind: game?.projectionKind || "FBIS",
    state: game?.cfb?.projectionState || game?.projectionState || null,
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
  const spread = game?.odds?.pinSpread ?? game?.odds?.spread ?? null;
  const total = game?.odds?.pinTotal ?? game?.odds?.total ?? null;
  const homeMl = game?.odds?.pinHomeMl ?? game?.odds?.homeMl ?? null;
  const awayMl = game?.odds?.pinAwayMl ?? game?.odds?.awayMl ?? null;
  const pinPresent = Boolean(game?.odds?.pinPresent);
  let book = "Market";
  if (pinPresent || game?.odds?.pinSpread != null || game?.odds?.pinHomeMl != null) book = "Pinnacle";
  else if (game?.odds?.heritageListed) book = "Heritage";
  else if (game?.odds?.softSource) {
    const soft = String(game.odds.softSource).toLowerCase();
    if (soft.includes("sharp")) book = "DK/FD";
    else if (soft.includes("rundown")) book = "Soft";
    else book = soft;
  }
  return {
    spread: spread == null || Number.isNaN(Number(spread)) ? null : Number(spread),
    total: total == null || Number.isNaN(Number(total)) ? null : Number(total),
    homeMl: homeMl == null || Number.isNaN(Number(homeMl)) ? null : Number(homeMl),
    awayMl: awayMl == null || Number.isNaN(Number(awayMl)) ? null : Number(awayMl),
    book,
    pinPresent,
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
    game?.marketUnresolved || game?.marketUnavailable
      ? "PARTIAL"
      : game?.odds?.pinPresent || game?.odds?.spread != null
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
