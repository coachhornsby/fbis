/**
 * Kalshi public market shadow feed, intentionally isolated from CORE, market
 * qualification, execution and wager history. This is NOT the account API.
 *
 * A quote observed by REST is not a guarantee of immediate fillability.
 * Kalshi's orderbook publishes YES/NO bids; best opposite-side asks are
 * derived as 1 - bid, never from last-traded price or midpoint.
 */
export const KALSHI_PUBLIC_BASE = "https://external-api.kalshi.com/trade-api/v2";
export const KALSHI_SHADOW_SERIES = Object.freeze({
  nfl: "KXNFLGAME", cfb: "KXNCAAFGAME", mlb: "KXMLBGAME", nba: "KXNBAGAME",
});
export const KALSHI_SHADOW_AUTHORITY = "SHADOW_ONLY";
const TICKER = /^[A-Z0-9_.-]{4,160}$/;
const clampMoney = v => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};
const count = v => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const stamp = v => {
  const time = Date.parse(v || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const short = (v, max = 250) => v == null ? null : String(v).slice(0, max);

/** Explicitly reject any external request/env attempt to elevate authority. */
export function kalshiShadowAuthority(_options = {}) {
  return {
    mode: KALSHI_SHADOW_AUTHORITY,
    canPublish: false, canQualify: false, canAuthorizeWager: false,
    canChangeProjection: false, canWriteMarketHistory: false,
    executionEligible: false, autoBetEnabled: false,
  };
}

function fixedPrice(m, dollarName, legacyName) {
  if (m?.[dollarName] != null) return clampMoney(m[dollarName]);
  const v = m?.[legacyName];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
}

export function normalizeKalshiShadowMarket(m, {sport, fetchedAt} = {}) {
  if (!m || typeof m !== "object" || !TICKER.test(String(m.ticker || ""))) return null;
  const ticker = String(m.ticker);
  const series = KALSHI_SHADOW_SERIES[sport];
  if (!series || !ticker.startsWith(series + "-")) return null;
  return {
    provider: "Kalshi", providerType: "prediction_exchange",
    sport, seriesTicker: series, ticker,
    eventTicker: short(m.event_ticker, 160),
    title: short(m.title), yesLabel: short(m.yes_sub_title),
    noLabel: short(m.no_sub_title), status: short(m.status, 30),
    marketType: short(m.market_type, 30),
    // Provider-supplied dollars and legacy integer cents are never conflated.
    yesBidDollars: fixedPrice(m, "yes_bid_dollars", "yes_bid"),
    yesAskDollars: fixedPrice(m, "yes_ask_dollars", "yes_ask"),
    noBidDollars: fixedPrice(m, "no_bid_dollars", "no_bid"),
    noAskDollars: fixedPrice(m, "no_ask_dollars", "no_ask"),
    lastTradeDollars: fixedPrice(m, "last_price_dollars", "last_price"),
    yesBidSize: count(m.yes_bid_size_fp), yesAskSize: count(m.yes_ask_size_fp),
    volumeContracts: count(m.volume_fp), openInterestContracts: count(m.open_interest_fp),
    closeAt: stamp(m.close_time), expectedExpirationAt: stamp(m.expected_expiration_time),
    rulesPrimary: short(m.rules_primary, 600), rulesSecondary: short(m.rules_secondary, 600),
    fetchedAt: fetchedAt || null,
    quoteSourceTime: null, // Market updated_time can be metadata-only, NOT a trade clock.
    marketMetadataUpdatedAt: stamp(m.updated_time),
    matchStatus: "UNMATCHED", canonicalEventId: null,
    marketFamily: "UNVERIFIED", sideMapping: "UNVERIFIED",
    feesDollars: null, netCostDollars: null, impliedEdge: null,
    quoteKind: "PUBLIC_BEST_LEVEL_INDICATIVE", ...kalshiShadowAuthority(),
  };
}

export function normalizeKalshiShadowOrderbook(body = {}) {
  const raw = body?.orderbook_fp;
  if (!raw || typeof raw !== "object") return null;
  const levels = values => (Array.isArray(values) ? values : []).map(item => {
    if (!Array.isArray(item) || item.length < 2) return null;
    const price = clampMoney(item[0]), quantity = count(item[1]);
    return price === null || quantity === null || quantity === 0 ? null : { priceDollars:price, contracts:quantity };
  }).filter(Boolean).sort((a,b)=>b.priceDollars-a.priceDollars);
  const yesBids=levels(raw.yes_dollars),noBids=levels(raw.no_dollars);
  const topYes=yesBids[0]||null,topNo=noBids[0]||null;
  const complementary = p => p == null ? null : Math.round((1-p)*10000)/10000;
  return {
    yesBidDollars: topYes?.priceDollars ?? null,
    noBidDollars: topNo?.priceDollars ?? null,
    // Opposite-side bid is the ONLY source for a derived ask in this view.
    yesAskDollars: complementary(topNo?.priceDollars),
    noAskDollars: complementary(topYes?.priceDollars),
    yesAskSizeContracts: topNo?.contracts ?? null,
    noAskSizeContracts: topYes?.contracts ?? null,
    yesBidSizeContracts: topYes?.contracts ?? null,
    noBidSizeContracts: topNo?.contracts ?? null,
    yesBids: yesBids.slice(0,10), noBids: noBids.slice(0,10),
    askDerivation: "COMPLEMENTARY_OPPOSITE_BID",
    sourceObservedAt: null, // REST orderbook does not expose an exchange quote timestamp.
  };
}

async function publicGet(path, params, fetchImpl) {
  const url = new URL(KALSHI_PUBLIC_BASE + path);
  for (const [key,val] of Object.entries(params||{})) if (val != null) url.searchParams.set(key,String(val));
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method:"GET",headers:{accept:"application/json"},
      signal:AbortSignal.timeout(12000),
    });
  } catch {
    return {ok:false,code:"KALSHI_PUBLIC_CONNECTION_UNAVAILABLE"};
  }
  if (!response.ok) return {ok:false,code:"KALSHI_PUBLIC_HTTP_ERROR",httpStatus:response.status};
  try {
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("invalid");
    return {ok:true,body};
  } catch {
    return {ok:false,code:"KALSHI_PUBLIC_SCHEMA_UNAVAILABLE"};
  }
}

/** Sports scope comes from FBIS's currently verified legacy Kalshi series list. */
export async function getKalshiShadowMarkets(sport,{fetchImpl=fetch,now=new Date(),limit=80}={}) {
  const series = KALSHI_SHADOW_SERIES[sport];
  if (!series) return {ok:false,code:"KALSHI_SERIES_NOT_QUALIFIED"};
  const boundedLimit = Math.min(100,Math.max(1,Math.floor(Number(limit)||80)));
  const data=await publicGet("/markets",{series_ticker:series,status:"open",limit:boundedLimit,mve_filter:"exclude"},fetchImpl);
  if (!data.ok) return data;
  if (!Array.isArray(data.body.markets)) return {ok:false,code:"KALSHI_PUBLIC_SCHEMA_UNAVAILABLE"};
  const fetchedAt=now.toISOString();
  return {
    ok:true,provider:"Kalshi",sport,seriesTicker:series,
    fetchedAt, quoteSourceTime:null,
    records:data.body.markets.map(m=>normalizeKalshiShadowMarket(m,{sport,fetchedAt})).filter(Boolean),
    paginationComplete:!data.body.cursor,
    nextCursorAvailable:Boolean(data.body.cursor),
    coverage:"CURRENT_OPEN_SERIES_PAGE_ONLY",
    marketTypeScope:"GAMES_ONLY",
    sourceMethod:"PUBLIC_REST",
    governance:kalshiShadowAuthority(),
  };
}

/**
 * Book detail may be inspected by validated series-market ticker; it cannot
 * be joined to a fixture or assigned execution/model authority at this stage.
 */
export async function getKalshiShadowBook(sport,ticker,{fetchImpl=fetch,now=new Date()}={}) {
  const series=KALSHI_SHADOW_SERIES[sport];
  if (!series || !TICKER.test(String(ticker||"")) || !ticker.startsWith(series+"-")) {
    return {ok:false,code:"KALSHI_TICKER_NOT_ALLOWED"};
  }
  const [metadata,book]=await Promise.all([
    publicGet("/markets/"+encodeURIComponent(ticker),{},fetchImpl),
    publicGet("/markets/"+encodeURIComponent(ticker)+"/orderbook",{},fetchImpl),
  ]);
  if (!metadata.ok || !book.ok) return {
    ok:false,code:"KALSHI_BOOK_SOURCE_UNAVAILABLE",
    sources:{metadata:metadata.ok?null:metadata.code,book:book.ok?null:book.code},
  };
  const market=normalizeKalshiShadowMarket(metadata.body.market,{sport,fetchedAt:now.toISOString()});
  if (!market || market.ticker!==ticker) return {ok:false,code:"KALSHI_MARKET_IDENTITY_MISMATCH"};
  const orderbook=normalizeKalshiShadowOrderbook(book.body);
  if (!orderbook) return {ok:false,code:"KALSHI_ORDERBOOK_SCHEMA_UNAVAILABLE"};
  return {
    ok:true,provider:"Kalshi",sport,market,orderbook,
    fetchedAt:now.toISOString(),feeScheduleVerified:false,
    exactContractRulesVerified:false,executableStakeCostVerified:false,
    governance:kalshiShadowAuthority(),
  };
}
