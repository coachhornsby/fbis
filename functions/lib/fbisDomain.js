/**
 * FBIS domain contracts — provider-agnostic shapes for product UI / APIs.
 *
 * Rules:
 * - Never invent prices, lines, timestamps, or identities.
 * - Never grant qualification / wager authorization from ACTION intelligence.
 * - Null means unavailable — do not coerce to zero.
 * - Every product surface consumes the same canonical comparison market.
 */

export const DECISION_STATES = Object.freeze([
  "QUALIFIED",
  "WATCHLIST",
  "PASS",
  "RESEARCH",
  "BLOCKED",
  "UNAVAILABLE",
]);

export const IDENTITY_CONFIDENCE = Object.freeze(["EXACT", "HIGH", "AMBIGUOUS", "UNMATCHED", "UNKNOWN"]);
export const FRESHNESS_STATES = Object.freeze(["CURRENT", "STALE", "DEGRADED", "UNAVAILABLE", "LOADING"]);

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    const s = v.state || v.detail || v.label || v.name || null;
    return s == null ? null : String(s).trim() || null;
  }
  const s = String(v).trim();
  return s ? s : null;
}

function boolOrNull(v) {
  if (v == null) return null;
  return Boolean(v);
}

export function toDomainTeam(team = {}) {
  return {
    name: strOrNull(team.name) || strOrNull(team.school) || strOrNull(team.fullName),
    school: strOrNull(team.school),
    fullName: strOrNull(team.fullName),
    abbr: strOrNull(team.abbr),
    logoUrl: strOrNull(team.logo) || strOrNull(team.logoUrl),
    fbisTeamId: strOrNull(team.canonicalId) || strOrNull(team.fbisTeamId),
    providerTeamId: strOrNull(team.providerTeamId) || null,
    score: numOrNull(team.score),
    record: strOrNull(team.record) || strOrNull(team.recordString) || null,
  };
}

export function toDomainMarketQuote({ marketType, period = "FULL_GAME", side = null, line = null, price = null, book = null, isBestPrice = null, consensusLine = null, consensusPrice = null, openingLine = null, openingPrice = null, sourceObservedAt = null, scrapedAt = null, collectedAt = null, hold = null, impliedProbability = null, noVigProbability = null, provider = null, provenance = null } = {}) {
  return {
    marketType: strOrNull(marketType), period: strOrNull(period) || "FULL_GAME", side: strOrNull(side),
    line: numOrNull(line), price: numOrNull(price), book: strOrNull(book), isBestPrice: boolOrNull(isBestPrice),
    consensusLine: numOrNull(consensusLine), consensusPrice: numOrNull(consensusPrice), openingLine: numOrNull(openingLine), openingPrice: numOrNull(openingPrice),
    sourceObservedAt: strOrNull(sourceObservedAt), scrapedAt: strOrNull(scrapedAt), collectedAt: strOrNull(collectedAt),
    hold: numOrNull(hold), impliedProbability: numOrNull(impliedProbability), noVigProbability: numOrNull(noVigProbability),
    provider: strOrNull(provider), provenance: strOrNull(provenance),
  };
}

export function toDomainPlayerMarket(row = {}) {
  const imageUrl = strOrNull(row.imageUrl) || strOrNull(row.headshotUrl) || strOrNull(row.photoUrl);
  const providerPlayerId = strOrNull(row.providerPlayerId) || strOrNull(row.playerId) || null;
  const playerName = strOrNull(row.playerName) || strOrNull(row.name);
  let playerIdentityConfidence = strOrNull(row.playerIdentityConfidence);
  if (!playerIdentityConfidence) playerIdentityConfidence = providerPlayerId || playerName ? "HIGH" : "UNMATCHED";
  return {
    provider: strOrNull(row.provider) || "UNKNOWN",
    providerGameId: strOrNull(row.providerGameId) || strOrNull(row.gameId),
    fbisEventId: strOrNull(row.fbisEventId) || strOrNull(row.eventId),
    providerPlayerId,
    fbisPlayerId: strOrNull(row.fbisPlayerId),
    playerName,
    team: strOrNull(row.team),
    position: strOrNull(row.position),
    imageUrl,
    imageSource: imageUrl ? strOrNull(row.imageSource) || "UPSTREAM" : null,
    market: strOrNull(row.market) || strOrNull(row.marketRaw),
    marketCanonical: strOrNull(row.marketCanonical) || strOrNull(row.canonicalMarket) || null,
    period: strOrNull(row.period) || "FULL_GAME",
    book: strOrNull(row.book),
    side: strOrNull(row.side),
    line: numOrNull(row.line),
    price: numOrNull(row.price),
    overOdds: numOrNull(row.overOdds),
    underOdds: numOrNull(row.underOdds),
    isAlternate: boolOrNull(row.isAlternate),
    sourceObservedAt: strOrNull(row.sourceObservedAt) || strOrNull(row.observedAt),
    scrapedAt: strOrNull(row.scrapedAt),
    collectedAt: strOrNull(row.collectedAt),
    gameIdentityConfidence: strOrNull(row.gameIdentityConfidence) || "UNKNOWN",
    playerIdentityConfidence,
    marketComplete: Boolean(row.marketComplete),
    decisionEligible: false,
    reasonCodes: Array.isArray(row.reasonCodes) ? row.reasonCodes.map(String) : ["NOT_DECISION_ELIGIBLE"],
    fbisProjection: numOrNull(row.fbisProjection ?? row.projection ?? row.average ?? row.proj),
    fbisSigma: numOrNull(row.fbisSigma ?? row.sigma),
    probabilityOver: numOrNull(row.probabilityOver ?? row.pMore ?? row.probOver),
    probabilityUnder: numOrNull(row.probabilityUnder ?? row.pLess ?? row.probUnder),
    probability: numOrNull(row.probability),
    edge: numOrNull(row.edge ?? row.ev),
    projectionSide: strOrNull(row.projectionSide ?? row.sideLean ?? row.leanSide),
  };
}

function canonicalComparison(boardGame = {}) {
  const market = boardGame.market || {};
  const offer = market.comparison || {};
  return {
    role: strOrNull(market.comparisonMarketRole),
    source: strOrNull(market.comparisonSource),
    observedAt: strOrNull(market.comparisonTimestamp),
    spread: numOrNull(offer.spread),
    total: numOrNull(offer.total),
    moneyline: {
      home: numOrNull(offer.moneyline?.home),
      away: numOrNull(offer.moneyline?.away),
    },
    book: strOrNull(offer.book) || strOrNull(market.comparisonSource),
  };
}

function hasComparableOperationalMarket(boardGame = {}) {
  if (boardGame.marketComparable != null) return Boolean(boardGame.marketComparable);
  if (boardGame.marketUnavailable === true) return false;
  const c = canonicalComparison(boardGame);
  return Boolean(c.spread != null || c.total != null || c.moneyline.home != null || c.moneyline.away != null);
}

/** Derive display state from the canonical board decision only. */
export function deriveDecisionState(boardGame = {}) {
  const projectionUnavailable = Boolean(boardGame.projectionUnavailable);
  const comparable = hasComparableOperationalMarket(boardGame);
  const marketUnavailable = boardGame.marketUnavailable === true || !comparable;
  const noPlayReason = boardGame.noPlayReason;
  const research = boardGame.researchProjection === true || boardGame.research === true || String(boardGame.projectionMaturity || boardGame.model?.maturity || "").toUpperCase() === "RESEARCH";

  if (projectionUnavailable) return { state: "UNAVAILABLE", reasonCodes: ["PROJECTION_UNAVAILABLE"] };

  if (research) {
    return {
      state: "RESEARCH",
      reasonCodes: [marketUnavailable ? "OPERATIONAL_MARKET_UNAVAILABLE" : null, "RESEARCH_NO_WAGER_AUTHORITY"].filter(Boolean),
    };
  }

  if (boardGame.qualificationBlocked && !marketUnavailable) {
    return { state: "BLOCKED", reasonCodes: [boardGame.blockReason || noPlayReason || "QUALIFICATION_BLOCKED"].filter(Boolean) };
  }
  if (boardGame.bettingAllowed === false) {
    return { state: "BLOCKED", reasonCodes: [boardGame.blockReason || noPlayReason || "BETTING_NOT_ALLOWED"].filter(Boolean) };
  }

  if (boardGame.rec?.qualified && comparable) {
    return { state: "QUALIFIED", reasonCodes: ["BOARD_REC_QUALIFIED"] };
  }
  if (boardGame.lean?.pick && comparable) {
    return { state: "WATCHLIST", reasonCodes: [boardGame.lean.reason || "LEAN_NOT_QUALIFIED"].filter(Boolean) };
  }
  if (marketUnavailable) {
    return { state: "PASS", reasonCodes: ["OPERATIONAL_MARKET_UNAVAILABLE"] };
  }
  if (noPlayReason) return { state: "PASS", reasonCodes: [String(noPlayReason)] };
  return { state: "RESEARCH", reasonCodes: ["NO_QUALIFIED_OR_LEAN"] };
}

export function toMovementSummary(boardGame = {}) {
  const sentiment = boardGame.sentiment || {};
  const action = boardGame.actionIntel || {};
  const comparison = canonicalComparison(boardGame);
  const openingLine = numOrNull(sentiment.openingLine ?? action.movement?.openingLine ?? boardGame.openingSpread ?? null);
  const actionCurrent = numOrNull(sentiment.currentLine ?? action.movement?.currentLine);
  const currentLine = actionCurrent ?? comparison.spread;
  const explicitMagnitude = numOrNull(sentiment.magnitude ?? action.movement?.movementMagnitude ?? boardGame.movementMagnitude);
  const derivedMagnitude = explicitMagnitude == null && openingLine != null && actionCurrent != null ? Math.abs(actionCurrent - openingLine) : null;
  const ticketPct = numOrNull(sentiment.ticketPct ?? action.publicSplits?.ticketPct ?? boardGame.ticketPct);
  const moneyPct = numOrNull(sentiment.moneyPct ?? action.publicSplits?.moneyPct ?? boardGame.moneyPct);
  return {
    openingLine,
    currentLine,
    bestLine: numOrNull(boardGame.bestSpread ?? comparison.spread),
    bestPrice: numOrNull(boardGame.bestSpreadPrice),
    bestBook: strOrNull(boardGame.bestBook ?? action.movement?.bestBook ?? comparison.book),
    movementDirection: strOrNull(sentiment.direction ?? action.movement?.movementDirection ?? boardGame.movementDirection),
    movementMagnitude: explicitMagnitude ?? derivedMagnitude,
    movementCount: numOrNull(sentiment.count ?? action.movement?.movementCount ?? boardGame.movementCount),
    lastMovementAt: strOrNull(sentiment.lastAt ?? boardGame.lastMovementAt ?? action.collectedAt),
    ticketPct,
    moneyPct,
    moneyTicketGap: numOrNull(sentiment.moneyTicketGap ?? (moneyPct != null && ticketPct != null ? moneyPct - ticketPct : null)),
    bookCount: numOrNull(action.movement?.bookCount ?? boardGame.bookCount ?? sentiment.bookCount),
    hold: numOrNull(boardGame.hold ?? boardGame.quality?.hold),
    noVig: numOrNull(boardGame.noVig ?? boardGame.quality?.noVig),
    freshness: strOrNull(action.freshness ?? boardGame.freshness ?? boardGame.quality?.freshness) || "UNKNOWN",
  };
}

function buildCanonicalMarketQuotes(boardGame = {}) {
  const c = canonicalComparison(boardGame);
  const rows = [];
  if (c.spread != null) rows.push(toDomainMarketQuote({ marketType: "spread", side: "home", line: c.spread, book: c.book, provider: c.source, sourceObservedAt: c.observedAt, provenance: "canonical_comparison" }));
  if (c.total != null) rows.push(toDomainMarketQuote({ marketType: "total", side: "over", line: c.total, book: c.book, provider: c.source, sourceObservedAt: c.observedAt, provenance: "canonical_comparison" }));
  if (c.moneyline.home != null || c.moneyline.away != null) {
    rows.push(toDomainMarketQuote({ marketType: "moneyline", side: "home", price: c.moneyline.home, book: c.book, provider: c.source, sourceObservedAt: c.observedAt, provenance: "canonical_comparison" }));
    rows.push(toDomainMarketQuote({ marketType: "moneyline", side: "away", price: c.moneyline.away, book: c.book, provider: c.source, sourceObservedAt: c.observedAt, provenance: "canonical_comparison" }));
  }
  return rows;
}

function buildModelVsMarket(boardGame = {}) {
  const c = canonicalComparison(boardGame);
  const projMargin = numOrNull(boardGame.projMargin);
  const projTotal = numOrNull(boardGame.projTotal);
  const marketHomeMargin = c.spread == null ? null : -c.spread;
  const sideDiff = projMargin != null && marketHomeMargin != null ? Math.abs(projMargin - marketHomeMargin) : null;
  const totalDiff = projTotal != null && c.total != null ? projTotal - c.total : null;
  let sideRelation = null;
  if (projMargin != null && marketHomeMargin != null) {
    const p = Math.sign(projMargin);
    const m = Math.sign(marketHomeMargin);
    sideRelation = p === 0 || m === 0 ? "PICKEM_INVOLVED" : p === m ? "SAME_SIDE" : "OPPOSITE_SIDES";
  }
  return {
    comparable: hasComparableOperationalMarket(boardGame),
    role: c.role,
    source: c.source,
    observedAt: c.observedAt,
    spread: c.spread,
    total: c.total,
    marketHomeMargin,
    sideDifference: sideDiff,
    totalDifference: totalDiff,
    sideRelation,
  };
}

export function toDomainEvent(boardGame = {}, opts = {}) {
  const decision = deriveDecisionState(boardGame);
  const sport = strOrNull(boardGame.sport) || strOrNull(opts.sport);
  const consensusMarkets = buildCanonicalMarketQuotes(boardGame);
  const modelVsMarket = buildModelVsMarket(boardGame);
  const ticketPct = numOrNull(boardGame.actionIntel?.publicSplits?.ticketPct ?? boardGame.publicSplits?.ticketPct ?? boardGame.sentiment?.ticketPct ?? boardGame.ticketPct);
  const moneyPct = numOrNull(boardGame.actionIntel?.publicSplits?.moneyPct ?? boardGame.publicSplits?.moneyPct ?? boardGame.sentiment?.moneyPct ?? boardGame.moneyPct);
  const hasSplits = ticketPct != null || moneyPct != null;

  return {
    id: strOrNull(boardGame.id), sport,
    league: strOrNull(boardGame.sportLabel) || (sport ? String(sport).toUpperCase() : null),
    start: strOrNull(boardGame.start), startCt: strOrNull(boardGame.startCt), status: strOrNull(boardGame.status), statusDetail: strOrNull(boardGame.statusDetail),
    teams: { away: toDomainTeam(boardGame.away || {}), home: toDomainTeam(boardGame.home || {}) },
    venue: strOrNull(boardGame.venue), neutral: Boolean(boardGame.neutral), score: boardGame.score || null,
    model: {
      projHome: numOrNull(boardGame.projHome), projAway: numOrNull(boardGame.projAway), projTotal: numOrNull(boardGame.projTotal), projMargin: numOrNull(boardGame.projMargin), pHome: numOrNull(boardGame.pHome),
      projectionKind: strOrNull(boardGame.projectionKind), projectionState: strOrNull(boardGame.projectionState), modelVersion: strOrNull(boardGame.modelVersion), unavailable: Boolean(boardGame.projectionUnavailable),
    },
    consensusMarkets,
    modelVsMarket,
    movement: toMovementSummary(boardGame),
    publicSplits: {
      ticketPct,
      moneyPct,
      source: hasSplits ? (boardGame.actionIntel ? "ACTION_APIFY" : boardGame.sentiment?.source || boardGame.publicSplits?.source || null) : null,
      displayOnly: hasSplits ? Boolean(boardGame.actionIntel?.displayOnly || boardGame.sentiment?.displayOnly) : true,
      available: hasSplits,
    },
    actionIntel: boardGame.actionIntel || null,
    playerMarkets: Array.isArray(boardGame.playerMarkets) ? boardGame.playerMarkets.map(toDomainPlayerMarket) : [],
    marketQuality: {
      unavailable: Boolean(boardGame.marketUnavailable), executionUnavailable: Boolean(boardGame.executionMarketUnavailable), referenceUnavailable: Boolean(boardGame.referenceMarketUnavailable),
      referenceOnly: Boolean(boardGame.referenceMarketAvailable && boardGame.marketUnavailable), labels: boardGame.marketLabels || null, quality: boardGame.quality || null,
      comparisonRole: modelVsMarket.role, comparisonSource: modelVsMarket.source,
    },
    decision: {
      state: decision.state, reasonCodes: decision.reasonCodes, qualified: decision.state === "QUALIFIED", authorized: false,
      bettingAllowed: boardGame.bettingAllowed == null ? null : Boolean(boardGame.bettingAllowed), blockReason: strOrNull(boardGame.blockReason), rec: decision.state === "QUALIFIED" ? boardGame.rec || null : null, lean: decision.state === "WATCHLIST" ? boardGame.lean || null : null,
    },
    provenance: { source: "today_board", collectedAt: strOrNull(opts.collectedAt), schemaVersion: "fbis-event-v2" },
  };
}

export function filterDomainEventsBySport(events = [], sportFilter = "all") {
  const filter = strOrNull(sportFilter) || "all";
  if (filter === "all") return Array.isArray(events) ? events : [];
  return (events || []).filter((e) => e?.sport === filter);
}

export function selectMarketMovers(events = [], limit = 8) {
  return (events || []).filter((e) => e?.movement?.movementMagnitude != null && Number.isFinite(Number(e.movement.movementMagnitude)) && Number(e.movement.movementMagnitude) > 0)
    .slice().sort((a, b) => Number(b.movement.movementMagnitude) - Number(a.movement.movementMagnitude)).slice(0, Math.max(0, limit));
}

export function selectWatchlist(events = [], limit = 12) {
  return (events || []).filter((e) => e?.decision?.state === "WATCHLIST").slice(0, Math.max(0, limit));
}

export function selectTopPlayerProps(events = [], limit = 8) {
  const rows = [];
  for (const event of events || []) {
    for (const pm of event.playerMarkets || []) {
      rows.push({ ...pm, eventId: event.id, sport: event.sport, matchup: { away: event.teams?.away?.abbr || event.teams?.away?.name || null, home: event.teams?.home?.abbr || event.teams?.home?.name || null }, surfaceStatus: pm.decisionEligible ? "WATCHLIST" : "RESEARCH" });
    }
  }
  return rows.slice(0, Math.max(0, limit));
}

export function toDomainTodayBoard(board = {}, opts = {}) {
  const games = Array.isArray(board.games) ? board.games : [];
  const events = games.map((g) => toDomainEvent(g, opts));
  const sportFilter = strOrNull(opts.sportFilter) || "all";
  const scoped = filterDomainEventsBySport(events, sportFilter);
  const byState = Object.fromEntries(DECISION_STATES.map((s) => [s, 0]));
  for (const e of scoped) {
    const st = e.decision?.state || "UNAVAILABLE";
    byState[st] = (byState[st] || 0) + 1;
  }
  const topGameOpportunities = [...scoped.filter((e) => e.decision.state === "QUALIFIED"), ...scoped.filter((e) => e.decision.state === "WATCHLIST")].slice(0, 5);
  return {
    date: strOrNull(board.date) || strOrNull(opts.date),
    generatedAt: strOrNull(opts.generatedAt) || new Date().toISOString(),
    sportFilter,
    counts: { events: scoped.length, byDecisionState: byState, games: scoped.length, qualified: byState.QUALIFIED },
    events: scoped,
    topGameOpportunities,
    marketMovers: selectMarketMovers(scoped),
    watchlist: selectWatchlist(scoped),
    topPlayerProps: selectTopPlayerProps(scoped),
    schemaVersion: "fbis-today-v2",
  };
}

export function recommendMovementStorage({ estimatedTicksPerGame = null, gamesPerWeek = null, retainDays = 30 } = {}) {
  const ticks = Number(estimatedTicksPerGame);
  const games = Number(gamesPerWeek);
  if (!Number.isFinite(ticks) || !Number.isFinite(games) || ticks <= 0 || games <= 0) return { recommendation: "INSUFFICIENT_EVIDENCE", note: "Need measured ticks/game and weekly game volume before archive policy." };
  const monthlyRows = ticks * games * (retainDays / 7) * 4.3;
  if (monthlyRows < 200_000) return { recommendation: "KEEP_ALL_IN_D1", estimatedMonthlyRows: Math.round(monthlyRows), note: "Operational summaries + full ticks still fit comfortable D1 operational use." };
  if (monthlyRows < 2_000_000) return { recommendation: "HYBRID_D1_R2_RECOMMENDED", estimatedMonthlyRows: Math.round(monthlyRows), note: "Keep summaries/indexes in D1; archive deep tick history to R2." };
  return { recommendation: "R2_ARCHIVE_REQUIRED", estimatedMonthlyRows: Math.round(monthlyRows), note: "Deep movement history should not stay entirely in D1 at this volume." };
}
