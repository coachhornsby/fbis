/**
 * Canonical market roles — FBIS market architecture.
 *
 * Hierarchy (never conflate):
 *   FBIS PURE            = independent projection (upstream of all markets)
 *   EXECUTION_MARKET     = books the operator can actually wager with
 *   MARKET_INTELLIGENCE  = ACTION-derived multi-book context
 *   REFERENCE_MARKET     = optional research benchmark (Pinnacle lives here)
 *
 * Missing REFERENCE_MARKET must not block ordinary FBIS operations.
 * Sportsbook data never enters PURE model features.
 */

import {
  EXECUTION_BOOK,
  EXECUTION_KEYS,
  SHARP_BOOK,
  bookKey,
  isExecutionBook,
  isSharpBook,
  validAmerican,
} from "../books.js";

export const MARKET_ROLE = Object.freeze({
  EXECUTION: "EXECUTION_MARKET",
  CONSENSUS: "CONSENSUS_MARKET",
  INTELLIGENCE: "MARKET_INTELLIGENCE",
  REFERENCE: "REFERENCE_MARKET",
});

/**
 * Canonical default: no configured execution books.
 * Do not invent an operator preference (including Heritage) without explicit config.
 * Preserve this boundary so books can be added later via operatorExecutionBooks.
 */
export const DEFAULT_OPERATOR_EXECUTION_BOOKS = Object.freeze([]);

/**
 * Supported Heritage aliases — provider/book support only.
 * Heritage may be configured as an execution book; it is never the implicit default.
 */
export const HERITAGE_EXECUTION_ALIASES = Object.freeze([
  "heritage",
  "heritagesports",
  "heritagesports_nonguaranteed",
  "heritage_sports",
]);

/**
 * Soft / multi-book consensus candidates used when ACTION consensus is absent.
 * Never treated as operator execution unless listed in operatorExecutionBooks.
 */
export const CONSENSUS_SOFT_KEYS = Object.freeze([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bovada",
]);

export const REFERENCE_PROVIDER_PINNACLE = "Pinnacle";

/**
 * Role-aware market freshness policy (ms).
 * Conservative defaults — document before changing production thresholds.
 *
 * EXECUTION: strict — stale execution may remain visible but is not actionable
 * CONSENSUS / INTELLIGENCE: moderate
 * REFERENCE: research-oriented / looser
 */
export const MARKET_FRESHNESS_MS = Object.freeze({
  EXECUTION: 45 * 60 * 1000,
  CONSENSUS: 3 * 60 * 60 * 1000,
  INTELLIGENCE: 3 * 60 * 60 * 1000,
  REFERENCE: 12 * 60 * 60 * 1000,
});

/** @deprecated Prefer MARKET_FRESHNESS_MS by role. Kept as consensus/reference outer bound. */
export const MARKET_FRESH_MS = MARKET_FRESHNESS_MS.REFERENCE;

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Resolve configured operator execution books.
 * Empty / missing config → []. Never invents Heritage (or any book) as a preference.
 */
export function resolveOperatorExecutionBooks(config = null) {
  const raw =
    config?.operatorExecutionBooks ??
    config?.executionBooks ??
    (Array.isArray(config) ? config : null);
  if (!Array.isArray(raw) || !raw.length) {
    return [...DEFAULT_OPERATOR_EXECUTION_BOOKS];
  }
  const cleaned = raw.map((b) => bookKey(b)).filter(Boolean);
  // Deduplicate while preserving order.
  return [...new Set(cleaned)];
}

export function isConfiguredExecutionBook(key, operatorBooks = null) {
  const k = bookKey(key);
  if (!k) return false;
  const allowed = resolveOperatorExecutionBooks(operatorBooks);
  if (!allowed.length) return false;
  if (allowed.includes(k)) return true;
  // Heritage aliases match only when some Heritage entry is explicitly configured.
  const heritageConfigured = allowed.some((a) => a.includes("heritage"));
  return heritageConfigured && isExecutionBook(k) && k.includes("heritage");
}

export function isHeritageBookKey(key) {
  const k = bookKey(key);
  return Boolean(k && (HERITAGE_EXECUTION_ALIASES.includes(k) || k.includes("heritage")));
}

function offer({
  book = null,
  selection = null,
  line = null,
  price = null,
  observedAt = null,
  freshness = null,
  marketType = null,
} = {}) {
  const ln = num(line);
  const pr = num(price);
  if (ln == null && pr == null) return null;
  return {
    book: str(book),
    selection: str(selection),
    line: ln,
    price: pr != null && validAmerican(pr) ? pr : pr,
    observedAt: str(observedAt),
    freshness: str(freshness) || inferFreshness(observedAt, "CONSENSUS"),
    marketType: str(marketType),
  };
}

/**
 * Role-aware freshness classification.
 * @param {string|null} observedAt
 * @param {keyof typeof MARKET_FRESHNESS_MS | string} role
 */
export function inferFreshness(observedAt, role = "CONSENSUS", now = Date.now()) {
  if (!observedAt) return "UNKNOWN";
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return "UNKNOWN";
  const age = now - t;
  if (age < 0) return "UNKNOWN";
  const roleKey = String(role || "CONSENSUS").toUpperCase();
  const limit =
    MARKET_FRESHNESS_MS[roleKey] ??
    (roleKey.includes("EXECUTION")
      ? MARKET_FRESHNESS_MS.EXECUTION
      : roleKey.includes("REFERENCE")
        ? MARKET_FRESHNESS_MS.REFERENCE
        : roleKey.includes("INTEL")
          ? MARKET_FRESHNESS_MS.INTELLIGENCE
          : MARKET_FRESHNESS_MS.CONSENSUS);
  if (age <= 15 * 60 * 1000) return "FRESH";
  if (age <= limit) return "OK";
  return "STALE";
}

export function isFreshEnough(observedAt, role = "CONSENSUS", now = Date.now()) {
  const f = inferFreshness(observedAt, role, now);
  return f === "FRESH" || f === "OK";
}

/**
 * Select an execution offer among candidates.
 *
 * "best" is only claimed for like-for-like line+selection comparisons.
 * Mixed line/price packages are returned as AVAILABLE_OFFER without implying
 * +3 -120 is objectively better/worse than +2.5 -105 (no valuation engine yet).
 *
 * Prefer selectExecutionOffer(); selectBestExecutionOffer remains as a thin alias
 * that only awards BEST when the comparison is like-for-like.
 */
export function selectExecutionOffer(
  offers = [],
  { prefer = "price", line = undefined, selection = undefined } = {}
) {
  let rows = (offers || [])
    .map((o) => ({
      book: str(o.book),
      selection: str(o.selection),
      line: num(o.line),
      price: num(o.price),
      observedAt: str(o.observedAt),
      freshness: str(o.freshness) || inferFreshness(o.observedAt, "EXECUTION"),
      marketType: str(o.marketType),
    }))
    .filter((o) => o.book && (o.line != null || o.price != null));
  if (!rows.length) return null;

  if (selection != null) {
    const want = str(selection);
    rows = rows.filter((r) => r.selection == null || r.selection === want);
    if (!rows.length) return null;
  }

  if (line !== undefined) {
    const wantLine = line == null ? null : num(line);
    rows = rows.filter((r) =>
      wantLine == null ? r.line == null : r.line === wantLine
    );
    if (!rows.length) return null;
  }

  const byLine = new Map();
  for (const row of rows) {
    const key = row.line == null ? "__null__" : String(row.line);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(row);
  }

  const lineKeys = [...byLine.keys()];
  const likeForLike = lineKeys.length === 1;

  // Within each line group, pick the best price (or first if no prices).
  const pickInGroup = (group) => {
    let local = group[0];
    for (const row of group.slice(1)) {
      if (prefer === "price") {
        if ((row.price ?? -Infinity) > (local.price ?? -Infinity)) local = row;
      } else if ((row.line ?? -Infinity) > (local.line ?? -Infinity)) {
        local = row;
      }
    }
    return local;
  };

  if (likeForLike) {
    const group = byLine.get(lineKeys[0]);
    const best = pickInGroup(group);
    return {
      ...best,
      alternativesInLine: group.filter((r) => r !== best),
      comparisonNote: "line_and_price_coupled",
      rankLabel: "BEST_LIKE_FOR_LIKE",
      label: "BEST EXECUTION",
      likeForLike: true,
    };
  }

  // Mixed lines: return a stable available offer without claiming objective "best."
  const firstGroup = byLine.get(lineKeys[0]);
  const chosen = pickInGroup(firstGroup);
  return {
    ...chosen,
    alternativesInLine: firstGroup.filter((r) => r !== chosen),
    comparisonNote: "mixed_lines_unranked_no_valuation",
    rankLabel: "AVAILABLE_OFFER",
    label: "AVAILABLE OFFER",
    likeForLike: false,
  };
}

/**
 * @deprecated Prefer selectExecutionOffer. Only returns BEST when like-for-like.
 */
export function selectBestExecutionOffer(offers = [], opts = {}) {
  const selected = selectExecutionOffer(offers, opts);
  if (!selected) return null;
  if (!selected.likeForLike && opts.line === undefined) {
    // Honest semantics: do not advertise "best" across unequal lines.
    return {
      ...selected,
      rankLabel: "AVAILABLE_OFFER",
      label: "AVAILABLE OFFER",
      comparisonNote: selected.comparisonNote || "mixed_lines_unranked_no_valuation",
    };
  }
  return selected;
}

function heritageExecution(odds, observedAt) {
  if (!odds?.heritageListed) return null;
  // PackFg prefers pin for the packed spread/total point. Only attribute a line to
  // Heritage when Pinnacle is absent (otherwise we lack a distinct heritage line).
  const canUsePackedLine = !odds.pinPresent;
  const spreadLine =
    num(odds.heritageSpread) ??
    (canUsePackedLine && odds.heritageSpreadHomePrice != null ? num(odds.spread) : null);
  const spreadOffer =
    odds.heritageSpreadHomePrice != null || spreadLine != null
      ? offer({
          book: EXECUTION_BOOK,
          selection: "home_spread",
          line: spreadLine,
          price: odds.heritageSpreadHomePrice,
          observedAt,
          marketType: "spread",
        })
      : null;
  const totalLine =
    num(odds.heritageTotal) ??
    (canUsePackedLine && odds.heritageOverPrice != null ? num(odds.total) : null);
  const totalOffer =
    odds.heritageOverPrice != null || totalLine != null
      ? offer({
          book: EXECUTION_BOOK,
          selection: "over",
          line: totalLine,
          price: odds.heritageOverPrice,
          observedAt,
          marketType: "total",
        })
      : null;
  const mlHome =
    odds.heritageHomeMl != null
      ? offer({
          book: EXECUTION_BOOK,
          selection: "home_ml",
          line: null,
          price: odds.heritageHomeMl,
          observedAt,
          marketType: "moneyline",
        })
      : null;
  const mlAway =
    odds.heritageAwayMl != null
      ? offer({
          book: EXECUTION_BOOK,
          selection: "away_ml",
          line: null,
          price: odds.heritageAwayMl,
          observedAt,
          marketType: "moneyline",
        })
      : null;
  const available = Boolean(spreadOffer || totalOffer || mlHome || mlAway);
  return {
    available,
    book: EXECUTION_BOOK,
    spread: spreadOffer?.line ?? null,
    spreadPrice: spreadOffer?.price ?? null,
    total: totalOffer?.line ?? null,
    totalPrice: totalOffer?.price ?? null,
    moneyline: {
      home: mlHome?.price ?? null,
      away: mlAway?.price ?? null,
    },
    offers: {
      spread: spreadOffer,
      total: totalOffer,
      moneylineHome: mlHome,
      moneylineAway: mlAway,
    },
    observedAt: str(observedAt),
    freshness: inferFreshness(observedAt),
    role: MARKET_ROLE.EXECUTION,
  };
}

function softConsensusFromOdds(odds, observedAt) {
  // Soft packed lines only when Pinnacle is not present as the sole packed source,
  // or when softSource explicitly indicates multi-book soft.
  const softHint = Boolean(odds?.softSource || odds?.softPresent);
  const hasSoftPrices =
    odds?.softSpreadHomePrice != null ||
    odds?.softOverPrice != null ||
    (softHint && (odds?.spread != null || odds?.total != null));
  if (!hasSoftPrices && !softHint) {
    // ESPN / generic packed spread without pin may still be usable consensus.
    if (!odds?.pinPresent && (odds?.spread != null || odds?.total != null || odds?.homeMl != null)) {
      return {
        available: true,
        spread: num(odds.spread),
        total: num(odds.total),
        books: odds?.books != null ? Number(odds.books) : null,
        source: str(odds.softSource) || "soft_or_feed",
        observedAt: str(observedAt),
        freshness: inferFreshness(observedAt),
        role: MARKET_ROLE.CONSENSUS,
      };
    }
    return null;
  }
  return {
    available: true,
    spread: num(odds.spread),
    total: num(odds.total),
    books: odds?.books != null ? Number(odds.books) : null,
    source: str(odds.softSource) || "soft",
    observedAt: str(observedAt),
    freshness: inferFreshness(observedAt),
    role: MARKET_ROLE.CONSENSUS,
  };
}

function actionConsensus(actionIntel) {
  const c = actionIntel?.consensus;
  if (!c || typeof c !== "object") return null;
  const spread = num(c.spreadHome ?? c.spread_home ?? c.homeSpread ?? c.spread);
  const total = num(c.total ?? c.totalLine ?? c.overUnder ?? c.ou);
  if (spread == null && total == null) return null;
  const observedAt = str(actionIntel.collectedAt || actionIntel.observedAt || c.observedAt);
  return {
    available: true,
    spread,
    total,
    books: num(c.bookCount ?? c.books ?? actionIntel.bookCount),
    source: "ACTION",
    observedAt,
    freshness: inferFreshness(observedAt),
    role: MARKET_ROLE.CONSENSUS,
  };
}

function actionIntelligence(actionIntel) {
  if (!actionIntel || typeof actionIntel !== "object") {
    return {
      available: false,
      open: null,
      current: null,
      movement: null,
      ticketPct: null,
      moneyPct: null,
      differential: null,
      bookDisagreement: null,
      observedAt: null,
      role: MARKET_ROLE.INTELLIGENCE,
      publicPositioningLabel: "PUBLIC_POSITIONING",
      sharpLabel: null,
    };
  }
  const splits = actionIntel.publicSplits || {};
  const movement = actionIntel.movement || {};
  const ticketPct = num(splits.ticketPct);
  const moneyPct = num(splits.moneyPct);
  const differential =
    num(splits.moneyTicketGap) ??
    (ticketPct != null && moneyPct != null ? moneyPct - ticketPct : null);
  const observedAt = str(actionIntel.collectedAt || actionIntel.observedAt);
  const available = Boolean(
    actionIntel.consensus ||
      splits.ticketPct != null ||
      splits.moneyPct != null ||
      movement.currentLine != null ||
      movement.openingLine != null
  );
  return {
    available,
    open: {
      spread: num(movement.openingLine ?? movement.openSpread),
      total: num(movement.openingTotal),
    },
    current: {
      spread: num(movement.currentLine ?? actionIntel.consensus?.spreadHome),
      total: num(movement.currentTotal ?? actionIntel.consensus?.total),
    },
    movement: {
      direction: str(movement.direction || movement.movementDirection),
      magnitude: num(movement.movementMagnitude ?? movement.magnitude),
      bestBook: str(movement.bestBook),
    },
    ticketPct,
    moneyPct,
    differential,
    bookDisagreement: actionIntel.bookDisagreement || null,
    observedAt,
    freshness: inferFreshness(observedAt),
    role: MARKET_ROLE.INTELLIGENCE,
    // Ticket/money % are public positioning — never auto-labeled sharp.
    publicPositioningLabel: "PUBLIC_POSITIONING",
    sharpLabel: null,
    commercialStatus: "COMMERCIAL_USE_REVIEW_REQUIRED",
    firewall: {
      canQualify: false,
      canAuthorizeWager: false,
      pureFeatureAllowed: false,
    },
  };
}

function referenceFromPinnacle(odds, pin, observedAt) {
  const spread = num(odds?.pinSpread ?? pin?.spread?.line ?? pin?.spread);
  const total = num(odds?.pinTotal ?? pin?.total?.line ?? pin?.total);
  const homeMl = num(odds?.pinHomeMl ?? pin?.ml?.home);
  const awayMl = num(odds?.pinAwayMl ?? pin?.ml?.away);
  const available = Boolean(
    odds?.pinPresent ||
      spread != null ||
      total != null ||
      (homeMl != null && awayMl != null)
  );
  const incomplete = {
    ml: Boolean(
      odds?.pinPresent === false ||
        (pin?.ml && pin.ml.complete === false) ||
        (homeMl == null) !== (awayMl == null)
    ),
    spread: Boolean(pin?.spread && pin.spread.complete === false),
    total: Boolean(pin?.total && pin.total.complete === false),
  };
  return {
    available,
    provider: REFERENCE_PROVIDER_PINNACLE,
    spread,
    spreadPrice: num(odds?.pinSpreadHomePrice),
    total,
    totalPrice: num(odds?.pinOverPrice),
    moneyline: { home: homeMl, away: awayMl },
    observedAt: str(observedAt),
    freshness: inferFreshness(observedAt),
    role: MARKET_ROLE.REFERENCE,
    incomplete,
    // Legacy diagnostic aliases — scoped to reference only.
    diagnostics: {
      reference_market_incomplete_ml: incomplete.ml,
      reference_market_incomplete_spread: incomplete.spread,
      reference_market_incomplete_total: incomplete.total,
      // Historical flag names retained for readers.
      incomplete_pin_ml: incomplete.ml,
      incomplete_pin_spread: incomplete.spread,
      incomplete_pin_total: incomplete.total,
    },
  };
}

/**
 * Build canonical market object for a game/board row.
 * Additive — does not mutate historical odds fields.
 */
function emptyExecution(observedAt) {
  return {
    available: false,
    book: null,
    spread: null,
    spreadPrice: null,
    total: null,
    totalPrice: null,
    moneyline: { home: null, away: null },
    offers: {},
    observedAt,
    freshness: inferFreshness(observedAt, "EXECUTION"),
    role: MARKET_ROLE.EXECUTION,
    actionable: false,
  };
}

/**
 * Heritage observation extracted regardless of operator config.
 * Becomes EXECUTION only when Heritage is explicitly configured.
 * Otherwise may feed OBSERVED / consensus comparison — never invents execution.
 */
function heritageObservation(odds, observedAt) {
  return heritageExecution(odds, observedAt);
}

export function resolveCanonicalMarket(game = {}, { operatorBooks = null, now = Date.now() } = {}) {
  const odds = game.odds || {};
  const observedAt =
    str(game.marketObservedAt) ||
    str(odds.observedAt) ||
    str(game.oddsAsOf) ||
    str(game.asOf) ||
    null;
  const books = resolveOperatorExecutionBooks(
    operatorBooks || game.operatorExecutionBooks || game.config || null
  );
  const heritageConfigured = isConfiguredExecutionBook(EXECUTION_BOOK, books);

  const heritageObs = heritageObservation(odds, observedAt);
  // Patch heritage ML-only listing when spread packed from pin.
  if (heritageObs && !heritageObs.available && odds.heritageListed) {
    heritageObs.available = Boolean(
      odds.heritageHomeMl != null ||
        odds.heritageAwayMl != null ||
        odds.heritageSpreadHomePrice != null ||
        odds.heritageOverPrice != null
    );
    if (heritageObs.available) heritageObs.book = EXECUTION_BOOK;
  }

  let execution = emptyExecution(observedAt);
  if (heritageConfigured && heritageObs?.available) {
    execution = {
      ...heritageObs,
      role: MARKET_ROLE.EXECUTION,
      freshness: inferFreshness(heritageObs.observedAt || observedAt, "EXECUTION", now),
    };
  }

  const actionCons = actionConsensus(game.actionIntel);
  const softCons = softConsensusFromOdds(odds, observedAt);
  // Unconfigured Heritage (or other book) observations → OBSERVED consensus path.
  let observedCons = null;
  if (!heritageConfigured && heritageObs?.available) {
    observedCons = {
      available: true,
      spread: heritageObs.spread,
      total: heritageObs.total,
      books: 1,
      source: "OBSERVED",
      book: heritageObs.book || EXECUTION_BOOK,
      observedAt: heritageObs.observedAt || observedAt,
      freshness: inferFreshness(heritageObs.observedAt || observedAt, "CONSENSUS", now),
      role: MARKET_ROLE.CONSENSUS,
      observedOnly: true,
      executable: false,
    };
  }

  const consensus =
    actionCons ||
    softCons ||
    observedCons || {
      available: false,
      spread: null,
      total: null,
      books: null,
      source: null,
      observedAt,
      freshness: inferFreshness(observedAt, "CONSENSUS", now),
      role: MARKET_ROLE.CONSENSUS,
    };
  if (consensus.available) {
    consensus.freshness = inferFreshness(consensus.observedAt || observedAt, "CONSENSUS", now);
    consensus.executable = false;
  }

  const intelligence = actionIntelligence(game.actionIntel);
  if (intelligence) {
    intelligence.freshness = inferFreshness(
      intelligence.observedAt || observedAt,
      "INTELLIGENCE",
      now
    );
  }
  const reference = referenceFromPinnacle(odds, game.pin, observedAt);
  if (reference) {
    reference.freshness = inferFreshness(
      reference.observedAt || observedAt,
      "REFERENCE",
      now
    );
  }

  const executionFresh = isFreshEnough(execution.observedAt || observedAt, "EXECUTION", now);
  const hasUsableExecutionMarket = Boolean(execution.available);
  const hasUsableConsensusMarket = Boolean(consensus.available);
  // Research comparison may use execution OR consensus.
  const marketAvailable = hasUsableExecutionMarket || hasUsableConsensusMarket;
  const referenceMarketAvailable = Boolean(reference.available);
  const executionMarketAvailable = hasUsableExecutionMarket;
  // Stale execution may remain visible but is not actionable.
  const executionActionable = Boolean(executionMarketAvailable && executionFresh);
  execution.actionable = executionActionable;

  // Consensus supports MODEL vs MARKET research only — never EV / qualify / authorize / YOUR BET.
  const canSupportModelVsMarket = Boolean(marketAvailable);
  const canSupportEv = false; // requires calibrated authority + actionable execution (future)
  const canQualify = false;
  const canAuthorize = false;
  const canEnterYourBet = Boolean(executionActionable); // required gate for eventual YOUR BET

  const comparison = resolveComparisonMarket({
    execution,
    consensus,
    reference,
  });

  return {
    execution,
    consensus,
    intelligence,
    reference,
    marketAvailable,
    executionMarketAvailable,
    referenceMarketAvailable,
    executionActionable,
    // Precise terminology when reference exists but nothing wagerable/operational.
    executionMarketUnavailable: !executionMarketAvailable,
    operationalMarketUnavailable: !marketAvailable,
    comparisonMarketRole: comparison.role,
    comparisonSource: comparison.source,
    comparisonTimestamp: comparison.observedAt,
    comparison: comparison.offer,
    operatorExecutionBooks: books,
    // Research vs execution authority (UI/decision must honor these).
    authority: {
      canSupportModelVsMarket,
      canSupportEv,
      canQualify,
      canAuthorize,
      canEnterYourBet,
      consensusExecutable: false,
      requiresExecutionForYourBet: true,
    },
    // Compatibility mirrors for board readers.
    primaryMarketLabel: marketAvailable
      ? execution.available
        ? executionActionable
          ? execution.book || "EXECUTION"
          : `${execution.book || "EXECUTION"} (STALE)`
        : consensus.source === "ACTION"
          ? "CONSENSUS"
          : consensus.source === "OBSERVED"
            ? "OBSERVED"
            : "MARKET"
      : referenceMarketAvailable
        ? "REFERENCE_ONLY"
        : "NO_MARKET",
  };
}

/**
 * Disagreement benchmark hierarchy (explicit, never silent):
 *   1. execution market
 *   2. robust multi-book / ACTION consensus
 *   3. reference (Pinnacle) only as research fallback
 */
export function resolveComparisonMarket({ execution, consensus, reference } = {}) {
  if (execution?.available && (execution.spread != null || execution.total != null)) {
    return {
      role: MARKET_ROLE.EXECUTION,
      source: execution.book || "execution",
      observedAt: execution.observedAt || null,
      offer: {
        spread: execution.spread,
        total: execution.total,
        moneyline: execution.moneyline || null,
        book: execution.book,
      },
    };
  }
  if (consensus?.available && (consensus.spread != null || consensus.total != null)) {
    return {
      role: MARKET_ROLE.CONSENSUS,
      source: consensus.source || "consensus",
      observedAt: consensus.observedAt || null,
      offer: {
        spread: consensus.spread,
        total: consensus.total,
        moneyline: null,
        book: consensus.source,
      },
    };
  }
  if (reference?.available && (reference.spread != null || reference.total != null)) {
    return {
      role: MARKET_ROLE.REFERENCE,
      source: reference.provider || REFERENCE_PROVIDER_PINNACLE,
      observedAt: reference.observedAt || null,
      offer: {
        spread: reference.spread,
        total: reference.total,
        moneyline: reference.moneyline || null,
        book: reference.provider,
      },
    };
  }
  return {
    role: null,
    source: null,
    observedAt: null,
    offer: { spread: null, total: null, moneyline: null, book: null },
  };
}

/**
 * Componentized quality — missing Pinnacle only lowers reference quality.
 */
export function resolveMarketQualityComponents(game = {}, market = null) {
  const m = market || resolveCanonicalMarket(game);
  const flags = new Set(game?.quality?.flags || game?.cfb?.flags || []);
  const kind = String(game?.projectionKind || game?.model?.projectionKind || "").toUpperCase();

  const pureOk =
    kind === "FBIS" ||
    game?.pureProjectionAvailable === true ||
    (game?.model?.projHome != null && game?.model?.projAway != null && !kind.includes("PINNACLE") && !kind.includes("MARKET_IMPLIED"));

  const modelInputQuality = {
    available: Boolean(pureOk),
    score: pureOk ? (num(game?.cfb?.dataQuality) ?? num(game?.quality?.score) ?? 80) : 0,
    state: pureOk ? "READY" : "MISSING",
  };

  const executionMarketQuality = {
    available: m.executionMarketAvailable,
    score: m.executionMarketAvailable ? 90 : 0,
    state: m.executionMarketAvailable ? "READY" : "MISSING",
  };

  const marketIntelligenceQuality = {
    available: Boolean(m.intelligence?.available),
    score: m.intelligence?.available ? 85 : 0,
    state: m.intelligence?.available ? "READY" : "MISSING",
  };

  const referenceIncomplete = Boolean(
    m.reference?.diagnostics?.reference_market_incomplete_ml ||
      m.reference?.diagnostics?.incomplete_pin_ml
  );
  const referenceMarketQuality = {
    available: Boolean(m.referenceMarketAvailable),
    score: !m.referenceMarketAvailable ? 0 : referenceIncomplete ? 55 : 90,
    state: !m.referenceMarketAvailable
      ? "MISSING"
      : referenceIncomplete
        ? "PARTIAL"
        : "READY",
    note: !m.referenceMarketAvailable
      ? "Reference benchmark unavailable"
      : referenceIncomplete
        ? "reference_market_incomplete_ml"
        : null,
  };

  const identityOk = !flags.has("ambiguous_event_identity") && game?.identityResolved !== false;
  const eventIdentityQuality = {
    available: identityOk,
    score: identityOk ? 100 : 0,
    state: identityOk ? "READY" : "BLOCKED",
  };

  // Overall operational readiness — reference absence does not break the event.
  let overallState = "READY";
  if (!eventIdentityQuality.available) overallState = "BLOCKED";
  else if (!modelInputQuality.available && !m.marketAvailable) overallState = "MARKET_ONLY";
  else if (!modelInputQuality.available) overallState = "NO_MODEL";
  else if (!m.marketAvailable) overallState = "MODEL_ONLY";
  else if (!m.executionMarketAvailable) overallState = "CONSENSUS_ONLY";

  return {
    modelInputQuality,
    executionMarketQuality,
    marketIntelligenceQuality,
    referenceMarketQuality,
    eventIdentityQuality,
    overallState,
    // Legacy single score: do not let incomplete pin dominate.
    operationalScore: Math.round(
      (modelInputQuality.score * 0.45 +
        executionMarketQuality.score * 0.25 +
        marketIntelligenceQuality.score * 0.15 +
        eventIdentityQuality.score * 0.15)
    ),
  };
}

/**
 * Reclassify legacy quality flags so incomplete Pin does not degrade global event quality.
 * Additive: keeps historical flag names on reference diagnostics only.
 */
export function normalizeQualityFlags(flags = [], market = null) {
  const out = [];
  const seen = new Set();
  for (const raw of flags || []) {
    const f = String(raw);
    let mapped = f;
    if (f === "incomplete_pin_ml") mapped = "reference_market_incomplete_ml";
    else if (f === "incomplete_pin_spread") mapped = "reference_market_incomplete_spread";
    else if (f === "incomplete_pin_total") mapped = "reference_market_incomplete_total";
    else if (f === "missing_pin_total") mapped = "reference_market_missing_total";
    else if (f === "missing_pin_spread") mapped = "reference_market_missing_spread";
    if (!seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  if (market?.reference?.diagnostics?.reference_market_incomplete_ml && !seen.has("reference_market_incomplete_ml")) {
    out.push("reference_market_incomplete_ml");
  }
  return out;
}

/**
 * Board-facing availability helpers (precise terminology).
 */
export function marketAvailabilitySummary(market) {
  const m = market || {};
  return {
    marketAvailable: Boolean(m.marketAvailable),
    executionMarketAvailable: Boolean(m.executionMarketAvailable),
    referenceMarketAvailable: Boolean(m.referenceMarketAvailable),
    consensusAvailable: Boolean(m.consensus?.available),
    intelligenceAvailable: Boolean(m.intelligence?.available),
    labels: {
      market: m.marketAvailable ? "AVAILABLE" : "OPERATIONAL MARKET UNAVAILABLE",
      execution: m.executionMarketAvailable ? "AVAILABLE" : "EXECUTION MARKET UNAVAILABLE",
      reference: m.referenceMarketAvailable ? "AVAILABLE" : "Reference benchmark unavailable",
    },
  };
}

/** @deprecated Use resolveCanonicalMarket — SHARP_BOOK is legacy alias for reference provider. */
export const LEGACY_SHARP_BOOK = SHARP_BOOK;
export const LEGACY_EXECUTION_KEYS = EXECUTION_KEYS;
export { isSharpBook, isExecutionBook };
