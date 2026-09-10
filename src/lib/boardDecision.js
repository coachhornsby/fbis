/**
 * Presentation-layer board decision, sort, and display helpers.
 * Does not change qualification / betting logic — only maps existing fields.
 */

export const DECISION_ORDER = Object.freeze({
  CONVICTION: 0,
  QUALIFIED: 1,
  LEAN: 2,
  PASS: 3,
  BLOCKED: 4,
});

const CT = "America/Chicago";

export function isBlockedGame(game) {
  if (!game) return true;
  if (game.qualificationBlocked) return true;
  if (game.projectionUnavailable) return true;
  if (game.cfb && game.cfb.bettingAllowed === false) return true;
  if (game.cfb?.projectionState === "LEAGUE_AVERAGE_ONLY") return true;
  if (game.blockReason && !game.rec && !game.lean) return true;
  return false;
}

/**
 * Map existing rec/lean/block fields onto the customer board taxonomy.
 * STRONG/STANDARD qualified tags display as QUALIFIED (not a new taxonomy).
 */
export function boardDecision(game) {
  if (game?.rec) {
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
    };
  }
  if (isBlockedGame(game)) {
    return {
      tier: "BLOCKED",
      label: "BLOCKED",
      pick: null,
      market: null,
      reason: game?.cfb?.blockReason || game?.blockReason || game?.noPlayReason || "Unavailable",
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
    };
  }
  return {
    tier: "PASS",
    label: "PASS",
    pick: null,
    market: null,
    reason: null,
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
  if (f === "HIDE_BLOCKED") return games.filter((g) => boardDecision(g).tier !== "BLOCKED");
  return games.filter((g) => boardDecision(g).tier === f);
}

export function boardDecisionCounts(games = []) {
  const counts = { ALL: games.length, CONVICTION: 0, QUALIFIED: 0, LEAN: 0, PASS: 0, BLOCKED: 0 };
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
  const unavailable =
    game?.projectionUnavailable ||
    game?.sport === "nfl" ||
    game?.projectionKind === "PINNACLE_IMPLIED" ||
    game?.cfb?.projectionState === "LEAGUE_AVERAGE_ONLY";
  const away = game?.model?.projAway ?? game?.projAwayScore ?? null;
  const home = game?.model?.projHome ?? game?.projHomeScore ?? null;
  if (unavailable || away == null || home == null || Number.isNaN(Number(away)) || Number.isNaN(Number(home))) {
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
    return { spreadDelta: null, totalDelta: null, fairHomeSpread: null, fairTotal: null, marketSpread: mkt.spread, marketTotal: mkt.total };
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

export function modelQualityView(game) {
  const score = game?.cfb?.dataQuality ?? game?.quality?.score ?? null;
  const state = game?.cfb?.projectionState || game?.projectionState || null;
  const flags = game?.cfb?.flags || game?.quality?.flags || [];
  const early =
    state === "PRIOR_ONLY" ||
    flags.some((f) => /early_season|prior_only|form_missing/i.test(String(f)));
  let uncertainty = "MEDIUM";
  if (early || (score != null && score < 50)) uncertainty = "HIGH";
  else if (score != null && score >= 75) uncertainty = "LOW";
  let dataState = "COMPLETE";
  if (state === "LEAGUE_AVERAGE_ONLY") dataState = "BLOCKED";
  else if (early || state === "PRIOR_ONLY" || state === "PARTIAL") dataState = "EARLY-SEASON DATA";
  else if (game?.marketUnresolved || game?.marketUnavailable) dataState = "PARTIAL";
  return {
    score: score == null || Number.isNaN(Number(score)) ? null : Number(score),
    uncertainty,
    dataState,
    rawState: state,
    earlySeason: Boolean(early),
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
