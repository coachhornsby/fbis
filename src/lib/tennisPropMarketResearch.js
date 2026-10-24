import { tennisMarketSnapshot, tennisProjectionDisplay } from "./tennisCardPresentation.js";

const isFinitePrice = value =>
  value != null && value !== "" && Number.isFinite(Number(value)) &&
  Number(value) > 0 && Number(value) < 1;

/**
 * Match-level UI may reuse the same verified player portrait supplied by
 * the Tennis Board. It must never guess an image from a name, roster ranking,
 * source-site template, league badge, or an unapproved ATP/WTA photo.
 */
export function tennisBoardPlayerPhoto(team = {}) {
  const url = String(team?.headshotUrl || team?.headshot_url || "").trim();
  const source = String(team?.imageSource || team?.headshotSource || "");
  const approved = source === "RIGHTS_VERIFIED_TENNIS_PORTRAIT";
  if (approved) {
    if (!/^\/api\/tennis-portrait\?id=[a-z0-9%:_ -]+$/i.test(url) ||
        !team?.fbisPlayerId ||
        decodeURIComponent(url.split("id=")[1]) !== String(team.fbisPlayerId)) return null;
    return { url, source, credit:team.portraitCredit || null,
      creditUrl:team.portraitSourceUrl || null, licenseUrl:team.portraitLicenseUrl || null };
  }
  if (source !== "PRIZEPICKS_FEED" || !/^https:\/\//i.test(url) ||
      /\/(?:images\/teams|v2\/team|team-logo|team_logo|flags|logos?)(?:\/|$)/i.test(url)) return null;
  return { url, source, credit:null, creditUrl:null, licenseUrl:null };
}

/**
 * Additive, read-only inventory of already joined Tennis Board exchanges.
 * These are match/sets/games markets, NOT independent player-stat props.
 * No synthetic player projections, order book prices or settlement scope.
 */
export function tennisExchangeResearchCards(games = [], { limit = 24 } = {}) {
  if (!Array.isArray(games)) return [];
  const cards = [];
  const seen = new Set();
  for (const game of games) {
    const t = game?.tennisProjection;
    if (String(game?.sport || "").toLowerCase() !== "tennis" ||
        !(t?.eventIntegrity?.valid === true ||
          (t?.researchFixture?.verified === true && t.researchFixture.fixtureId === game.id))) continue;
    const awayName = String(game.away?.fullName || game.away?.name || "").trim();
    const homeName = String(game.home?.fullName || game.home?.name || "").trim();
    if (!awayName || !homeName || awayName.toLowerCase() === homeName.toLowerCase()) continue;
    const offers = [
      ...(Array.isArray(t.venueOffers) ? t.venueOffers : []),
      ...(Array.isArray(game.market?.venueOffers) ? game.market.venueOffers : []),
    ];
    const snapshot = tennisMarketSnapshot(t, offers, [awayName, homeName]);
    const derivative = (Array.isArray(t.polymarketGlobalOffers) ? t.polymarketGlobalOffers : [])
      .filter(m => /^(?:set\s*\d+\s+winner|set\s+handicap|game\s+spread|total\s+games|game\s+total)/i.test(String(m?.question || "")))
      .slice(0, 4)
      .map(m => ({
        id: String(m.marketId || m.question || ""),
        question: String(m.question || "Other tennis market"),
        source: "POLYMARKET.COM",
        outcomes: Array.isArray(m.outcomes) ? m.outcomes.map(String) : [],
        indicative: Array.isArray(m.indicativePrices) ? m.indicativePrices.map(p => isFinitePrice(p) ? Number(p) : null) : [],
        asks: Array.isArray(m.researchClob?.sides)
          ? m.researchClob.sides.map(s => isFinitePrice(s?.bestAsk?.price) ? Number(s.bestAsk.price) : null)
          : [],
      }));
    if (!snapshot.kalshi.length && !snapshot.polymarket && !derivative.length) continue;
    const key = String(game.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const projection = tennisProjectionDisplay(game);
    cards.push({
      id:key, tour:String(game.tour || t.tour || "Tennis").toUpperCase(),
      away:awayName, home:homeName, start:game.start || null,
      athletes:[
        {name:awayName, photo:tennisBoardPlayerPhoto(game.away), canonicalId:game.away?.fbisPlayerId || null},
        {name:homeName, photo:tennisBoardPlayerPhoto(game.home), canonicalId:game.home?.fbisPlayerId || null},
      ],
      tournament:t.tournament || null,
      kalshi:snapshot.kalshi, polymarket:snapshot.polymarket,
      derivative,
      // Match winner model probability is NOT a player-stat projection.
      matchWinProbability:projection.valid
        ? [projection.pAway,projection.pHome] : null,
      marketRole:"TENNIS_MATCH_MARKET_RESEARCH",
      playerStatProjection:false, canQualify:false, canAuthorizeWager:false,
    });
  }
  return cards.sort((a,b) => (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0)).slice(0, Math.max(0, Math.min(50, limit)));
}
