import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { productProjectionBoard } from "../lib/productProjection.js";
import { buildTennisResearchSlate, boardDateCtForStart } from "../lib/todayBoard.js";
import { authorizeProductTier, productResponsePolicy } from "../lib/productAccess.js";
import { loadPolymarketUsBoardOffers, attachPolymarketBoardOffers } from "../lib/polymarketBoard.js";
import { loadPinnoddsBoardResearch } from "../lib/pinnoddsBoardResearch.js";
import {loadPinnoddsR2BoardResearch,preferFreshPinnoddsArchive} from "../lib/pinnoddsArchiveBoard.js";

const SPORTS = new Set(["mlb", "npb", "kbo", "cfb", "cbb", "nfl", "nba", "wnba", "nhl", "soccer", "tennis"]);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "mlb").toLowerCase();
  const tier = String(url.searchParams.get("tier") || "public").toLowerCase();
  if (!SPORTS.has(sport)) return json({ ok: false, error: "unsupported-sport" }, 400, { tier: "public", maxAge: 10 });
  const access = authorizeProductTier(context.request, context.env, tier);
  if (!access.ok) return json({ ok: false, error: access.reason }, access.reason === "unsupported-tier" ? 400 : 403, { tier: "pro", maxAge: 0 });
  const rawDate = url.searchParams.get("date") || "";
  const window = sport === "cfb" || sport === "cbb" ? { maxPast: 7, maxFuture: 14 } : { maxPast: 2, maxFuture: 3 };
  const resolved = resolveSlateDate(rawDate, window);
  if (rawDate && !resolved.ok) return json({ ok: false, error: resolved.error }, 400, { tier: access.tier, maxAge: 10 });

  // Subscriber/public reads must not spend paid-feed credits. Paid collection is
  // performed by the scheduled writer jobs; serving reuses those caches and may
  // still refresh free score/context sources through buildSlate.
  const env = {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    KENPOM_API_KEY: context.env.KENPOM_API_KEY,
    DB: context.env.DB,
    ARCHIVE: context.env.ARCHIVE,
    caches: caches.default,
    parlayCacheOnly: true,
    palCacheOnly: true,
    cfbdScheduleFallback: false,
    cfbdCacheOnly: sport === "cfb",
  };
  try {
    const slate = sport === "tennis"
      ? await buildTennisResearchSlate(resolved.date, env)
      : await buildSlate(sport, resolved.date, env);
    const selected = sport === "cfb"
      ? { ...slate, games: (slate.games || []).filter((game) => boardDateCtForStart(game.start) === resolved.date) }
      : slate;
    const board=productProjectionBoard(selected,{tier:access.tier});
    // Market overlay is a separate, source-labeled read. Model calculations have
    // already finished; incomplete quote coverage cannot affect their authority.
    let overlay={byId:new Map(),available:false};
    let pinnodds={byGame:{},rows:0,reason:"NO_PINNODDS_OBSERVATIONS"};
    if(context.env.DB?.prepare && board.games?.length){
      try{overlay=await loadPolymarketUsBoardOffers(context.env.DB,board.games,sport,{historyDb:context.env.MARKET_HISTORY_DB})}
      catch(_){/* stale/missing provider never breaks independent FBIS projections */}
      try{
        const d1=await loadPinnoddsBoardResearch(context.env.DB,{sport,games:board.games});
        const r2=await loadPinnoddsR2BoardResearch(context.env.ARCHIVE,{sport,games:board.games});
        pinnodds=preferFreshPinnoddsArchive(d1,r2);
      }
      catch(_){/* missing PinnOdds may not break independent model calculations */}
    }
    const cards=attachPolymarketBoardOffers(board.games,overlay).map(game=>{
      const observed=pinnodds.byGame?.[String(game.id)]||game.pinnoddsResearch||null;
      return {...game,pinnoddsResearch:observed,
        pinnoddsEvidenceState:observed?.status||pinnodds.reason||"NO_PINNODDS_OBSERVATIONS"};
    });
    return json({...board,games:cards,
      pinnoddsResearchCoverage:{source:"PinnOdds",matchedGames:Object.keys(pinnodds.byGame||{}).length,
        capturedRows:pinnodds.rows||0,reason:pinnodds.reason||null,readOnly:true,
        providerQuoteClockVerified:false,canQualify:false,canAuthorizeWager:false},
      polymarketResearch:{source:"Polymarket US",available:[...overlay.byId.values()].some(offers => offers.some(o => o.source.startsWith("Polymarket US"))),
        qualified:false,executable:false}},200,{tier:access.tier});
  } catch (err) {
    return json({ ok: false, error: "projection-board-unavailable", detail: String(err?.message || err) }, 502, { tier: access.tier, maxAge: 5 });
  }
}

function json(data, status = 200, { tier = "public", maxAge = null } = {}) {
  const policy = productResponsePolicy(tier);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": maxAge == null
      ? policy.cacheControl
      : tier === "pro"
        ? "private, no-store, max-age=0"
        : maxAge > 0
          ? `public, max-age=${maxAge}`
          : "no-store",
    vary: policy.vary,
  };
  if (policy.allowOrigin) headers["access-control-allow-origin"] = policy.allowOrigin;
  return new Response(JSON.stringify(data), { status, headers });
}
