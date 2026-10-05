/**
 * FBIS curated player-prop acquisition policy.
 *
 * Principle: do not buy or evaluate every listed prop. Only acquire markets that
 * map to an FBIS model/research program. Research markets remain non-authoritative
 * until their own validation earns promotion.
 */
export const PROP_MARKET_STATUS = Object.freeze({
  PRIMARY: "PRIMARY",
  RESEARCH: "RESEARCH",
  BLOCKED: "BLOCKED",
});

export const CURATED_PROP_POLICY = Object.freeze({
  mlb: Object.freeze({
    league: "MLB",
    markets: Object.freeze({
      "Pitcher Strikeouts": PROP_MARKET_STATUS.PRIMARY,
      "Pitching Outs": PROP_MARKET_STATUS.PRIMARY,
    }),
  }),
  tennis: Object.freeze({
    league: "Tennis",
    markets: Object.freeze({
      "Total Games": PROP_MARKET_STATUS.PRIMARY,
      "Total Games Won": PROP_MARKET_STATUS.RESEARCH,
      "Total Sets": PROP_MARKET_STATUS.RESEARCH,
      "Aces": PROP_MARKET_STATUS.RESEARCH,
      "Break Points Won": PROP_MARKET_STATUS.RESEARCH,
      "Fantasy Score": PROP_MARKET_STATUS.RESEARCH,
      "Total Tie Breaks": PROP_MARKET_STATUS.RESEARCH,
      "Double Faults": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
  nba: Object.freeze({
    league: "NBA",
    markets: Object.freeze({
      Points: PROP_MARKET_STATUS.RESEARCH,
      Rebounds: PROP_MARKET_STATUS.RESEARCH,
      Assists: PROP_MARKET_STATUS.RESEARCH,
      "3PTM": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
  wnba: Object.freeze({
    league: "WNBA",
    markets: Object.freeze({
      Points: PROP_MARKET_STATUS.RESEARCH,
      Rebounds: PROP_MARKET_STATUS.RESEARCH,
      Assists: PROP_MARKET_STATUS.RESEARCH,
      "3PTM": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
  nfl: Object.freeze({
    league: "NFL",
    markets: Object.freeze({
      "Pass Yards": PROP_MARKET_STATUS.RESEARCH,
      "Rush Yards": PROP_MARKET_STATUS.RESEARCH,
      "Rec Yards": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
  cfb: Object.freeze({
    league: "CFB",
    markets: Object.freeze({
      "Pass Yards": PROP_MARKET_STATUS.RESEARCH,
      "Rush Yards": PROP_MARKET_STATUS.RESEARCH,
      "Rec Yards": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
  nhl: Object.freeze({
    league: "NHL",
    markets: Object.freeze({
      "SOG": PROP_MARKET_STATUS.RESEARCH,
      "Goalie Saves": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
  soccer: Object.freeze({
    league: "Soccer",
    markets: Object.freeze({
      "SOT": PROP_MARKET_STATUS.RESEARCH,
      "Goalie Saves": PROP_MARKET_STATUS.RESEARCH,
      "Passes Attempted": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
  cbb: Object.freeze({
    league: "College Basketball",
    markets: Object.freeze({
      Points: PROP_MARKET_STATUS.RESEARCH,
      Rebounds: PROP_MARKET_STATUS.RESEARCH,
      Assists: PROP_MARKET_STATUS.RESEARCH,
      "3PTM": PROP_MARKET_STATUS.RESEARCH,
    }),
  }),
});

export function curatedMarketsForSport(sport, { includeResearch = true } = {}) {
  const cfg = CURATED_PROP_POLICY[String(sport || "").toLowerCase()];
  if (!cfg) return [];
  return Object.entries(cfg.markets)
    .filter(([, status]) => status === PROP_MARKET_STATUS.PRIMARY || includeResearch)
    .map(([market]) => market);
}

export function curatedLeagueForSport(sport) {
  return CURATED_PROP_POLICY[String(sport || "").toLowerCase()]?.league || null;
}

export function marketStatus(sport, market) {
  return CURATED_PROP_POLICY[String(sport || "").toLowerCase()]?.markets?.[market] || PROP_MARKET_STATUS.BLOCKED;
}

export function buildCuratedPrizePicksScope(sports = [], opts = {}) {
  const includeResearch = opts.includeResearch !== false;
  const rows = [...new Set((sports || []).map((s) => String(s).toLowerCase()))]
    .map((sport) => ({
      sport,
      league: curatedLeagueForSport(sport),
      markets: curatedMarketsForSport(sport, { includeResearch }),
    }))
    .filter((x) => x.league && x.markets.length);
  return rows;
}
