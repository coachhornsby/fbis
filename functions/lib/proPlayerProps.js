export const PRO_PLAYER_PROP_SPORTS = Object.freeze(["mlb", "nfl", "nba", "nhl"]);

export const PRO_PLAYER_PROP_MARKETS = Object.freeze({
  mlb: [
    "hits",
    "total_bases",
    "home_runs",
    "rbis",
    "runs",
    "stolen_bases",
    "strikeouts",
    "pitcher_outs",
    "earned_runs",
    "hits_allowed",
    "walks_allowed",
    "fantasy_score",
  ],
  nfl: [
    "passing_yards",
    "passing_attempts",
    "completions",
    "passing_touchdowns",
    "interceptions",
    "rushing_yards",
    "rushing_attempts",
    "receiving_yards",
    "receptions",
    "touchdowns",
  ],
  nba: [
    "points",
    "rebounds",
    "assists",
    "three_pointers_made",
    "points_rebounds_assists",
    "points_rebounds",
    "points_assists",
    "rebounds_assists",
    "steals",
    "blocks",
    "turnovers",
  ],
  nhl: [
    "shots_on_goal",
    "points",
    "goals",
    "assists",
    "saves",
  ],
});

export const PRO_PLAYER_PROP_LABELS = Object.freeze({
  hits: "Hits",
  total_bases: "Total Bases",
  home_runs: "Home Runs",
  rbis: "RBIs",
  runs: "Runs",
  stolen_bases: "Stolen Bases",
  strikeouts: "Strikeouts",
  pitcher_outs: "Pitcher Outs",
  earned_runs: "Earned Runs",
  hits_allowed: "Hits Allowed",
  walks_allowed: "Walks Allowed",
  fantasy_score: "Fantasy Score",
  passing_yards: "Pass Yards",
  passing_attempts: "Pass Attempts",
  completions: "Completions",
  passing_touchdowns: "Pass TDs",
  interceptions: "Interceptions",
  rushing_yards: "Rush Yards",
  rushing_attempts: "Rush Attempts",
  receiving_yards: "Rec Yards",
  receptions: "Receptions",
  touchdowns: "Touchdowns",
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  three_pointers_made: "3PT Made",
  points_rebounds_assists: "Pts + Reb + Ast",
  points_rebounds: "Pts + Reb",
  points_assists: "Pts + Ast",
  rebounds_assists: "Reb + Ast",
  steals: "Steals",
  blocks: "Blocks",
  turnovers: "Turnovers",
  shots_on_goal: "Shots on Goal",
  goals: "Goals",
  saves: "Saves",
});

const ALIASES = Object.freeze({
  mlb: {
    hit: "hits",
    hits: "hits",
    player_hits: "hits",
    total_bases: "total_bases",
    totalbases: "total_bases",
    player_total_bases: "total_bases",
    home_runs: "home_runs",
    homeruns: "home_runs",
    home_run: "home_runs",
    player_home_runs: "home_runs",
    rbi: "rbis",
    rbis: "rbis",
    runs_batted_in: "rbis",
    player_rbis: "rbis",
    runs: "runs",
    runs_scored: "runs",
    player_runs: "runs",
    stolen_bases: "stolen_bases",
    steals: "stolen_bases",
    player_stolen_bases: "stolen_bases",
    strikeouts: "strikeouts",
    pitcher_strikeouts: "strikeouts",
    pitching_strikeouts: "strikeouts",
    player_strikeouts: "strikeouts",
    pitcher_outs: "pitcher_outs",
    pitching_outs: "pitcher_outs",
    outs_recorded: "pitcher_outs",
    earned_runs: "earned_runs",
    earned_runs_allowed: "earned_runs",
    hits_allowed: "hits_allowed",
    pitcher_hits_allowed: "hits_allowed",
    walks_allowed: "walks_allowed",
    pitcher_walks: "walks_allowed",
    bases_on_balls_allowed: "walks_allowed",
    fantasy_score: "fantasy_score",
    fantasy_points: "fantasy_score",
  },
  nfl: {
    passing_yards: "passing_yards",
    pass_yards: "passing_yards",
    pass_yds: "passing_yards",
    passing_attempts: "passing_attempts",
    pass_attempts: "passing_attempts",
    completions: "completions",
    pass_completions: "completions",
    passing_touchdowns: "passing_touchdowns",
    pass_touchdowns: "passing_touchdowns",
    passing_tds: "passing_touchdowns",
    interceptions: "interceptions",
    passing_interceptions: "interceptions",
    rushing_yards: "rushing_yards",
    rush_yards: "rushing_yards",
    rushing_attempts: "rushing_attempts",
    rush_attempts: "rushing_attempts",
    receiving_yards: "receiving_yards",
    rec_yards: "receiving_yards",
    receptions: "receptions",
    catches: "receptions",
    touchdowns: "touchdowns",
    anytime_touchdown: "touchdowns",
    anytime_td: "touchdowns",
  },
  nba: {
    points: "points",
    player_points: "points",
    rebounds: "rebounds",
    player_rebounds: "rebounds",
    assists: "assists",
    player_assists: "assists",
    three_pointers_made: "three_pointers_made",
    threes_made: "three_pointers_made",
    made_threes: "three_pointers_made",
    points_rebounds_assists: "points_rebounds_assists",
    pra: "points_rebounds_assists",
    points_rebounds: "points_rebounds",
    points_assists: "points_assists",
    rebounds_assists: "rebounds_assists",
    steals: "steals",
    blocks: "blocks",
    turnovers: "turnovers",
  },
  nhl: {
    shots_on_goal: "shots_on_goal",
    shots: "shots_on_goal",
    sog: "shots_on_goal",
    points: "points",
    goals: "goals",
    assists: "assists",
    saves: "saves",
    goalie_saves: "saves",
  },
});

function cleanToken(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function normalizeProPropSport(raw) {
  const sport = cleanToken(raw);
  if (sport === "baseball" || sport === "major_league_baseball") return "mlb";
  if (sport === "football" || sport === "national_football_league") return "nfl";
  if (sport === "basketball" || sport === "national_basketball_association") return "nba";
  if (sport === "hockey" || sport === "national_hockey_league") return "nhl";
  return PRO_PLAYER_PROP_SPORTS.includes(sport) ? sport : null;
}

export function isProPlayerPropSport(raw) {
  return Boolean(normalizeProPropSport(raw));
}

export function canonicalizeProPlayerPropMarket(sportRaw, marketRaw) {
  const sport = normalizeProPropSport(sportRaw);
  if (!sport || marketRaw == null || marketRaw === "") return null;
  const token = cleanToken(marketRaw)
    .replace(/^core_bet_type_\d+_/, "")
    .replace(/^player_/, "");
  const aliases = ALIASES[sport] || {};
  if (aliases[token]) return aliases[token];

  // Action labels can contain numeric/core prefixes. Match only distinctive suffixes.
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (token === alias || token.endsWith(`_${alias}`)) return canonical;
  }
  return null;
}

export function isSupportedProPlayerPropMarket(sportRaw, marketRaw) {
  const sport = normalizeProPropSport(sportRaw);
  const canonical = canonicalizeProPlayerPropMarket(sport, marketRaw) || cleanToken(marketRaw);
  return Boolean(sport && (PRO_PLAYER_PROP_MARKETS[sport] || []).includes(canonical));
}

export function mlbHeadshotUrl(mlbId) {
  if (mlbId == null || String(mlbId).trim() === "") return null;
  const id = String(mlbId).trim();
  if (!/^\d+$/.test(id)) return null;
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_180,q_100/v1/people/${id}/headshot/67/current`;
}

export function extractMlbId(row = {}) {
  const candidates = [
    row.mlbId,
    row.mlbID,
    row.mlbamId,
    row.mlbamID,
    row.mlbPlayerId,
    row.mlb_player_id,
    row.leaguePlayerId,
    row.league_player_id,
  ];
  for (const value of candidates) {
    if (value != null && /^\d+$/.test(String(value).trim())) return String(value).trim();
  }
  return null;
}
