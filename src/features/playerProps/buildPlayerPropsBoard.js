import { toDomainTodayBoard } from "../../../functions/lib/fbisDomain.js";
import { probabilityAtThreshold } from "../../../functions/lib/cfbPlayerModel.js";
import { identityForSport } from "../../../functions/lib/teams.js";

/**
 * Attach FBIS projection analytics when upstream provided them.
 * May derive over/under probability from projection + sigma + line only —
 * never invents a projection or price.
 */
export function withFbisPropAnalytics(row = {}) {
  const fbisProjection =
    row.fbisProjection ?? row.projection ?? row.average ?? row.proj ?? null;
  const fbisSigma = row.fbisSigma ?? row.sigma ?? null;
  const line = row.line ?? null;
  let probabilityOver = row.probabilityOver ?? row.pMore ?? null;
  let probabilityUnder = row.probabilityUnder ?? row.pLess ?? null;

  if (
    (probabilityOver == null || probabilityUnder == null) &&
    Number.isFinite(Number(fbisProjection)) &&
    Number.isFinite(Number(fbisSigma)) &&
    Number(fbisSigma) > 0 &&
    Number.isFinite(Number(line))
  ) {
    const derived = probabilityAtThreshold(
      { projection: Number(fbisProjection), sigma: Number(fbisSigma) },
      Number(line),
    );
    probabilityOver = derived.probabilityOver;
    probabilityUnder = derived.probabilityUnder;
  }

  const edge = row.edge ?? row.ev ?? null;
  const projectionDelta =
    fbisProjection != null &&
    line != null &&
    Number.isFinite(Number(fbisProjection)) &&
    Number.isFinite(Number(line))
      ? Number(fbisProjection) - Number(line)
      : null;

  const finiteOrNull = (v) =>
    v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);

  const enriched = {
    ...row,
    fbisProjection: finiteOrNull(fbisProjection),
    fbisSigma: finiteOrNull(fbisSigma),
    probabilityOver: finiteOrNull(probabilityOver),
    probabilityUnder: finiteOrNull(probabilityUnder),
    probability: finiteOrNull(row.probability),
    edge: finiteOrNull(edge),
    projectionDelta,
  };
  return {
    ...enriched,
    ...rankPropConviction(enriched),
  };
}

/**
 * Rank mispricing / conviction from real FBIS signals only.
 * Higher convictionScore = more mispriced. No signal → sorts last.
 */
export function rankPropConviction(row = {}) {
  const pOverRaw = row.probabilityOver;
  const pUnderRaw = row.probabilityUnder;
  const edgeRaw = row.edge;
  const deltaRaw = row.projectionDelta;
  const sigmaRaw = row.fbisSigma;
  const projRaw = row.fbisProjection;

  const pOver = pOverRaw == null || pOverRaw === "" ? NaN : Number(pOverRaw);
  const pUnder = pUnderRaw == null || pUnderRaw === "" ? NaN : Number(pUnderRaw);
  const edge = edgeRaw == null || edgeRaw === "" ? NaN : Number(edgeRaw);
  const delta = deltaRaw == null || deltaRaw === "" ? NaN : Number(deltaRaw);
  const sigma = sigmaRaw == null || sigmaRaw === "" ? NaN : Number(sigmaRaw);
  const hasProb = Number.isFinite(pOver) && Number.isFinite(pUnder);
  const hasEdge = Number.isFinite(edge);
  const hasDelta = Number.isFinite(delta);
  const hasProj = projRaw != null && projRaw !== "" && Number.isFinite(Number(projRaw));

  if (!hasProj && !hasProb && !hasEdge) {
    return {
      convictionScore: -1,
      convictionTier: "NONE",
      convictionLean: null,
      leanProbability: null,
      mispricingZ: null,
    };
  }

  let lean = null;
  let leanProbability = null;
  if (hasProb) {
    lean = pOver >= pUnder ? "MORE" : "LESS";
    leanProbability = Math.max(pOver, pUnder);
  } else if (hasDelta && delta !== 0) {
    lean = delta > 0 ? "MORE" : "LESS";
  } else if (hasEdge && edge !== 0) {
    // Positive edge assumed on the conviction side when side is present.
    const side = String(row.projectionSide || row.side || "").toUpperCase();
    if (side === "OVER" || side === "MORE") lean = "MORE";
    else if (side === "UNDER" || side === "LESS") lean = "LESS";
    else lean = edge > 0 ? "MORE" : "LESS";
  }

  const mispricingZ =
    hasDelta && Number.isFinite(sigma) && sigma > 0 ? delta / sigma : null;

  const absEdge = hasEdge ? Math.abs(edge > 1 ? edge / 100 : edge) : null;
  const probEdge = leanProbability != null ? Math.max(0, leanProbability - 0.5) : 0;
  const zEdge = mispricingZ != null ? Math.abs(mispricingZ) : 0;

  // Weighted research score — probability lean dominates, then edge, then z.
  const convictionScore =
    probEdge * 200 +
    (absEdge != null ? absEdge * 100 : 0) +
    zEdge * 12 +
    (hasProj ? 0.01 : 0);

  let convictionTier = "WATCH";
  if (
    (leanProbability != null && leanProbability >= 0.7) ||
    (absEdge != null && absEdge >= 0.08) ||
    zEdge >= 1
  ) {
    convictionTier = "CONVICTION";
  } else if (
    (leanProbability != null && leanProbability >= 0.62) ||
    (absEdge != null && absEdge >= 0.05) ||
    zEdge >= 0.6
  ) {
    convictionTier = "STRONG";
  } else if (
    (leanProbability != null && leanProbability >= 0.55) ||
    (absEdge != null && absEdge >= 0.03) ||
    zEdge >= 0.35
  ) {
    convictionTier = "LEAN";
  } else if (!hasProj && !hasProb && !hasEdge) {
    convictionTier = "NONE";
  }

  return {
    convictionScore,
    convictionTier,
    convictionLean: lean,
    leanProbability: leanProbability != null ? leanProbability : null,
    mispricingZ,
  };
}

export function sortPropsByConviction(rows = []) {
  return [...(rows || [])].sort((a, b) => {
    const sa = Number(a?.convictionScore);
    const sb = Number(b?.convictionScore);
    const aScore = Number.isFinite(sa) ? sa : -1;
    const bScore = Number.isFinite(sb) ? sb : -1;
    if (bScore !== aScore) return bScore - aScore;
    const nameA = String(a?.playerName || "");
    const nameB = String(b?.playerName || "");
    return nameA.localeCompare(nameB);
  });
}

/**
 * Resolve the player's team identity (logo/abbr/name) from the event sides,
 * falling back to the shared team catalog. Never invents a logo URL.
 */
export function resolvePlayerTeamIdentity(event = {}, teamKey = null) {
  const needle = String(teamKey || "").trim().toLowerCase();
  const sides = [event?.teams?.away, event?.teams?.home].filter(Boolean);
  const match = needle
    ? sides.find((t) => {
        const keys = [t.abbr, t.name, t.school, t.fullName]
          .filter(Boolean)
          .map((v) => String(v).trim().toLowerCase());
        return keys.includes(needle);
      })
    : null;
  if (match?.logoUrl || match?.logo || match?.abbr || match?.name) {
    return {
      abbr: match.abbr || null,
      name: match.name || match.fullName || match.school || null,
      logo: match.logoUrl || match.logo || null,
    };
  }
  if (!teamKey) return { abbr: null, name: null, logo: null };
  const resolved = identityForSport(event?.sport, teamKey);
  return {
    abbr: resolved?.abbr && resolved.abbr !== "—" ? resolved.abbr : String(teamKey),
    name: resolved?.name || String(teamKey),
    logo: resolved?.logo || null,
  };
}

/** FBIS-supported football player markets for product surfaces. */
export const FBIS_PLAYER_MARKETS = Object.freeze([
  "passing_yards",
  "passing_attempts",
  "completions",
  "rushing_yards",
  "rushing_attempts",
  "receptions",
  "receiving_yards",
]);

/** Human-readable labels — never show snake_case in the product UI. */
export const MARKET_LABELS = Object.freeze({
  passing_yards: "Pass Yards",
  passing_attempts: "Pass Attempts",
  completions: "Completions",
  rushing_yards: "Rush Yards",
  rushing_attempts: "Rush Attempts",
  receptions: "Receptions",
  receiving_yards: "Rec Yards",
});

export function formatMarketLabel(canonicalOrRaw) {
  if (!canonicalOrRaw) return "Player Prop";
  const key = String(canonicalOrRaw).trim();
  if (MARKET_LABELS[key]) return MARKET_LABELS[key];
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (/^(td|qb|rb|wr|te|fg|xp)$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Map propConvictions → playerMarkets when upstream only has convictions.
 * Same adapter used by Today command center — never invents eligibility.
 */
export function normalizeBoardGame(game = {}) {
  if (Array.isArray(game.playerMarkets) && game.playerMarkets.length) return game;
  const convictions = game.propConvictions || [];
  if (!convictions.length) return game;
  return {
    ...game,
    playerMarkets: convictions.map((c) => ({
      playerName: c.playerName,
      team: c.team,
      position: c.position,
      market: c.marketLabel || c.market,
      marketCanonical: c.market,
      line: c.line,
      overOdds: c.price,
      book: c.book,
      fbisProjection: c.projection ?? c.average ?? null,
      fbisSigma: c.sigma ?? null,
      probability: c.probability ?? null,
      probabilityOver:
        c.probabilityOver ??
        (String(c.side || "").toUpperCase() === "OVER" ||
        String(c.side || "").toUpperCase() === "MORE"
          ? c.probability
          : null),
      probabilityUnder:
        c.probabilityUnder ??
        (String(c.side || "").toUpperCase() === "UNDER" ||
        String(c.side || "").toUpperCase() === "LESS"
          ? c.probability
          : null),
      edge: c.ev ?? c.edge ?? null,
      decisionEligible: false,
      reasonCodes: ["PROP_CONVICTION_RESEARCH_ONLY"],
    })),
  };
}

/**
 * Build the Player Props board from a today board payload.
 * Never invents rows, prices, or decision eligibility.
 */
export function buildPlayerPropsBoard(board = {}, opts = {}) {
  const sportFilter = opts.sportFilter || "all";
  const rawGames = Array.isArray(board?.games)
    ? board.games
    : (board?.groups || []).flatMap((g) => g.games || []);
  const domain = toDomainTodayBoard(
    {
      date: board?.date || opts.date || null,
      games: rawGames.map(normalizeBoardGame),
      counts: board?.counts,
    },
    {
      sportFilter,
      date: board?.date || opts.date || null,
      generatedAt: board?.domain?.generatedAt || opts.generatedAt || null,
    },
  );

  const allRows = [];
  for (const event of domain.events || []) {
    for (const pm of event.playerMarkets || []) {
      const canonical = pm.marketCanonical || null;
      const supportedMarket = canonical
        ? FBIS_PLAYER_MARKETS.includes(canonical)
        : false;
      const teamIdentity = resolvePlayerTeamIdentity(event, pm.team);
      allRows.push(
        withFbisPropAnalytics({
          ...pm,
          eventId: event.id,
          sport: event.sport,
          league: event.league,
          startCt: event.startCt,
          matchup: {
            away: event.teams?.away?.abbr || event.teams?.away?.name || null,
            home: event.teams?.home?.abbr || event.teams?.home?.name || null,
          },
          teamIdentity,
          supportedMarket,
          surfaceStatus: pm.decisionEligible ? "WATCHLIST" : "RESEARCH",
          modelAuthorized: false,
        }),
      );
    }
  }

  const byMarket = Object.fromEntries(FBIS_PLAYER_MARKETS.map((id) => [id, 0]));
  for (const r of allRows) {
    if (r.marketCanonical && byMarket[r.marketCanonical] != null) {
      byMarket[r.marketCanonical] += 1;
    }
  }

  const supportedRows = allRows.filter((r) => r.supportedMarket);
  const scoped = opts.supportedOnly === false ? allRows : supportedRows;
  const rows = sortPropsByConviction(scoped);
  const rankedAllRows = sortPropsByConviction(allRows);

  return {
    date: domain.date,
    generatedAt: domain.generatedAt,
    sportFilter,
    rows,
    allRows: rankedAllRows,
    counts: {
      rows: rows.length,
      eventsWithProps: new Set(rows.map((r) => r.eventId).filter(Boolean)).size,
      supportedRows: supportedRows.length,
      unsupportedRows: allRows.length - supportedRows.length,
      byMarket,
      decisionEligible: rows.filter((r) => r.decisionEligible).length,
    },
    readiness: {
      // Successful parsing ≠ production market readiness.
      classification: "RESEARCH_READY",
      modelAuthorized: false,
      decisionEligible: false,
      note: "Player props remain research-only until model authority is earned.",
    },
    schemaVersion: "fbis-player-props-board-v1",
  };
}

export function groupPlayerPropRows(rows = []) {
  const byPlayer = new Map();
  for (const row of rows || []) {
    const key =
      row.fbisPlayerId ||
      row.providerPlayerId ||
      `${row.playerName || "unknown"}|${row.team || ""}|${row.eventId || ""}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        key,
        fbisPlayerId: row.fbisPlayerId || null,
        providerPlayerId: row.providerPlayerId || null,
        playerName: row.playerName || null,
        team: row.team || null,
        teamIdentity: row.teamIdentity || null,
        position: row.position || null,
        imageUrl: row.imageUrl || null,
        imageSource: row.imageSource || null,
        sport: row.sport || null,
        eventId: row.eventId || null,
        matchup: row.matchup || null,
        playerIdentityConfidence: row.playerIdentityConfidence || "UNKNOWN",
        markets: [],
      });
    }
    byPlayer.get(key).markets.push(row);
  }
  return [...byPlayer.values()];
}
