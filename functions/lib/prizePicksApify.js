import { buildCuratedPrizePicksScope } from "./propMarketPolicy.js";

export const PRIZEPICKS_APIFY_PROVIDER = "PRIZEPICKS_APIFY";
export const PRIZEPICKS_APIFY_ACTOR_ID = "zen-studio/prizepicks-player-props";
export const PRIZEPICKS_RUN_START_USD = 0.05;
export const PRIZEPICKS_PER_PROJECTION_USD = 0.00005;

export function estimatePrizePicksCostUsd(projections = 0, runs = 1) {
  return Math.round((Math.max(0, Number(runs)||0) * PRIZEPICKS_RUN_START_USD +
    Math.max(0, Number(projections)||0) * PRIZEPICKS_PER_PROJECTION_USD) * 10000) / 10000;
}

/**
 * One actor call can only express one statTypes union across selected leagues.
 * To avoid buying unrelated cross-products, plan one tightly-scoped run per sport.
 */
export function planPrizePicksRuns({ sports = [], playerNamesBySport = {}, teamsBySport = {}, includeResearch = true } = {}) {
  return buildCuratedPrizePicksScope(sports, { includeResearch }).map(({ sport, league, markets }) => {
    const input = {
      leagues: [league],
      statTypes: markets.join(", "),
    };
    const players = playerNamesBySport?.[sport];
    const teams = teamsBySport?.[sport];
    if (Array.isArray(players) && players.length) input.playerNames = players.join(", ");
    if (Array.isArray(teams) && teams.length) input.teams = teams.join(", ");
    return { provider: PRIZEPICKS_APIFY_PROVIDER, actorId: PRIZEPICKS_APIFY_ACTOR_ID, sport, input, markets };
  });
}

export function normalizePrizePicksProjection(row = {}) {
  return {
    provider: PRIZEPICKS_APIFY_PROVIDER,
    projectionId: row.projection_id ?? null,
    playerId: row.player_id ?? row.player_ppid ?? null,
    playerName: row.player_name ?? row.player_full_name ?? null,
    team: row.player_team ?? null,
    position: row.player_position ?? null,
    league: row.league ?? row.player_league ?? null,
    gameId: row.game_id ?? row.game_external_id ?? null,
    homeTeam: row.home_team ?? null,
    awayTeam: row.away_team ?? null,
    startTime: row.start_time ?? row.game_start ?? null,
    stat: row.stat_short ?? row.stat ?? null,
    line: row.line == null ? null : Number(row.line),
    oddsTier: row.odds_tier ?? null,
    allowedWagerTypes: row.allowed_wager_types ?? null,
    duration: row.duration ?? null,
    isPromo: row.is_promo === true,
    updatedAt: row.updated_at ?? null,
    boardTime: row.board_time ?? null,
    raw: row,
  };
}
