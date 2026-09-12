/**
 * Stable FBIS player-prop contract + football market aliases for Action/Apify.
 *
 * Shadow / research only. Never invents player ids, prices, or timestamps.
 * Never grants qualification or wager authorization.
 */

/** Markets consumed by current FBIS football player models. */
export const FBIS_FOOTBALL_PROP_MARKETS = Object.freeze([
  "passing_yards",
  "passing_attempts",
  "completions",
  "rushing_yards",
  "rushing_attempts",
  "receptions",
  "receiving_yards",
]);

/**
 * Upstream Action / Actor label → FBIS canonical market.
 * Unmapped labels remain research-only (canonicalMarket=null).
 */
export const ACTION_PROP_MARKET_ALIASES = Object.freeze({
  // Passing
  passing_yards: "passing_yards",
  pass_yards: "passing_yards",
  pass_yds: "passing_yards",
  player_pass_yds: "passing_yards",
  "passing yards": "passing_yards",
  "pass yards": "passing_yards",
  passing_attempts: "passing_attempts",
  pass_attempts: "passing_attempts",
  pass_atts: "passing_attempts",
  player_pass_attempts: "passing_attempts",
  "passing attempts": "passing_attempts",
  "pass attempts": "passing_attempts",
  completions: "completions",
  pass_completions: "completions",
  player_pass_completions: "completions",
  "pass completions": "completions",
  // Rushing
  rushing_yards: "rushing_yards",
  rush_yards: "rushing_yards",
  rush_yds: "rushing_yards",
  player_rush_yds: "rushing_yards",
  "rushing yards": "rushing_yards",
  "rush yards": "rushing_yards",
  rushing_attempts: "rushing_attempts",
  rush_attempts: "rushing_attempts",
  rush_atts: "rushing_attempts",
  player_rush_attempts: "rushing_attempts",
  "rushing attempts": "rushing_attempts",
  "rush attempts": "rushing_attempts",
  // Receiving
  receptions: "receptions",
  recs: "receptions",
  player_receptions: "receptions",
  catches: "receptions",
  receiving_yards: "receiving_yards",
  rec_yards: "receiving_yards",
  rec_yds: "receiving_yards",
  player_rec_yds: "receiving_yards",
  "receiving yards": "receiving_yards",
  "rec yards": "receiving_yards",
});

export function canonicalizeFootballPropMarket(raw) {
  if (raw == null || raw === "") return null;
  const key = String(raw).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const compact = key.replace(/\s+/g, "_");
  return (
    ACTION_PROP_MARKET_ALIASES[key] ||
    ACTION_PROP_MARKET_ALIASES[compact] ||
    ACTION_PROP_MARKET_ALIASES[String(raw).trim().toLowerCase()] ||
    null
  );
}

export function isFbisFootballModelMarket(canonical) {
  return FBIS_FOOTBALL_PROP_MARKETS.includes(String(canonical || ""));
}

/**
 * Build the stable domain prop object. Nullable = genuinely unavailable.
 * Never fabricates ids/prices/timestamps/images.
 */
export function toStablePlayerPropContract(row = {}, ctx = {}) {
  const marketRaw = row.market ?? null;
  const marketCanonical = canonicalizeFootballPropMarket(marketRaw);
  const providerPlayerId = row.providerPlayerId ?? row.playerId ?? null;
  const playerName = row.playerName ?? null;
  const line = row.line ?? null;
  const overOdds = row.overOdds ?? null;
  const underOdds = row.underOdds ?? null;
  const price = row.price ?? null;
  const book = row.book ?? null;
  const side = row.side ?? null;
  const hasPrice = overOdds != null || underOdds != null || price != null;

  const gameIdentityConfidence = ctx.gameIdentityConfidence ?? null;
  const playerIdentityConfidence =
    row.identityConfidence ||
    (providerPlayerId ? "HIGH" : playerName ? "HIGH" : "UNMATCHED");

  const supportedByModel = isFbisFootballModelMarket(marketCanonical);
  const marketComplete = Boolean(
    marketCanonical && line != null && book && hasPrice && (side || (overOdds != null && underOdds != null))
  );

  return {
    provider: "ACTION_APIFY",
    providerGameId: ctx.providerGameId ?? row.providerGameId ?? null,
    fbisEventId: ctx.fbisEventId ?? row.fbisEventId ?? null,

    providerPlayerId: providerPlayerId || null,
    fbisPlayerId: ctx.fbisPlayerId ?? row.fbisPlayerId ?? null,
    playerName,
    team: row.team ?? null,
    position: row.position ?? null,
    // Imagery is an FBIS enrichment layer — Action is not a proven source.
    imageUrl: row.imageUrl ?? row.headshotUrl ?? row.photoUrl ?? null,
    imageSource: row.imageUrl || row.headshotUrl || row.photoUrl ? "ACTION_UPSTREAM" : null,

    market: marketRaw,
    marketCanonical,
    period: row.period ?? null,

    book,
    side,
    line,
    price,
    overOdds,
    underOdds,

    isAlternate: row.isAlternate === true ? true : row.isAlternate === false ? false : null,

    sourceObservedAt: row.observedAt ?? null,
    scrapedAt: ctx.scrapedAt ?? null,
    collectedAt: ctx.collectedAt ?? null,

    sourceUrl: ctx.sourceUrl ?? row.sourceUrl ?? null,
    payloadHash: ctx.payloadHash ?? null,
    runId: ctx.runId ?? null,
    schemaVersion: ctx.schemaVersion ?? "action-apify-prop-v1",

    gameIdentityConfidence,
    playerIdentityConfidence,

    marketComplete,
    decisionEligible: false,
    reasonCodes: buildPropReasonCodes({
      marketCanonical,
      supportedByModel,
      marketComplete,
      providerPlayerId,
      playerName,
      line,
      hasPrice,
      book,
      gameIdentityConfidence,
    }),
  };
}

function buildPropReasonCodes({
  marketCanonical,
  supportedByModel,
  marketComplete,
  providerPlayerId,
  playerName,
  line,
  hasPrice,
  book,
  gameIdentityConfidence,
}) {
  const codes = ["SHADOW_ONLY", "NOT_DECISION_ELIGIBLE"];
  if (!marketCanonical) codes.push("MARKET_UNMAPPED");
  else if (!supportedByModel) codes.push("MARKET_RESEARCH_ONLY");
  else codes.push("MARKET_MODEL_SUPPORTED");
  if (!providerPlayerId) codes.push("PROVIDER_PLAYER_ID_ABSENT");
  if (!playerName) codes.push("PLAYER_NAME_ABSENT");
  if (line == null) codes.push("LINE_ABSENT");
  if (!hasPrice) codes.push("PRICE_ABSENT");
  if (!book) codes.push("BOOK_ABSENT");
  if (!marketComplete) codes.push("MARKET_INCOMPLETE");
  if (gameIdentityConfidence && !["EXACT", "HIGH"].includes(String(gameIdentityConfidence))) {
    codes.push("GAME_IDENTITY_WEAK");
  }
  return codes;
}

/**
 * Classify PLAYER_PROPS readiness from coverage metrics (no auto-promotion).
 */
export function classifyPlayerPropsReadiness(metrics = {}) {
  const modelMarketRate = Number(metrics.modelMarketNormalizationRate);
  const gameIdRate = Number(metrics.gameIdentityUsableRate);
  const playerIdRate = Number(metrics.playerIdentityUsableRate);
  const lineRate = Number(metrics.lineCoverage);
  const priceRate = Number(metrics.priceCoverage);
  const bookRate = Number(metrics.bookCoverage);
  const sideRate = Number(metrics.sideCoverage);

  const blockers = [];
  if (!(gameIdRate >= 0.9)) blockers.push("GAME_IDENTITY");
  if (!(playerIdRate >= 0.8)) blockers.push("PLAYER_IDENTITY");
  if (!(modelMarketRate >= 0.7)) blockers.push("MARKET_CANONICALIZATION");
  if (!(lineRate >= 0.8)) blockers.push("LINE_COVERAGE");
  if (!(priceRate >= 0.8)) blockers.push("PRICE_COVERAGE");
  if (!(bookRate >= 0.8)) blockers.push("BOOK_COVERAGE");
  if (!(sideRate >= 0.5) && !(Number(metrics.bothSidesCoverage) >= 0.5)) {
    blockers.push("SIDE_OR_BOTH_SIDES");
  }

  if (!blockers.length) {
    return {
      status: "PRODUCTION_MARKET_READY",
      blockers,
      note: "Research/market-ready for supported FBIS football markets; still not decision-eligible until owner promotion.",
    };
  }
  if (modelMarketRate >= 0.5 && lineRate >= 0.5 && (priceRate >= 0.5 || bookRate >= 0.5)) {
    return {
      status: "RESEARCH_READY",
      blockers,
      note: "Usable for research/championship comparison; not production market authority.",
    };
  }
  if (Number(metrics.rawPropRows) > 0 || Number(metrics.normalizedPropRows) > 0) {
    return {
      status: "PARTIAL",
      blockers,
      note: "Upstream rows exist but normalized coverage is incomplete.",
    };
  }
  return {
    status: "BLOCKED",
    blockers: blockers.length ? blockers : ["NO_PROP_ROWS"],
    note: "Insufficient upstream or normalized prop evidence.",
  };
}
