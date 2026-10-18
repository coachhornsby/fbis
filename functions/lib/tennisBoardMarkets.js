/**
 * Display-only tennis market hydration. PinnOdds / Polymarket offers never become
 * wager authority, and capture clocks are not treated as provider quote times.
 */
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const impliedFromDecimal = (d) => {
  const x = num(d);
  return x != null && x > 1 ? 1 / x : null;
};
const americanFromDecimal = (d) => {
  const x = num(d);
  if (x == null || x <= 1) return null;
  return x >= 2 ? Math.round((x - 1) * 100) : -Math.round(100 / (x - 1));
};

function pairedMoneyline(offers = []) {
  const ml = (offers || []).filter(
    (o) =>
      o?.marketFamily === "moneyline" &&
      (o.period === "full_game" || o.period === "fg") &&
      (o.side === "home" || o.side === "away")
  );
  const home = ml.find((o) => o.side === "home");
  const away = ml.find((o) => o.side === "away");
  if (!home || !away) return null;
  const ih = impliedFromDecimal(home.decimalOdds) ?? num(home.contractPrice);
  const ia = impliedFromDecimal(away.decimalOdds) ?? num(away.contractPrice);
  if (!(ih > 0 && ih < 1 && ia > 0 && ia < 1)) return null;
  const sum = ih + ia;
  return {
    home,
    away,
    noVig: { home: ih / sum, away: ia / sum },
    moneyline: {
      home: americanFromDecimal(home.decimalOdds) ?? home.americanOdds ?? null,
      away: americanFromDecimal(away.decimalOdds) ?? away.americanOdds ?? null,
    },
    observedAt: home.capturedAt || away.capturedAt || null,
  };
}

/** Keep tennis research market snapshots and attach PinnOdds onto venueOffers/reference. */
export function hydrateTennisBoardMarkets(game = {}, evidence = null) {
  const preserved = game?.market && typeof game.market === "object" ? game.market : null;
  const offers = Array.isArray(evidence?.offers) ? evidence.offers : [];
  const paired = pairedMoneyline(offers);
  const existingVenue = [
    ...(preserved?.venueOffers || []),
    ...(game?.tennisProjection?.venueOffers || []),
  ];
  const venueOffers = [
    ...existingVenue,
    ...offers.filter(
      (o) =>
        !existingVenue.some(
          (x) =>
            x.source === o.source &&
            x.sourceMarketId === o.sourceMarketId &&
            x.side === o.side &&
            x.marketFamily === o.marketFamily
        )
    ),
  ];
  const reference = {
    ...(preserved?.reference || {}),
    available:
      Boolean(preserved?.reference?.available) ||
      Boolean(paired) ||
      venueOffers.length > 0,
    provider: preserved?.reference?.provider || (paired ? "PinnOdds" : undefined),
    moneyline: {
      home: preserved?.reference?.moneyline?.home ?? paired?.moneyline.home ?? null,
      away: preserved?.reference?.moneyline?.away ?? paired?.moneyline.away ?? null,
    },
    noVig:
      preserved?.reference?.noVig?.home != null && preserved?.reference?.noVig?.away != null
        ? preserved.reference.noVig
        : paired?.noVig || null,
    observedAt: preserved?.reference?.observedAt || paired?.observedAt || evidence?.latestCapturedAt || null,
    venueOffers,
  };
  const market = {
    ...(preserved || {}),
    marketAvailable: false,
    executionActionable: false,
    reference,
    venueOffers,
  };
  const tennisProjection = game.tennisProjection
    ? {
        ...game.tennisProjection,
        venueOffers,
        marketObservedAt: game.tennisProjection.marketObservedAt || reference.observedAt,
        marketProvider: game.tennisProjection.marketProvider || reference.provider || null,
      }
    : game.tennisProjection;
  return { ...game, market, tennisProjection };
}
