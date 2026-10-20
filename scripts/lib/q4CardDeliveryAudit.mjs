/**
 * Compare Q4 normalized_market_observations against board card overlays.
 * Pure evaluation helpers — no network I/O.
 */

export function evaluateQ4CardDelivery({
  q4Observations = [],
  boardGames = [],
  now = new Date(),
  maxOfferAgeMs = 45 * 60 * 1000,
} = {}) {
  const failures = [];
  const warnings = [];
  const boardIds = new Set(boardGames.map((g) => String(g.id || "")).filter(Boolean));
  const nowMs = now.getTime();

  const freshQ4 = q4Observations.filter((row) => {
    const collected = Date.parse(row.collected_at || row.collectedAt || "");
    return Number.isFinite(collected) && nowMs - collected <= maxOfferAgeMs;
  });

  const withEvent = freshQ4.filter((row) => row.canonical_event_id || row.canonicalEventId);
  const matched = withEvent.filter((row) => boardIds.has(String(row.canonical_event_id || row.canonicalEventId)));
  const unmatched = withEvent.filter((row) => !boardIds.has(String(row.canonical_event_id || row.canonicalEventId)));

  const provenanceOk = matched.filter((row) => {
    const source = row.source || "";
    const collected = row.collected_at || row.collectedAt;
    const marketId = row.source_market_id || row.sourceMarketId;
    return Boolean(source && collected && marketId);
  });

  const clockOk = matched.filter((row) => {
    const collected = Date.parse(row.collected_at || row.collectedAt || "");
    const observed = Date.parse(row.source_observed_at || row.sourceObservedAt || "");
    if (!Number.isFinite(collected)) return false;
    if (!Number.isFinite(observed)) return true; // collection clock only still useful
    return observed <= collected + 60_000 && collected <= nowMs + 60_000;
  });

  const cardsWithVenueOffers = boardGames.filter((g) => Array.isArray(g?.market?.venueOffers) && g.market.venueOffers.length > 0);
  const cardsWithQ4Provenance = cardsWithVenueOffers.filter((g) =>
    g.market.venueOffers.some((o) => String(o.deliveryStore || "").includes("2026Q4") || o.source === "Polymarket US WebSocket")
  );

  if (!freshQ4.length) failures.push("Q4_NO_FRESH_OBSERVATIONS");
  if (withEvent.length && !matched.length && boardIds.size) failures.push("Q4_EVENTS_NOT_ON_BOARD");
  if (matched.length && !cardsWithVenueOffers.length) {
    warnings.push("BOARD_CARDS_MISSING_VENUE_OFFERS");
  }
  if (matched.length && cardsWithVenueOffers.length && !cardsWithQ4Provenance.length) {
    warnings.push("BOARD_OFFERS_LACK_Q4_OR_WS_PROVENANCE");
  }
  if (matched.length && provenanceOk.length < matched.length) {
    warnings.push("Q4_MATCHED_ROWS_MISSING_PROVENANCE_FIELDS");
  }
  if (matched.length && clockOk.length < matched.length) {
    warnings.push("Q4_MATCHED_ROWS_CLOCK_SKEW");
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    counts: {
      boardGames: boardIds.size,
      freshQ4: freshQ4.length,
      withEvent: withEvent.length,
      matchedEvents: new Set(matched.map((r) => String(r.canonical_event_id || r.canonicalEventId))).size,
      unmatchedEvents: new Set(unmatched.map((r) => String(r.canonical_event_id || r.canonicalEventId))).size,
      provenanceOk: provenanceOk.length,
      clockOk: clockOk.length,
      cardsWithVenueOffers: cardsWithVenueOffers.length,
      cardsWithQ4Provenance: cardsWithQ4Provenance.length,
    },
    sampleMatchedEventIds: [...new Set(matched.map((r) => String(r.canonical_event_id || r.canonicalEventId)))].slice(0, 12),
    sampleUnmatchedEventIds: [...new Set(unmatched.map((r) => String(r.canonical_event_id || r.canonicalEventId)))].slice(0, 12),
    checkedAt: now.toISOString(),
  };
}
