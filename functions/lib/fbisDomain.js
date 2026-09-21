/**
 * FBIS domain contracts — provider-agnostic shapes for product UI / APIs.
 *
 * Rules:
 * - Never invent prices, lines, timestamps, or identities.
 * - Never grant qualification / wager authorization.
 * - Action / Apify rows stay research/shadow unless explicitly promoted elsewhere.
 * - Null means unavailable — do not coerce to zero.
 */

export const DECISION_STATES = Object.freeze([
  "QUALIFIED",
  "WATCHLIST",
  "PASS",
  "RESEARCH",
  "BLOCKED",
  "UNAVAILABLE",
]);

export const IDENTITY_CONFIDENCE = Object.freeze([
  "EXACT",
  "HIGH",
  "AMBIGUOUS",
  "UNMATCHED",
  "UNKNOWN",
]);

export const FRESHNESS_STATES = Object.freeze([
  "CURRENT",
  "STALE",
  "DEGRADED",
  "UNAVAILABLE",
  "LOADING",
]);

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

const ACTION_CURRENT_MS = 24 * 60 * 60 * 1000;

function currentActionIntel(action, nowValue = null) {
  if (!action || typeof action !== "object") return null;
  const observedAt =
    action.collectedAt || action.observedAt || action.sourceObservedAt || action.scrapedAt || null;
  const observedMs = observedAt ? Date.parse(String(observedAt)) : NaN;
  const nowMs = Number.isFinite(Date.parse(String(nowValue || "")))
    ? Date.parse(String(nowValue))
    : Date.now();
  // ACTION is current-state market intelligence. Missing/invalid timestamps and
  // snapshots older than 24h fail closed instead of leaking into today's board.
  if (!Number.isFinite(observedMs)) return null;
  if (nowMs - observedMs > ACTION_CURRENT_MS) return null;
  if (observedMs - nowMs > 5 * 60 * 1000) return null;
  return action;
}

function canonicalOperationalMarkets(boardGame = {}) {
  const market = boardGame.market || {};
  const exec = market.execution || {};
  const cons = market.consensus || {};
  const useExec = exec.available === true;
  const useCons = !useExec && cons.available === true;
  if (!useExec && !useCons) return [];

  const source = useExec ? exec : cons;
  const book = useExec ? strOrNull(exec.book) : strOrNull(cons.book || cons.source);
  const provider = useExec ? "execution_market" : "consensus_market";
  const observedAt =
    strOrNull(source.sourceObservedAt) ||
    strOrNull(source.observedAt) ||
    strOrNull(market.comparisonTimestamp) ||
    null;
  const rows = [];

  const spread = numOrNull(source.spread);
  const spreadPrice = numOrNull(source.spreadPrice);
  if (spread != null || spreadPrice != null) {
    rows.push(toDomainMarketQuote({
      marketType: "spread",
      side: "home",
      line: spread,
      price: spreadPrice,
      book,
      provider,
      sourceObservedAt: observedAt,
      provenance: "canonical_operational_market",
    }));
  }

  const total = numOrNull(source.total);
  const totalPrice = numOrNull(source.totalPrice);
  if (total != null || totalPrice != null) {
    rows.push(toDomainMarketQuote({
      marketType: "total",
      side: "over",
      line: total,
      price: totalPrice,
      book,
      provider,
      sourceObservedAt: observedAt,
      provenance: "canonical_operational_market",
    }));
  }

  if (useExec) {
    const homeMl = numOrNull(exec.moneyline?.home);
    const awayMl = numOrNull(exec.moneyline?.away);
    if (homeMl != null || awayMl != null) {
      rows.push(
        toDomainMarketQuote({
          marketType: "moneyline",
          side: "home",
          price: homeMl,
          book,
          provider,
          sourceObservedAt: observedAt,
          provenance: "canonical_operational_market",
        }),
        toDomainMarketQuote({
          marketType: "moneyline",
          side: "away",
          price: awayMl,
          book,
          provider,
          sourceObservedAt: observedAt,
          provenance: "canonical_operational_market",
        }),
      );
    }
  }
  return rows;
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

export function toDomainMarketQuote({
  marketType,
  period = "FULL_GAME",
  side = null,
  line = null,
  price = null,
  book = null,
  isBestPrice = null,
  consensusLine = null,
  consensusPrice = null,
  openingLine = null,
  openingPrice = null,
  sourceObservedAt = null,
  scrapedAt = null,
  collectedAt = null,
  hold = null,
  impliedProbability = null,
  noVigProbability = null,
  provider = null,
  provenance = null,
} = {}) {
  return {
    marketType: strOrNull(marketType),
    period: strOrNull(period) || "FULL_GAME",
    side: strOrNull(side),
    line: numOrNull(line),
    price: numOrNull(price),
    book: strOrNull(book),
    isBestPrice: boolOrNull(isBestPrice),
    consensusLine: numOrNull(consensusLine),
    consensusPrice: numOrNull(consensusPrice),
    openingLine: numOrNull(openingLine),
    openingPrice: numOrNull(openingPrice),
    sourceObservedAt: strOrNull(sourceObservedAt),
    scrapedAt: strOrNull(scrapedAt),
    collectedAt: strOrNull(collectedAt),
    hold: numOrNull(hold),
    impliedProbability: numOrNull(impliedProbability),
    noVigProbability: numOrNull(noVigProbability),
    provider: strOrNull(provider),
    provenance: strOrNull(provenance),
  };
}

export function toDomainPlayerMarket(row = {}) {
  const imageUrl =
    strOrNull(row.imageUrl) || strOrNull(row.headshotUrl) || strOrNull(row.photoUrl);
  const providerPlayerId =
    strOrNull(row.providerPlayerId) || strOrNull(row.playerId) || null;
  const playerName = strOrNull(row.playerName) || strOrNull(row.name);
  let playerIdentityConfidence = strOrNull(row.playerIdentityConfidence);
  if (!playerIdentityConfidence) {
    if (providerPlayerId) playerIdentityConfidence = "HIGH";
    else if (playerName) playerIdentityConfidence = "HIGH";
    else playerIdentityConfidence = "UNMATCHED";
  }
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
    marketCanonical:
      strOrNull(row.marketCanonical) ||
      strOrNull(row.canonicalMarket) ||
      null,
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
    reasonCodes: Array.isArray(row.reasonCodes)
      ? row.reasonCodes.map(String)
      : ["NOT_DECISION_ELIGIBLE"],

    // FBIS research analytics — pass through only; never invent.
    fbisProjection: numOrNull(
      row.fbisProjection ?? row.projection ?? row.average ?? row.proj,
    ),
    fbisSigma: numOrNull(row.fbisSigma ?? row.sigma),
    probabilityOver: numOrNull(
      row.probabilityOver ?? row.pMore ?? row.probOver,
    ),
    probabilityUnder: numOrNull(
      row.probabilityUnder ?? row.pLess ?? row.probUnder,
    ),
    probability: numOrNull(row.probability),
    edge: numOrNull(row.edge ?? row.ev),
    projectionSide: strOrNull(row.projectionSide ?? row.sideLean ?? row.leanSide),
  };
}

/**
 * Derive decision state from existing board flags only.
 */
export function deriveDecisionState(boardGame = {}) {
  const qualificationBlocked =
    boardGame.qualificationBlocked ?? boardGame.qualificationBlocked;
  const bettingAllowed = boardGame.bettingAllowed ?? boardGame.bettingAllowed;
  const projectionUnavailable =
    boardGame.projectionUnavailable ?? boardGame.projectionUnavailable;
  const marketUnavailable =
    boardGame.marketUnavailable ?? boardGame.marketUnavailable;
  const noPlayReason = boardGame.noPlayReason ?? boardGame.noPlayReason;
  const research =
    boardGame.researchProjection === true ||
    boardGame.research === true ||
    String(boardGame.projectionMaturity || boardGame.model?.maturity || "").toUpperCase() === "RESEARCH";

  // Research projections stay visible even when wagering is gated.
  if (research && !projectionUnavailable) {
    if (boardGame.rec?.qualified) {
      return { state: "QUALIFIED", reasonCodes: ["BOARD_REC_QUALIFIED"] };
    }
    if (boardGame.lean?.pick) {
      return {
        state: "WATCHLIST",
        reasonCodes: [boardGame.lean.reason || "LEAN_NOT_QUALIFIED"].filter(Boolean),
      };
    }
    return {
      state: "RESEARCH",
      reasonCodes: [
        marketUnavailable ? "OPERATIONAL_MARKET_UNAVAILABLE" : null,
        "RESEARCH_NO_WAGER_AUTHORITY",
      ].filter(Boolean),
    };
  }

  if (qualificationBlocked || bettingAllowed === false) {
    return {
      state: "BLOCKED",
      reasonCodes: [
        boardGame.blockReason ||
          boardGame.blockReason ||
          noPlayReason ||
          "QUALIFICATION_BLOCKED",
      ].filter(Boolean),
    };
  }
  if (boardGame.rec?.qualified) {
    return { state: "QUALIFIED", reasonCodes: ["BOARD_REC_QUALIFIED"] };
  }
  if (boardGame.lean?.pick) {
    return {
      state: "WATCHLIST",
      reasonCodes: [boardGame.lean.reason || "LEAN_NOT_QUALIFIED"].filter(Boolean),
    };
  }
  // Missing operational market must NOT hide an independent FBIS projection.
  if (projectionUnavailable) {
    return {
      state: "UNAVAILABLE",
      reasonCodes: ["PROJECTION_UNAVAILABLE"],
    };
  }
  if (noPlayReason) {
    return { state: "PASS", reasonCodes: [String(noPlayReason)] };
  }
  return { state: "RESEARCH", reasonCodes: ["NO_QUALIFIED_OR_LEAN"] };
}

export function toMovementSummary(boardGame = {}) {
  const sentiment = boardGame.sentiment || {};
  const action = boardGame.actionIntel || {};
  const openingLine = numOrNull(
    sentiment.openingLine ?? action.movement?.openingLine ?? boardGame.openingSpread ?? null
  );
  const currentLine = numOrNull(
    boardGame.market?.execution?.available
      ? boardGame.market.execution.spread
      : boardGame.market?.consensus?.available
        ? boardGame.market.consensus.spread
        : boardGame.pinSpread ??
          sentiment.currentLine ??
          action.movement?.currentLine ??
          boardGame.spread ??
          null
  );
  const explicitMagnitude = numOrNull(
    sentiment.magnitude ?? action.movement?.movementMagnitude ?? boardGame.movementMagnitude
  );
  // Derive magnitude only from real opening+current lines — never invent a move.
  const derivedMagnitude =
    explicitMagnitude == null && openingLine != null && currentLine != null
      ? Math.abs(currentLine - openingLine)
      : null;
  const ticketPct = numOrNull(
    sentiment.ticketPct ?? action.publicSplits?.ticketPct ?? boardGame.ticketPct
  );
  const moneyPct = numOrNull(
    sentiment.moneyPct ?? action.publicSplits?.moneyPct ?? boardGame.moneyPct
  );
  return {
    openingLine,
    currentLine,
    bestLine: numOrNull(
      boardGame.bestSpread ??
        (boardGame.market?.execution?.available ? boardGame.market.execution.spread : null) ??
        (boardGame.market?.consensus?.available ? boardGame.market.consensus.spread : null) ??
        boardGame.pinSpread ??
        null
    ),
    bestPrice: numOrNull(
      boardGame.bestSpreadPrice ?? boardGame.pinSpreadHomePrice ?? null
    ),
    bestBook: strOrNull(
      boardGame.bestBook ?? action.movement?.bestBook ?? boardGame.pinBook ?? null
    ),
    movementDirection: strOrNull(sentiment.direction ?? boardGame.movementDirection),
    movementMagnitude: explicitMagnitude ?? derivedMagnitude,
    movementCount: numOrNull(sentiment.count ?? boardGame.movementCount),
    lastMovementAt: strOrNull(sentiment.lastAt ?? boardGame.lastMovementAt ?? action.collectedAt),
    ticketPct,
    moneyPct,
    moneyTicketGap: numOrNull(
      sentiment.moneyTicketGap ??
        (moneyPct != null && ticketPct != null ? moneyPct - ticketPct : null),
    ),
    bookCount: numOrNull(boardGame.bookCount ?? sentiment.bookCount),
    hold: numOrNull(boardGame.hold ?? boardGame.quality?.hold),
    noVig: numOrNull(boardGame.noVig ?? boardGame.quality?.noVig),
    freshness: strOrNull(boardGame.freshness ?? boardGame.quality?.freshness) || "UNKNOWN",
  };
}

export function toDomainEvent(boardGame = {}, opts = {}) {
  const decision = deriveDecisionState(boardGame);
  const sport = strOrNull(boardGame.sport) || strOrNull(opts.sport);
  const canonicalMarkets = canonicalOperationalMarkets(boardGame);
  const consensusMarkets = [...canonicalMarkets];
  const hasMarketType = (type) => consensusMarkets.some((m) => m.marketType === type);

  const currentAction = currentActionIntel(
    boardGame.actionIntel,
    opts.generatedAt || opts.collectedAt || null,
  );
  const staleAction = Boolean(boardGame.actionIntel && !currentAction);
  const sentiment =
    staleAction && boardGame.sentiment?.source === "ACTION_APIFY"
      ? null
      : boardGame.sentiment || null;
  const publicSplitsRaw = staleAction ? null : boardGame.publicSplits || null;
  const domainGame = {
    ...boardGame,
    actionIntel: currentAction,
    sentiment,
    publicSplits: publicSplitsRaw,
  };

  const pinSpread = boardGame.pinSpread ?? boardGame.pin_spread;
  const pinSpreadHomePrice =
    boardGame.pinSpreadHomePrice ?? boardGame.pin_spread_home_price;
  if (!hasMarketType("spread") && (pinSpread != null || pinSpreadHomePrice != null)) {
    consensusMarkets.push(
      toDomainMarketQuote({
        marketType: "spread",
        side: "home",
        line: pinSpread,
        price: pinSpreadHomePrice,
        book: "pinnacle",
        provider: "odds_router",
        provenance: "today_board",
      }),
    );
  }
  const pinTotal = boardGame.pinTotal ?? boardGame.pin_total;
  if (!hasMarketType("total") && pinTotal != null) {
    consensusMarkets.push(
      toDomainMarketQuote({
        marketType: "total",
        side: "over",
        line: pinTotal,
        price: boardGame.pinOverPrice,
        book: "pinnacle",
        provider: "odds_router",
        provenance: "today_board",
      }),
    );
  }
  const pinMlHome = boardGame.pinMlHome ?? boardGame.pin_ml_home;
  const pinMlAway = boardGame.pinMlAway ?? boardGame.pin_ml_away;
  if (!hasMarketType("moneyline") && (pinMlHome != null || pinMlAway != null)) {
    consensusMarkets.push(
      toDomainMarketQuote({
        marketType: "moneyline",
        side: "home",
        price: pinMlHome,
        book: "pinnacle",
        provider: "odds_router",
        provenance: "today_board",
      }),
      toDomainMarketQuote({
        marketType: "moneyline",
        side: "away",
        price: pinMlAway,
        book: "pinnacle",
        provider: "odds_router",
        provenance: "today_board",
      }),
    );
  }

  return {
    id: strOrNull(boardGame.id),
    sport,
    league:
      strOrNull(boardGame.sportLabel) || (sport ? String(sport).toUpperCase() : null),
    start: strOrNull(boardGame.start),
    startCt: strOrNull(boardGame.startCt),
    status: strOrNull(boardGame.status),
    statusDetail: strOrNull(boardGame.statusDetail),
    teams: {
      away: toDomainTeam(boardGame.away || {}),
      home: toDomainTeam(boardGame.home || {}),
    },
    venue: strOrNull(boardGame.venue),
    neutral: Boolean(boardGame.neutral),
    score: boardGame.score || null,

    model: {
      projHome: numOrNull(boardGame.projHome),
      projAway: numOrNull(boardGame.projAway),
      projTotal: numOrNull(boardGame.projTotal),
      projMargin: numOrNull(boardGame.projMargin),
      pHome: numOrNull(boardGame.pHome),
      projectionKind: strOrNull(boardGame.projectionKind),
      projectionState: strOrNull(boardGame.projectionState),
      modelVersion: strOrNull(boardGame.modelVersion),
      unavailable: Boolean(boardGame.projectionUnavailable),
    },

    consensusMarkets,
    movement: toMovementSummary(domainGame),
    publicSplits: {
      ticketPct: numOrNull(
        currentAction?.publicSplits?.ticketPct ??
          publicSplitsRaw?.ticketPct ??
          sentiment?.ticketPct ??
          boardGame.ticketPct
      ),
      moneyPct: numOrNull(
        currentAction?.publicSplits?.moneyPct ??
          publicSplitsRaw?.moneyPct ??
          sentiment?.moneyPct ??
          boardGame.moneyPct
      ),
      source: currentAction
        ? "ACTION_APIFY"
        : sentiment?.source || publicSplitsRaw?.source || null,
      displayOnly: Boolean(currentAction?.displayOnly || sentiment?.displayOnly),
      staleActionSuppressed: staleAction,
    },
    actionIntel: currentAction,

    playerMarkets: Array.isArray(boardGame.playerMarkets)
      ? boardGame.playerMarkets.map(toDomainPlayerMarket)
      : [],

    marketQuality: {
      unavailable: Boolean(boardGame.marketUnavailable),
      executionUnavailable: Boolean(boardGame.executionMarketUnavailable),
      referenceUnavailable: Boolean(boardGame.referenceMarketUnavailable),
      referenceOnly: Boolean(boardGame.referenceMarketAvailable && boardGame.marketUnavailable),
      labels: boardGame.marketLabels || null,
      quality: boardGame.quality || null,
    },

    decision: {
      state: decision.state,
      reasonCodes: decision.reasonCodes,
      qualified: decision.state === "QUALIFIED",
      authorized: false,
      bettingAllowed:
        boardGame.bettingAllowed == null ? null : Boolean(boardGame.bettingAllowed),
      blockReason: strOrNull(boardGame.blockReason),
      rec: boardGame.rec || null,
      lean: boardGame.lean || null,
    },

    provenance: {
      source: "today_board",
      collectedAt: strOrNull(opts.collectedAt),
      schemaVersion: "fbis-event-v1",
    },
  };
}

/**
 * Filter domain events by sport without inventing rows.
 */
export function filterDomainEventsBySport(events = [], sportFilter = "all") {
  const filter = strOrNull(sportFilter) || "all";
  if (filter === "all") return Array.isArray(events) ? events : [];
  return (events || []).filter((e) => e?.sport === filter);
}

/**
 * Market movers from real movement magnitude only — never fabricate.
 */
export function selectMarketMovers(events = [], limit = 8) {
  return (events || [])
    .filter((e) => {
      const mag = e?.movement?.movementMagnitude;
      return mag != null && Number.isFinite(Number(mag)) && Number(mag) > 0;
    })
    .slice()
    .sort(
      (a, b) =>
        Number(b.movement.movementMagnitude) - Number(a.movement.movementMagnitude),
    )
    .slice(0, Math.max(0, limit));
}

/**
 * Watchlist = decision.state WATCHLIST only (near-qualified / lean).
 */
export function selectWatchlist(events = [], limit = 12) {
  return (events || [])
    .filter((e) => e?.decision?.state === "WATCHLIST")
    .slice(0, Math.max(0, limit));
}

/**
 * Player props surface — only real playerMarkets; default RESEARCH / not decision-eligible.
 */
export function selectTopPlayerProps(events = [], limit = 8) {
  const rows = [];
  for (const event of events || []) {
    for (const pm of event.playerMarkets || []) {
      rows.push({
        ...pm,
        eventId: event.id,
        sport: event.sport,
        matchup: {
          away: event.teams?.away?.abbr || event.teams?.away?.name || null,
          home: event.teams?.home?.abbr || event.teams?.home?.name || null,
        },
        // Product label until Phase 6 earns model authority.
        surfaceStatus: pm.decisionEligible ? "WATCHLIST" : "RESEARCH",
      });
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
  // Only real QUALIFIED then WATCHLIST — never invent ranking weights.
  const topGameOpportunities = [
    ...scoped.filter((e) => e.decision.state === "QUALIFIED"),
    ...scoped.filter((e) => e.decision.state === "WATCHLIST"),
  ].slice(0, 5);
  return {
    date: strOrNull(board.date) || strOrNull(opts.date),
    generatedAt: strOrNull(opts.generatedAt) || new Date().toISOString(),
    sportFilter,
    counts: {
      events: scoped.length,
      byDecisionState: byState,
      games: board.counts?.games ?? events.length,
      qualified: board.counts?.qualified ?? byState.QUALIFIED,
    },
    events: scoped,
    topGameOpportunities,
    marketMovers: selectMarketMovers(scoped),
    watchlist: selectWatchlist(scoped),
    topPlayerProps: selectTopPlayerProps(scoped),
    schemaVersion: "fbis-today-v1",
  };
}

/**
 * Advisory only — does not migrate data.
 */
export function recommendMovementStorage({
  estimatedTicksPerGame = null,
  gamesPerWeek = null,
  retainDays = 30,
} = {}) {
  const ticks = Number(estimatedTicksPerGame);
  const games = Number(gamesPerWeek);
  if (!Number.isFinite(ticks) || !Number.isFinite(games) || ticks <= 0 || games <= 0) {
    return {
      recommendation: "INSUFFICIENT_EVIDENCE",
      note: "Need measured ticks/game and weekly game volume before archive policy.",
    };
  }
  const monthlyRows = ticks * games * (retainDays / 7) * 4.3;
  if (monthlyRows < 200_000) {
    return {
      recommendation: "KEEP_ALL_IN_D1",
      estimatedMonthlyRows: Math.round(monthlyRows),
      note: "Operational summaries + full ticks still fit comfortable D1 operational use.",
    };
  }
  if (monthlyRows < 2_000_000) {
    return {
      recommendation: "HYBRID_D1_R2_RECOMMENDED",
      estimatedMonthlyRows: Math.round(monthlyRows),
      note: "Keep summaries/indexes in D1; archive deep tick history to R2.",
    };
  }
  return {
    recommendation: "R2_ARCHIVE_REQUIRED",
    estimatedMonthlyRows: Math.round(monthlyRows),
    note: "Deep movement history should not stay entirely in D1 at this volume.",
  };
}
