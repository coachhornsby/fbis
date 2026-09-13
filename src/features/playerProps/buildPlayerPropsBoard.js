import { toDomainTodayBoard } from "../../../functions/lib/fbisDomain.js";

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
      allRows.push({
        ...pm,
        eventId: event.id,
        sport: event.sport,
        league: event.league,
        startCt: event.startCt,
        matchup: {
          away: event.teams?.away?.abbr || event.teams?.away?.name || null,
          home: event.teams?.home?.abbr || event.teams?.home?.name || null,
        },
        supportedMarket,
        surfaceStatus: pm.decisionEligible ? "WATCHLIST" : "RESEARCH",
        modelAuthorized: false,
      });
    }
  }

  const byMarket = Object.fromEntries(FBIS_PLAYER_MARKETS.map((id) => [id, 0]));
  for (const r of allRows) {
    if (r.marketCanonical && byMarket[r.marketCanonical] != null) {
      byMarket[r.marketCanonical] += 1;
    }
  }

  const supportedRows = allRows.filter((r) => r.supportedMarket);
  const rows = opts.supportedOnly === false ? allRows : supportedRows;

  return {
    date: domain.date,
    generatedAt: domain.generatedAt,
    sportFilter,
    rows,
    allRows,
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
