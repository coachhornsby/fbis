/**
 * CFBD endpoint probe plan for the read-only cfbd-endpoint-audit job.
 * Paths are from the current CFBD OpenAPI (api.collegefootballdata.com).
 * Do not assume legacy aliases without probing them as separate rows.
 */

export const CFBD_AUDIT_SOURCE_VERSION = "cfbd-openapi-4.6.3";
export const CFBD_AUDIT_BASE = "https://api.collegefootballdata.com";

/** Known week used when an endpoint requires week+year (regular-season mid slate). */
export const AUDIT_KNOWN_WEEK = {
  season: 2025,
  week: 8,
  seasonType: "regular",
};

/**
 * Each probe: family, path, query builders for current + historical seasons.
 * Prefer year-bounded queries. Week only when required.
 */
export const CFBD_ENDPOINT_PROBES = [
  // CORE
  { family: "core", endpoint: "/games", query: (y, w) => ({ year: y, seasonType: "regular", ...(w ? { week: w } : {}) }) },
  { family: "core", endpoint: "/teams", query: (y) => ({ year: y }) },
  { family: "core", endpoint: "/teams/fbs", query: (y) => ({ year: y }) },
  { family: "core", endpoint: "/conferences", query: () => ({}) },
  { family: "core", endpoint: "/venues", query: () => ({}) },
  { family: "core", endpoint: "/calendar", query: (y) => ({ year: y }) },
  { family: "core", endpoint: "/records", query: (y) => ({ year: y }) },

  // TEAM STATS
  { family: "team-stats", endpoint: "/stats/season", query: (y) => ({ year: y }) },
  { family: "team-stats", endpoint: "/games/teams", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, seasonType: "regular" }), requiresWeek: true },

  // ADVANCED
  { family: "advanced", endpoint: "/ppa/teams", query: (y) => ({ year: y, seasonType: "regular" }) },
  { family: "advanced", endpoint: "/ppa/games", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, seasonType: "regular" }), requiresWeek: true },
  { family: "advanced", endpoint: "/ppa/players/season", query: (y) => ({ year: y, position: "QB" }) },
  { family: "advanced", endpoint: "/ppa/players/games", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, position: "QB" }), requiresWeek: true },
  { family: "advanced", endpoint: "/ppa/predicted", query: (y) => ({ year: y, week: 1 }), requiresWeek: true, note: "needs week; prior probe used year-only → INVALID-PARAMETERS" },
  { family: "advanced", endpoint: "/stats/season/advanced", query: (y) => ({ year: y }) },
  { family: "advanced", endpoint: "/stats/game/advanced", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, seasonType: "regular" }), requiresWeek: true },
  { family: "advanced", endpoint: "/game/box/advanced", query: () => ({ id: 401628464 }), note: "requires game id; year/week probe is INVALID-PARAMETERS" },
  { family: "advanced", endpoint: "/ratings/sp", query: (y) => ({ year: y }) },
  { family: "advanced", endpoint: "/ratings/sp/conferences", query: (y) => ({ year: y }) },
  { family: "advanced", endpoint: "/ratings/fpi", query: (y) => ({ year: y }) },
  { family: "advanced", endpoint: "/ratings/srs", query: (y) => ({ year: y }) },
  { family: "advanced", endpoint: "/ratings/srs/expanded", query: (y) => ({ year: y }), aliasOf: "/ratings/srs", note: "legacy alias; live audit shows AVAILABLE" },
  { family: "advanced", endpoint: "/ratings/elo", query: (y) => ({ year: y }) },
  { family: "advanced", endpoint: "/ratings/core", query: (y) => ({ year: y }), note: "AVAILABLE; exposes throughWeek for temporal bounding" },

  // PLAYER
  { family: "player", endpoint: "/stats/player/season", query: (y) => ({ year: y, category: "passing" }) },
  { family: "player", endpoint: "/player/usage", query: (y) => ({ year: y }) },
  { family: "player", endpoint: "/player/returning", query: (y) => ({ year: y }) },
  { family: "player", endpoint: "/player/search", query: () => ({ searchTerm: "a" }), note: "smoke search only" },
  { family: "player", endpoint: "/games/players", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, seasonType: "regular", category: "passing" }), requiresWeek: true },

  // RECRUITING / ROSTER
  { family: "personnel", endpoint: "/talent", query: (y) => ({ year: y }) },
  { family: "personnel", endpoint: "/recruiting/teams", query: (y) => ({ year: y }) },
  { family: "personnel", endpoint: "/recruiting/players", query: (y) => ({ year: y }) },
  { family: "personnel", endpoint: "/recruiting/groups", query: (y) => ({ year: y }) },
  { family: "personnel", endpoint: "/roster", query: (y) => ({ year: y, team: "Ohio State" }), note: "team-scoped smoke" },
  { family: "personnel", endpoint: "/player/portal", query: (y) => ({ year: y }) },
  { family: "personnel", endpoint: "/coaches", query: (y) => ({ year: y }) },

  // CONTEXT
  { family: "context", endpoint: "/games/weather", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, seasonType: "regular" }), requiresWeek: true },
  { family: "context", endpoint: "/games/media", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, seasonType: "regular" }), requiresWeek: true },

  // MARKET (evaluation only — never independent score)
  { family: "market", endpoint: "/lines", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, seasonType: "regular" }), requiresWeek: true },

  // GAME / PLAY
  { family: "plays", endpoint: "/scoreboard", query: () => ({}) },
  { family: "plays", endpoint: "/plays", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, team: "Ohio State", seasonType: "regular" }), requiresWeek: true },
  { family: "plays", endpoint: "/drives", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, team: "Ohio State", seasonType: "regular" }), requiresWeek: true },
  { family: "plays", endpoint: "/live/plays", query: () => ({}), note: "live only when games in progress; empty/invalid off-window" },
  { family: "plays", endpoint: "/metrics/wp", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week, team: "Ohio State", seasonType: "regular" }), requiresWeek: true, note: "may require gameId; year/week/team alone can be INVALID-PARAMETERS" },
  { family: "plays", endpoint: "/metrics/wp/pregame", query: (y, w) => ({ year: y, week: w || AUDIT_KNOWN_WEEK.week }), requiresWeek: true },
  { family: "plays", endpoint: "/metrics/fg/ep", query: () => ({}) },
  { family: "plays", endpoint: "/stats/categories", query: () => ({}) },
];
