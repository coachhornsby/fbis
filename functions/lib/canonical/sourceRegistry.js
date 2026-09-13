/**
 * Provider / source registry — Model Family Standard §5 + sport manuals.
 * Commercial rights are explicit; unresolved rights stay COMMERCIAL_USE_REVIEW_REQUIRED.
 */

import { COMMERCIAL_STATUS } from "./maturityStates.js";

/** @typedef {{
 *  providerId: string,
 *  name: string,
 *  sports: string[],
 *  domain: 'sports'|'market'|'weather'|'overlay'|'identity',
 *  dataFamilies: string[],
 *  endpointOrFeed: string,
 *  cadence: string,
 *  historicalCoverage: string,
 *  commercialStatus: string,
 *  priority: number,
 *  fallbackPriority: number|null,
 *  active: boolean,
 *  notes: string,
 *  inPureModel: boolean,
 *  inMarketLayer: boolean,
 * }} SourceEntry */

/** @type {SourceEntry[]} */
export const SOURCE_REGISTRY = Object.freeze([
  {
    providerId: "cfbd",
    name: "CollegeFootballData",
    sports: ["cfb"],
    domain: "sports",
    dataFamilies: ["schedule", "pbp", "team_advanced", "players", "recruiting", "weather"],
    endpointOrFeed: "https://api.collegefootballdata.com",
    cadence: "daily + gameday",
    historicalCoverage: "multi-season via subscribed tier",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 1,
    fallbackPriority: null,
    active: true,
    notes: "PRIMARY sports candidate for CFB. Paid projection use requires documented terms.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "cbbd",
    name: "CollegeBasketballData",
    sports: ["cbb"],
    domain: "sports",
    dataFamilies: ["schedule", "team_games", "player_games", "scoreboard"],
    endpointOrFeed: "https://api.collegebasketballdata.com",
    cadence: "daily + slate",
    historicalCoverage: "multi-season",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 1,
    fallbackPriority: null,
    active: true,
    notes: "CBB backbone candidate. Commercial use review required before paid publication dependency.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "kenpom_api",
    name: "KenPom API",
    sports: ["cbb"],
    domain: "sports",
    dataFamilies: ["ratings", "four_factors", "tempo", "archive"],
    endpointOrFeed: "KenPom paid/authorized API (managed secret)",
    cadence: "daily (+ optional pregame)",
    historicalCoverage: "archive endpoints when subscribed",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 2,
    fallbackPriority: 3,
    active: true,
    notes: "API only — never scrape. PIT DataThrough required. Challenger/blend candidate.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "torvik_bulk",
    name: "Bart Torvik / T-Rank bulk files",
    sports: ["cbb"],
    domain: "sports",
    dataFamilies: ["ratings", "four_factors", "tempo", "results"],
    endpointOrFeed: "Yearly bulk CSV/JSON patterns (low-frequency)",
    cadence: "current season ≤1/day; historical once+archive",
    historicalCoverage: "season files when available",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 3,
    fallbackPriority: 4,
    active: true,
    notes: "Personal/research bulk OK per manual; paid/resale still COMMERCIAL_USE_REVIEW_REQUIRED. No aggressive HTML scrape.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "mlb_stats_api",
    name: "MLB Stats API",
    sports: ["mlb"],
    domain: "sports",
    dataFamilies: ["schedule", "lineups", "box", "starters"],
    endpointOrFeed: "statsapi.mlb.com",
    cadence: "slate + pregame",
    historicalCoverage: "multi-season",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 1,
    fallbackPriority: null,
    active: true,
    notes: "Schedule/SP/lineup identity. Terms review before commercial dependency claims.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "baseball_savant",
    name: "Baseball Savant",
    sports: ["mlb"],
    domain: "sports",
    dataFamilies: ["statcast", "expected_stats", "pitcher_batter"],
    endpointOrFeed: "baseballsavant.mlb.com",
    cadence: "daily",
    historicalCoverage: "Statcast era",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 1,
    fallbackPriority: null,
    active: true,
    notes: "Feeds incumbent MLB independent RPG×SP path.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "ballpark_pal",
    name: "Ballpark Pal",
    sports: ["mlb"],
    domain: "overlay",
    dataFamilies: ["park_weather_overlay"],
    endpointOrFeed: "Ballpark Pal API (secret)",
    cadence: "gameday",
    historicalCoverage: "vendor",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 2,
    fallbackPriority: null,
    active: true,
    notes: "Overlay — never replaces Savant core without challenger evidence.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "espn_public",
    name: "ESPN public scoreboards",
    sports: ["cfb", "nfl", "nba", "cbb", "mlb"],
    domain: "sports",
    dataFamilies: ["scoreboard", "status", "form_hints"],
    endpointOrFeed: "site.api.espn.com",
    cadence: "frequent",
    historicalCoverage: "current slate",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 4,
    fallbackPriority: 5,
    active: true,
    notes: "Schedule/status fallback. Not a ratings authority.",
    inPureModel: true,
    inMarketLayer: false,
  },
  {
    providerId: "parlay_pinnacle",
    name: "Parlay → Pinnacle",
    sports: ["mlb", "nfl", "nba", "cfb", "cbb"],
    domain: "market",
    dataFamilies: ["spread", "total", "moneyline", "props"],
    endpointOrFeed: "Parlay aggregator (secret)",
    cadence: "board refresh",
    historicalCoverage: "as captured",
    commercialStatus: COMMERCIAL_STATUS.PRIMARY_PRODUCTION,
    priority: 1,
    fallbackPriority: 2,
    active: true,
    notes: "Production sharp market authority for pricing. NEVER a PURE feature.",
    inPureModel: false,
    inMarketLayer: true,
  },
  {
    providerId: "theodds",
    name: "The Odds API",
    sports: ["mlb", "nfl", "nba", "cfb", "cbb"],
    domain: "market",
    dataFamilies: ["spread", "total", "moneyline"],
    endpointOrFeed: "the-odds-api.com",
    cadence: "board refresh",
    historicalCoverage: "as captured",
    commercialStatus: COMMERCIAL_STATUS.FALLBACK,
    priority: 2,
    fallbackPriority: 3,
    active: true,
    notes: "Pin backup. Market layer only.",
    inPureModel: false,
    inMarketLayer: true,
  },
  {
    providerId: "action_apify",
    name: "ACTION via Apify",
    sports: ["mlb", "nfl", "nba", "cfb", "cbb", "nhl"],
    domain: "market",
    dataFamilies: [
      "spread",
      "total",
      "moneyline",
      "public_splits",
      "book_matrix",
      "player_props",
      "movement",
    ],
    endpointOrFeed: "Apify ACTION actors (shadow)",
    cadence: "scheduled market snapshots (OPEN/CURRENT/DECISION/FINAL_PREGAME/CLOSE derived)",
    historicalCoverage: "shadow observations",
    commercialStatus: COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    priority: 10,
    fallbackPriority: null,
    active: true,
    notes: "SHADOW market intelligence only. Immutable book/prop observation time series. Never PURE game/player features. Never qualify/authorize. Rights unresolved.",
    inPureModel: false,
    inMarketLayer: true,
  },
  {
    providerId: "open_meteo",
    name: "Open-Meteo",
    sports: ["mlb", "cfb", "nfl"],
    domain: "weather",
    dataFamilies: ["forecast"],
    endpointOrFeed: "api.open-meteo.com",
    cadence: "pregame",
    historicalCoverage: "forecast snapshots only",
    commercialStatus: COMMERCIAL_STATUS.FALLBACK,
    priority: 5,
    fallbackPriority: null,
    active: true,
    notes: "Forecast timestamps required; never substitute final observed weather into historical pregame rows.",
    inPureModel: true,
    inMarketLayer: false,
  },
]);

export function listSources({ sport = null, domain = null, activeOnly = true } = {}) {
  return SOURCE_REGISTRY.filter((s) => {
    if (activeOnly && !s.active) return false;
    if (sport && !s.sports.includes(String(sport).toLowerCase())) return false;
    if (domain && s.domain !== domain) return false;
    return true;
  });
}

export function getSource(providerId) {
  return SOURCE_REGISTRY.find((s) => s.providerId === providerId) || null;
}

export function assertNotPureMarketSource(providerId) {
  const s = getSource(providerId);
  if (!s) return { ok: false, reason: "unknown-provider" };
  if (s.inPureModel && s.domain === "market") {
    return { ok: false, reason: "market-source-cannot-be-pure" };
  }
  if (s.domain === "market" && s.inPureModel) {
    return { ok: false, reason: "market-flagged-pure" };
  }
  return { ok: true, source: s };
}

export function commercialBlocksPaidPublication(providerId) {
  const s = getSource(providerId);
  if (!s) return true;
  return [
    COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED,
    COMMERCIAL_STATUS.BLOCKED,
    COMMERCIAL_STATUS.REJECTED,
    COMMERCIAL_STATUS.RESEARCH_ONLY,
  ].includes(s.commercialStatus);
}

export function buildSourceRegistryReport() {
  const byStatus = {};
  for (const s of SOURCE_REGISTRY) {
    byStatus[s.commercialStatus] = (byStatus[s.commercialStatus] || 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    count: SOURCE_REGISTRY.length,
    byCommercialStatus: byStatus,
    sources: SOURCE_REGISTRY,
  };
}
