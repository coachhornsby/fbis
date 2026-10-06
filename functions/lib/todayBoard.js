/**
 * TODAY board: every scheduled game on the operator CT date, all supported sports.
 * Ordinary loads are cache-only for Parlay (and Pal). ESPN/MLB Stats remain free.
 */

import { BOARD_SPORTS, SPORTS, todayCT, shiftDateCT, buildSlate, recommendBundle } from "./slateEngine.js";
import { evaluateNhlGameWagers } from "./nhlWagerV1.js";
import { classifyBoardStatus, kickoffCt, noPlayReason, isPreStartStatus, isLiveStatus } from "./gameStatus.js";
import { DEFAULT_WEIGHTS } from "./weights.js";
import { palUnavailableReason } from "./ballparkpal.js";
import { canonicalProjectionConfidence } from "./projectionConfidence.js";
import { buildPropConvictions, summarizeMlbPropWatch } from "./propConviction.js";
import { querySnapshots, queryOddsSnapshots } from "./store.js";
import { fetchEspnTennisRankings } from "./tennisPrizePicksResearch.js";
import { tennisCardContext } from "./tennisPlayerBank.js";
import {
  resolveCanonicalMarket,
  marketAvailabilitySummary,
  normalizeQualityFlags,
  resolveMarketQualityComponents,
} from "./canonical/marketRoles.js";

function withRecs(slate, weights = DEFAULT_WEIGHTS) {
  return {
    ...slate,
    games: (slate?.games || []).map((game) => {
      const bundle = recommendBundle(slate.sport, game, game.model, weights);
      return { ...game, rec: bundle.qualified, lean: bundle.lean };
    }),
  };
}

export { todayCT, shiftDateCT };

export function boardDateCtForStart(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const by = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  if (!by.year || !by.month || !by.day) return null;
  return `${by.year}-${by.month}-${by.day}`;
}

export function resolveTodayDate(raw, now = new Date()) {
  const today = todayCTFrom(now);
  const value = String(raw || "").trim();
  if (!value) return { date: today, ok: true, today };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { date: today, ok: false, error: "date must be YYYY-MM-DD", today };
  }
  return { date: value, ok: true, today };
}

export function todayCTFrom(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now instanceof Date ? now : new Date(now));
}

export function utcMidnightVsCt(utcIso) {
  const utcDate = String(utcIso).slice(0, 10);
  const ctDate = todayCTFrom(new Date(utcIso));
  return { utcDate, ctDate, differs: utcDate !== ctDate };
}

export function toBoardGame(game, sport, now = Date.now()) {
  const status = classifyBoardStatus(game, now);
  const pinSpread =
    game.odds?.pinSpread ??
    (game.odds?.pinSpreadHomePrice != null ? game.odds.spread : null);
  const pinTotal =
    game.odds?.pinTotal ?? (game.odds?.pinOverPrice != null ? game.odds.total : null);
  const market = sport === "tennis" && game.market?.reference ? game.market : resolveCanonicalMarket(game);
  const marketAvail = marketAvailabilitySummary(market);
  const qualityFlags = normalizeQualityFlags(game.quality?.flags || [], market);
  const qualityComponents = resolveMarketQualityComponents(game, market);
  const canonicalQualityScore =
    game.quality?.score ??
    game.dataQuality ??
    game.data_quality ??
    game.model?.dataQuality ??
    game.model?.data_quality ??
    game.cfb?.dataQuality ??
    game.cbb?.dataQuality ??
    qualityComponents?.operationalScore ??
    null;
  const confidence = canonicalProjectionConfidence({ ...game, sport });
  const rec = game.rec || null;
  const lean = game.lean || null;
  const sportsbookProps = [...(game.odds?.playerProps || [])]
    .filter((p) => p?.overPrice != null && p?.underPrice != null && p?.line != null);
  const palProps = [...(game.bpp?.props || [])]
    .filter((p) => p?.over != null || p?.under != null)
    .sort((a, b) => Math.abs(Number(b.over ?? 0.5) - 0.5) - Math.abs(Number(a.over ?? 0.5) - 0.5));
  const propConvictions = sport === "mlb" ? buildPropConvictions({
    palProps, sportsbookProps, lineupsOfficial: Boolean(game.bpp?.lineupsOfficial),
    confirmedPitcherIds: [game.bpp?.homeSp?.id, game.bpp?.awaySp?.id], now,
  }) : [];
  return {
    id: String(game.id),
    sport,
    confidenceStars: confidence.stars,
    confidenceScore: confidence.score,
    confidenceVersion: confidence.version,
    confidenceSource: confidence.source,
    sportLabel: SPORTS[sport]?.label || sport.toUpperCase(),
    start: game.start || null,
    startCt: kickoffCt(game.start),
    status,
    statusDetail: game.status?.detail || status,
    away: {
      name: game.away?.name,
      school: game.away?.school,
      fullName: game.away?.fullName,
      abbr: game.away?.abbr,
      logo: game.away?.logo,
      canonicalId: game.away?.canonicalId,
      rank: game.away?.rank ?? null,
      rankingPoints: game.away?.rankingPoints ?? game.away?.points ?? null,
      imageSource: game.away?.imageSource || null,
      color: game.away?.color || null,
      altColor: game.away?.altColor || game.away?.alternateColor || null,
      score: game.away?.score ?? null,
    },
    home: {
      name: game.home?.name,
      school: game.home?.school,
      fullName: game.home?.fullName,
      abbr: game.home?.abbr,
      logo: game.home?.logo,
      canonicalId: game.home?.canonicalId,
      rank: game.home?.rank ?? null,
      rankingPoints: game.home?.rankingPoints ?? game.home?.points ?? null,
      imageSource: game.home?.imageSource || null,
      color: game.home?.color || null,
      altColor: game.home?.altColor || game.home?.alternateColor || null,
      score: game.home?.score ?? null,
    },
    venue: game.venue || "",
    neutral: Boolean(game.neutralSite),
    score:
      game.home?.score != null && game.away?.score != null
        ? { away: game.away.score, home: game.home.score }
        : null,
    projHome: game.model?.projHome ?? game.projHomeScore ?? null,
    projAway: game.model?.projAway ?? game.projAwayScore ?? null,
    projTotal: game.model?.projTotal ?? null,
    projMargin: game.model?.projMargin ?? null,
    marketProjHome: game.model?.marketProjHome ?? game.marketProjHome ?? null,
    marketProjAway: game.model?.marketProjAway ?? game.marketProjAway ?? null,
    projectionKind: game.model?.projectionKind || game.projectionKind || null,
    projectionState: game.cfb?.projectionState || game.projectionState || null,
    projectionMaturity: game.projectionMaturity || game.model?.maturity || null,
    projectionDisplayLabel: game.projectionDisplayLabel || null,
    projectionEngine: game.projectionEngine || null,
    publicationStatus: game.publicationStatus || null,
    bettingAuthority: game.bettingAuthority || null,
    modelDisagreement: game.modelDisagreement || null,
    researchProjection: game.researchProjection || null,
    probabilityProvenance: game.probabilityProvenance || game.model?.probabilityProvenance || null,
    pureProjectionAvailable: game.pureProjectionAvailable ?? null,
    canQualify:
      game.qualificationBlocked !== true &&
      (game.canQualify === true ||
       game.model?.canQualify === true ||
       game.nflProShadow?.canQualify === true ||
       game.nhlProV2?.canQualify === true ||
       game.mlbDeepShadow?.canQualify === true ||
       game.canQualify !== false),
    projectionRecipe: game.model?.recipe || null,
    cbbPro: game.cbbPro || null,
    cfbDetail: game.cfb ? {
      hfa: game.cfb.hfa, sigmaMargin: game.cfb.sigmaMargin, sigmaTotal: game.cfb.sigmaTotal,
      maturity: game.cfb.maturity, dataQuality: game.cfb.dataQuality, flags: game.cfb.flags || [], priorVersion: game.cfb.priorVersion,
      home: game.cfb.homeEst ? { rank: game.cfb.homeEst.rank, priorOff: game.cfb.homeEst.priorOff, priorDef: game.cfb.homeEst.priorDef, games: game.cfb.homeEst.n, currentOff: game.cfb.homeEst.currentOff, currentDef: game.cfb.homeEst.currentDef } : null,
      away: game.cfb.awayEst ? { rank: game.cfb.awayEst.rank, priorOff: game.cfb.awayEst.priorOff, priorDef: game.cfb.awayEst.priorDef, games: game.cfb.awayEst.n, currentOff: game.cfb.awayEst.currentOff, currentDef: game.cfb.awayEst.currentDef } : null,
    } : null,
    bettingAllowed: game.cfb
      ? game.cfb.bettingAllowed
      : game.sport === "nfl"
        ? Boolean(game.nflWagerDecision?.canQualify || game.nflProShadow?.canQualify)
        : game.sport === "nhl"
          ? Boolean(game.nhlWagerV1?.canQualify || game.nhlProV2?.canQualify)
          : game.sport === "mlb"
            ? Boolean(game.mlbDeepShadow?.canQualify)
            : null,
    blockReason: game.cfb?.blockReason || null,
    marketLabels: game.marketLabels || null,
    pHome: game.model?.pHomeFinal ?? null,
    pinMlHome: game.odds?.pinHomeMl ?? null,
    pinMlAway: game.odds?.pinAwayMl ?? null,
    pinSpread,
    pinSpreadHomePrice: game.odds?.pinSpreadHomePrice ?? null,
    pinSpreadAwayPrice: game.odds?.pinSpreadAwayPrice ?? null,
    pinTotal,
    pinOverPrice: game.odds?.pinOverPrice ?? null,
    pinUnderPrice: game.odds?.pinUnderPrice ?? null,
    quality: game.quality
      ? { ...game.quality, score: canonicalQualityScore, flags: qualityFlags, components: qualityComponents }
      : { flags: qualityFlags, components: qualityComponents, score: canonicalQualityScore },
    market,
    marketAvailable: marketAvail.marketAvailable,
    executionMarketAvailable: marketAvail.executionMarketAvailable,
    referenceMarketAvailable: marketAvail.referenceMarketAvailable,
    consensusAvailable: marketAvail.consensusAvailable,
    intelligenceAvailable: marketAvail.intelligenceAvailable,
    modelVersion: game.modelVersion || null,
    checkpoint: game.checkpoint || null,
    rec: rec
      ? {
          pick: rec.pick,
          market: rec.market,
          tag: rec.tag,
          ev: rec.ev,
          qualified: true,
        }
      : null,
    lean: !rec && lean
      ? {
          pick: lean.pick,
          market: lean.market,
          reason: lean.reason || noPlayReason({ ...game, lean, rec: null, market }),
        }
      : null,
    noPlayReason: rec ? null : noPlayReason({ ...game, market }),
    // Operational market = execution OR consensus. Pinnacle/reference alone is NOT enough.
    marketUnavailable: !marketAvail.marketAvailable,
    executionMarketUnavailable: !marketAvail.executionMarketAvailable,
    referenceMarketUnavailable: !marketAvail.referenceMarketAvailable,
    operationalMarketLabel: marketAvail.labels?.market || null,
    projectionUnavailable: (game.model?.projHome == null && game.model?.projAway == null) || game.projectionKind === "UNAVAILABLE",
    qualificationBlocked: Boolean(game.qualificationBlocked || (game.cfb && !game.cfb.bettingAllowed) || (game.sport === "nfl" && game.projectionKind !== "FBIS")),
    challengers: game.challengers || null,
    championModel: game.championModel || null,
    // Preserve source-backed matchup evidence and NFL-PRO coverage on the public board DTO.
    // The slate engine builds these before TODAY normalization; dropping them here made the
    // UI falsely report \"Awaiting model factors\" even when NFL-PRO-v1 had produced them.
    matchupFactors: Array.isArray(game.matchupFactors) ? game.matchupFactors : [],
    nflProShadow: sport === "nfl" && game.nflProShadow ? game.nflProShadow : null,
    nflGameMatchup: sport === "nfl" && game.nflGameMatchup ? game.nflGameMatchup : null,
    nflWagerDecision: sport === "nfl" && game.nflWagerDecision ? game.nflWagerDecision : null,
    nhlProV2: sport === "nhl" && game.nhlProV2 ? game.nhlProV2 : null,
    nhlGoalieProbabilityShadow: sport === "nhl" && game.nhlGoalieProbabilityShadow ? game.nhlGoalieProbabilityShadow : null,
    tennisProjection: sport === "tennis" ? (game.tennisProjection || null) : null,
    tour: sport === "tennis" ? (game.tour || game.tennisProjection?.tour || null) : null,
    palMatched: Boolean(game.bpp),
    palHome: game.bpp?.homeRuns ?? game.model?.palHome ?? null,
    palAway: game.bpp?.awayRuns ?? game.model?.palAway ?? null,
    palPHome: game.bpp?.pHome ?? game.model?.layers?.pal ?? null,
    palF5Home: game.bpp?.f5?.homeRuns ?? null,
    palF5Away: game.bpp?.f5?.awayRuns ?? null,
    palF5HomeWin: game.bpp?.f5?.homeWin ?? null,
    palF5AwayWin: game.bpp?.f5?.awayWin ?? null,
    fbisF5: game.mlbDeepShadow?.f5 || game.challengers?.["MLB-FBIS-v2"]?.f5 || null,
    f5MarketEvaluation: game.mlbDeepShadow?.f5?.market || game.challengers?.["MLB-FBIS-v2"]?.f5?.market || null,
    f5Book: game.odds?.f5 || null,
    playerMarkets: Array.isArray(game.playerMarkets) ? game.playerMarkets : [],
    playerProjectionRows: Array.isArray(game.playerProjectionRows) ? game.playerProjectionRows : [],
    playerProjectionStatus: game.playerProjectionStatus || null,
    mlbPersistentState: sport === "mlb" ? (game.mlbPersistentState || null) : null,
    homeSp: sport === "mlb" ? (game.homeSp || null) : null,
    awaySp: sport === "mlb" ? (game.awaySp || null) : null,
    savant: sport === "mlb" ? (game.savant || null) : null,
    sportsbookProps: [],
    sportsbookPropCount: sportsbookProps.length,
    propConvictions,
    lineupsOfficial: Boolean(game.bpp?.lineupsOfficial),
    sentiment: game.sentiment || game.odds?.sentiment || null,
    // ACTION Apify market intel — display/research only (never odds authority).
    actionIntel: game.actionIntel || null,
    nhlWagerV1: sport === "nhl" ? (game.nhlWagerV1 || evaluateNhlGameWagers(game)) : null,
    marketLineHistory: sport === "nhl" ? (game.marketLineHistory || []) : null,
    publicSplits: game.publicSplits || game.actionIntel?.publicSplits || null,
    weather: game.weather || game.cfb?.weather || null,
    park: game.bpp?.park || null,
    palPark: game.bpp?.park || null,
    palTeamTotals: game.bpp?.teamTotals || [],
    palProps: [],
    palPropCount: palProps.length,
    palAsOf: game.bpp?.asOf ?? null,
    palRequestId: game.bpp?.requestId ?? null,
    palUnavailableReason: game.palUnavailableReason
      ? game.palUnavailableReason
      : game.bpp
        ? game.bpp.homeRuns == null || game.bpp.awayRuns == null
          ? "projection-fields-missing"
          : null
        : palUnavailableReason({ reason: "team-mismatch" }, game),
    live: status === "live" || status === "halftime",
    final: status === "final",
  };
}

export function sortByStart(games) {
  return [...(games || [])].sort((a, b) => {
    const as = Date.parse(a.start || "") || 0;
    const bs = Date.parse(b.start || "") || 0;
    if (as !== bs) return as - bs;
    return String(a.away?.abbr || "").localeCompare(String(b.away?.abbr || ""));
  });
}

export function groupBySport(games) {
  const groups = [];
  const by = new Map();
  for (const id of BOARD_SPORTS) by.set(id, []);
  for (const g of games || []) {
    if (!by.has(g.sport)) by.set(g.sport, []);
    by.get(g.sport).push(g);
  }
  for (const id of BOARD_SPORTS) {
    const list = sortByStart(by.get(id) || []);
    groups.push({
      sport: id,
      label: SPORTS[id]?.label || id.toUpperCase(),
      n: list.length,
      games: list,
    });
  }
  return groups;
}

export function filterTodayGames(games, { sport = "all", bucket = "all" } = {}) {
  let xs = games || [];
  if (sport && sport !== "all") xs = xs.filter((g) => g.sport === sport);
  if (bucket === "scheduled" || bucket === "pregame") xs = xs.filter((g) => isPreStartStatus(g.status));
  else if (bucket === "live") xs = xs.filter((g) => isLiveStatus(g.status));
  else if (bucket === "final") xs = xs.filter((g) => g.status === "final");
  else if (bucket === "qualified") xs = xs.filter((g) => g.rec);
  else if (bucket === "leans") xs = xs.filter((g) => g.lean && !g.rec);
  return xs;
}

export function emptyTodayState({ date, feeds = {} } = {}) {
  const failed = Object.entries(feeds).filter(([, f]) => f?.error);
  if (failed.length && Object.values(feeds).every((f) => f?.error || !f?.games)) {
    return { kind: "feed-failure", message: "Scoreboard feed failed for every sport." };
  }
  return { kind: "no-games", message: `No games scheduled for ${date} CT.` };
}

function buildSnapshotOddsByGame(rows = []) {
  const byGame = new Map();
  for (const row of rows || []) {
    const id = String(row?.gameId || row?.id || "");
    if (!id) continue;
    const at = Date.parse(row.frozenAt || row.marketAt || row.start || "") || 0;
    const hasAny =
      row.pinHomeMl != null ||
      row.pinAwayMl != null ||
      row.pinSpread != null ||
      row.pinTotal != null;
    if (!hasAny) continue;
    const prev = byGame.get(id);
    const prevAt = Date.parse(prev?.frozenAt || prev?.marketAt || prev?.start || "") || 0;
    if (!prev || at >= prevAt) byGame.set(id, row);
  }
  return byGame;
}

function hydrateOddsFromSnapshot(game, snapshot) {
  if (!snapshot) return game;
  const odds = { ...(game.odds || {}) };
  if (odds.pinHomeMl == null && snapshot.pinHomeMl != null) odds.pinHomeMl = snapshot.pinHomeMl;
  if (odds.pinAwayMl == null && snapshot.pinAwayMl != null) odds.pinAwayMl = snapshot.pinAwayMl;
  if (odds.pinSpread == null && snapshot.pinSpread != null) odds.pinSpread = snapshot.pinSpread;
  if (odds.pinTotal == null && snapshot.pinTotal != null) odds.pinTotal = snapshot.pinTotal;
  return { ...game, odds };
}

function buildMarketOddsByGame(rows = []) {
  const by = new Map();
  for (const row of rows || []) {
    if (!row || row.period !== "fg" || row.rejectedPostStart) continue;
    const id = String(row.gameId || "");
    if (!id) continue;
    if (!by.has(id)) by.set(id, { at: 0 });
    const pack = by.get(id);
    const at = Date.parse(row.capturedAt || "") || 0;
    if (at >= (pack.at || 0)) pack.at = at;
    const mkt = String(row.market || "").toUpperCase();
    const side = String(row.side || "").toUpperCase();
    if (mkt === "ML") {
      if (side === "HOME") pack.pinHomeMl = row.price;
      if (side === "AWAY") pack.pinAwayMl = row.price;
    } else if (mkt === "SPREAD") {
      if (side === "HOME") {
        pack.pinSpread = row.line;
        pack.pinSpreadHomePrice = row.price;
      }
      if (side === "AWAY") pack.pinSpreadAwayPrice = row.price;
    } else if (mkt === "TOTAL") {
      if (side === "OVER") {
        pack.pinTotal = row.line;
        pack.pinOverPrice = row.price;
      }
      if (side === "UNDER") pack.pinUnderPrice = row.price;
    }
  }
  return by;
}

function buildMarketLineHistoryByGame(rows = []) {
  const by = new Map();
  for (const row of rows || []) {
    if (!row || row.period !== "fg" || row.rejectedPostStart) continue;
    const id = String(row.gameId || "");
    if (!id) continue;
    if (!by.has(id)) by.set(id, []);
    by.get(id).push({
      sportsbook: row.book || null,
      market: String(row.market || "").toLowerCase(),
      selection: String(row.side || "").toLowerCase(),
      line: row.line == null ? null : Number(row.line),
      americanPrice: row.price == null ? null : Number(row.price),
      collectedAt: row.capturedAt || null,
      checkpoint: row.checkpoint || null,
      source: "ODDS_SNAPSHOT",
    });
  }
  for (const rows of by.values()) rows.sort((a,b)=>String(a.collectedAt||"").localeCompare(String(b.collectedAt||"")));
  return by;
}

function hydrateOddsFromMarketRows(game, pack) {
  if (!pack) return game;
  const odds = { ...(game.odds || {}) };
  if (odds.pinHomeMl == null && pack.pinHomeMl != null) odds.pinHomeMl = pack.pinHomeMl;
  if (odds.pinAwayMl == null && pack.pinAwayMl != null) odds.pinAwayMl = pack.pinAwayMl;
  if (odds.pinSpread == null && pack.pinSpread != null) odds.pinSpread = pack.pinSpread;
  if (odds.pinSpreadHomePrice == null && pack.pinSpreadHomePrice != null) odds.pinSpreadHomePrice = pack.pinSpreadHomePrice;
  if (odds.pinSpreadAwayPrice == null && pack.pinSpreadAwayPrice != null) odds.pinSpreadAwayPrice = pack.pinSpreadAwayPrice;
  if (odds.pinTotal == null && pack.pinTotal != null) odds.pinTotal = pack.pinTotal;
  if (odds.pinOverPrice == null && pack.pinOverPrice != null) odds.pinOverPrice = pack.pinOverPrice;
  if (odds.pinUnderPrice == null && pack.pinUnderPrice != null) odds.pinUnderPrice = pack.pinUnderPrice;
  return { ...game, odds };
}


function ppKey(v=""){return String(v||"").normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}

async function attachPrizePicksMarkets(games=[], sport, date, db){
  if(!db?.prepare || !games.length) return games;
  let rows=[];
  try{
    rows=(await db.prepare(`SELECT fbis_event_id,sport,player_id,player_name,player_headshot_url,team,opponent,game_id,start_time,stat_type,canonical_market,line,odds_tier,duration,observed_at,collected_at
      FROM prizepicks_prop_lines WHERE sport=? AND substr(start_time,1,10) BETWEEN date(?,'-1 day') AND date(?,'+1 day')
      ORDER BY collected_at DESC LIMIT 3000`).bind(sport,date,date).all())?.results||[];
  }catch{return games;}
  return games.map(game=>{
    const gid=String(game.id||"");
    const names=new Set([ppKey(game.away?.name),ppKey(game.away?.fullName),ppKey(game.home?.name),ppKey(game.home?.fullName)].filter(Boolean));
    const abbrs=new Set([ppKey(game.away?.abbr),ppKey(game.home?.abbr)].filter(Boolean));
    const seen=new Set(), playerMarkets=[];
    for(const row of rows){
      const exact=row.fbis_event_id && String(row.fbis_event_id)===gid;
      const tennisMatch=sport==="tennis" && names.has(ppKey(row.player_name));
      const teamMatch=sport!=="tennis" && ((row.team&&abbrs.has(ppKey(row.team))) || (row.opponent&&abbrs.has(ppKey(row.opponent))));
      if(!exact&&!tennisMatch&&!teamMatch) continue;
      const key=[row.player_id||row.player_name,row.canonical_market||row.stat_type,row.line,row.odds_tier,row.duration].join("|");
      if(seen.has(key)) continue; seen.add(key);
      playerMarkets.push({
        source:"PRIZEPICKS_APIFY",book:"PrizePicks",playerId:row.player_id||null,playerName:row.player_name||null,
        playerHeadshotUrl:row.player_headshot_url||null,team:row.team||null,opponent:row.opponent||null,
        market:row.stat_type||null,marketCanonical:row.canonical_market||null,line:row.line==null?null:Number(row.line),
        oddsTier:row.odds_tier||null,duration:row.duration||null,observedAt:row.observed_at||row.collected_at||null,
        decisionEligible:false,reasonCodes:["PRIZEPICKS_RESEARCH_ONLY"]
      });
    }
    return {...game,playerMarkets};
  });
}

function safeJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function tennisPlayerAbbr(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const last = parts.at(-1) || String(name || "PLAYER");
  return last.slice(0, 12).toUpperCase();
}

function tennisNameKey(name = "") {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tennisRankProfile(name, rankings) {
  return rankings?.byName?.get(tennisNameKey(name)) || null;
}

export async function buildTennisResearchSlate(date, env = {}) {
  if (!env.DB?.prepare) {
    return { sport: "tennis", date, games: [], research: { configured: false, error: "database unavailable" } };
  }
  const [query, rankings] = await Promise.all([
    env.DB.prepare(`
      WITH ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY canonical_event_id
                 ORDER BY decision_timestamp DESC, created_at DESC
               ) AS rn
        FROM tennis_v2_research_decisions
        WHERE event_start_time IS NOT NULL
          AND event_start_time >= datetime(?, '-1 day')
          AND event_start_time < datetime(?, '+2 day')
      ),
      latest_market AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY canonical_event_id, market_type
                 ORDER BY observed_at DESC, collected_at DESC, created_at DESC
               ) AS rn
        FROM tennis_market_snapshots
      ),
      latest_context AS (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY canonical_event_id
                 ORDER BY feature_cutoff_timestamp DESC, collected_at DESC, created_at DESC
               ) AS rn
        FROM tennis_context_snapshots
      )
      SELECT d.canonical_event_id,d.tour,d.player1,d.player2,d.pure_model_id,d.pure_p1,
             d.market_prior_p1,d.market_v2_p1,d.model_edge,d.market_json,d.action_json,
             d.decision_timestamp,d.event_start_time,d.snapshot_type,
             ml.provider AS market_provider,ml.sportsbook,ml.player1_price,ml.player2_price,
             ml.player1_no_vig_prob,ml.player2_no_vig_prob,ml.public_ticket_pct,ml.public_money_pct,
             ml.money_minus_ticket_pct,ml.observed_at AS market_observed_at,ml.collected_at AS market_collected_at,
             sp.player1_line AS spread_player1_line,sp.player2_line AS spread_player2_line,
             sp.player1_price AS spread_player1_price,sp.player2_price AS spread_player2_price,
             sp.player1_no_vig_prob AS spread_player1_no_vig,sp.player2_no_vig_prob AS spread_player2_no_vig,
             sp.public_ticket_pct AS spread_ticket_pct,sp.public_money_pct AS spread_money_pct,
             sp.money_minus_ticket_pct AS spread_money_ticket_gap,
             tot.player1_line AS total_line,tot.over_price,tot.under_price,
             tot.over_no_vig_prob,tot.under_no_vig_prob,
             tot.public_ticket_pct AS total_ticket_pct,tot.public_money_pct AS total_money_pct,
             tot.money_minus_ticket_pct AS total_money_ticket_gap,
             c.tournament,c.surface,c.indoor,c.court_speed_index
      FROM ranked d
      LEFT JOIN latest_market ml ON ml.canonical_event_id=d.canonical_event_id AND ml.market_type='moneyline' AND ml.rn=1
      LEFT JOIN latest_market sp ON sp.canonical_event_id=d.canonical_event_id AND sp.market_type='spread' AND sp.rn=1
      LEFT JOIN latest_market tot ON tot.canonical_event_id=d.canonical_event_id AND tot.market_type='total' AND tot.rn=1
      LEFT JOIN latest_context c ON c.canonical_event_id=d.canonical_event_id AND c.rn=1
      WHERE d.rn=1
      ORDER BY d.event_start_time, d.decision_timestamp DESC
    `).bind(date, date).all(),
    fetchEspnTennisRankings(env.fetchImpl || fetch),
  ]);
  const rows = (query?.results || []).filter((row) => boardDateCtForStart(row.event_start_time) === date);
  const games = await Promise.all(rows.map(async (row) => {
    const bankContext = await tennisCardContext(env.DB,{tour:row.tour,player1:row.player1,player2:row.player2,surface:row.surface}).catch(()=>null);
    const p1 = Number(row.pure_p1);
    const p1Prob = Number.isFinite(p1) ? p1 : null;
    const p2Prob = p1Prob == null ? null : 1 - p1Prob;
    const marketJson = safeJson(row.market_json) || {};
    const actionJson = safeJson(row.action_json) || {};
    const quote = Array.isArray(marketJson.quotes) ? marketJson.quotes[0] || {} : {};
    const p1Rank = tennisRankProfile(row.player1, rankings);
    const p2Rank = tennisRankProfile(row.player2, rankings);
    const p1Price = row.player1_price == null ? (quote?.p1Price == null ? null : Number(quote.p1Price)) : Number(row.player1_price);
    const p2Price = row.player2_price == null ? (quote?.p2Price == null ? null : Number(quote.p2Price)) : Number(row.player2_price);
    const marketP1 = row.player1_no_vig_prob == null
      ? (row.market_prior_p1 == null ? null : Number(row.market_prior_p1))
      : Number(row.player1_no_vig_prob);
    const marketP2 = row.player2_no_vig_prob == null
      ? (marketP1 == null ? null : 1 - marketP1)
      : Number(row.player2_no_vig_prob);
    const spreadP1Line = row.spread_player1_line == null ? null : Number(row.spread_player1_line);
    const spreadP2Line = row.spread_player2_line == null ? null : Number(row.spread_player2_line);
    const spreadP1Price = row.spread_player1_price == null ? null : Number(row.spread_player1_price);
    const spreadP2Price = row.spread_player2_price == null ? null : Number(row.spread_player2_price);
    const totalLine = row.total_line == null ? null : Number(row.total_line);
    const overPrice = row.over_price == null ? null : Number(row.over_price);
    const underPrice = row.under_price == null ? null : Number(row.under_price);
    return {
      id: String(row.canonical_event_id),
      sport: "tennis",
      tour: String(row.tour || "").toUpperCase(),
      neutral: true,
      start: row.event_start_time,
      status: { detail: "Scheduled" },
      away: {
        name: row.player2,
        fullName: row.player2,
        abbr: tennisPlayerAbbr(row.player2),
        logo: p2Rank?.headshot || null,
        canonicalId: p2Rank?.espnId || tennisNameKey(row.player2),
        rank: p2Rank?.rank ?? null,
        rankingPoints: p2Rank?.points ?? null,
        imageSource: p2Rank?.headshot ? "ESPN_TENNIS_RANKINGS" : null,
      },
      home: {
        name: row.player1,
        fullName: row.player1,
        abbr: tennisPlayerAbbr(row.player1),
        logo: p1Rank?.headshot || null,
        canonicalId: p1Rank?.espnId || tennisNameKey(row.player1),
        rank: p1Rank?.rank ?? null,
        rankingPoints: p1Rank?.points ?? null,
        imageSource: p1Rank?.headshot ? "ESPN_TENNIS_RANKINGS" : null,
      },
      model: {
        id: row.pure_model_id || "TENNIS-FBIS-v2-CONTEXT",
        name: "Tennis-FBIS-v2",
        engine: row.pure_model_id || "TENNIS-FBIS-v2-CONTEXT",
        maturity: "RESEARCH",
        projAway: p2Prob == null ? null : p2Prob * 100,
        projHome: p1Prob == null ? null : p1Prob * 100,
        projTotal: 100,
        projMargin: p1Prob == null ? null : (p1Prob - p2Prob) * 100,
        projectionKind: "FBIS",
      },
      modelId: row.pure_model_id || "TENNIS-FBIS-v2-CONTEXT",
      modelVersion: "v2-deep-context-market-separated",
      projectionKind: "FBIS",
      projectionMaturity: "RESEARCH",
      pureProjectionAvailable: p1Prob != null,
      projectionUnavailable: p1Prob == null,
      publicationStatus: "RESEARCH_PUBLISHABLE",
      tennisProjection: {
        player1: row.player1,
        player2: row.player2,
        player1WinProb: p1Prob,
        player2WinProb: p2Prob,
        marketPriorP1: marketP1,
        marketPriorP2: marketP2,
        marketAdjustedP1: row.market_v2_p1 == null ? null : Number(row.market_v2_p1),
        modelEdge: row.model_edge == null ? null : Number(row.model_edge),
        decisionTimestamp: row.decision_timestamp,
        snapshotType: row.snapshot_type || "DECISION",
        tour: String(row.tour || "").toUpperCase(),
        tournament: row.tournament || null,
        surface: row.surface || null,
        indoor: row.indoor == null ? null : Boolean(Number(row.indoor)),
        courtSpeedIndex: row.court_speed_index == null ? null : Number(row.court_speed_index),
        marketProvider: row.market_provider || marketJson.source || quote?.book || null,
        sportsbook: row.sportsbook || quote?.book || null,
        marketObservedAt: row.market_observed_at || null,
        player1Rank: p1Rank?.rank ?? null,
        player2Rank: p2Rank?.rank ?? null,
        player1RankingPoints: p1Rank?.points ?? null,
        player2RankingPoints: p2Rank?.points ?? null,
        playerBank: bankContext,
      },
      market: {
        marketAvailable: false,
        executionActionable: false,
        operatorExecutionBooks: [],
        reference: {
          available: p1Price != null || p2Price != null || marketP1 != null,
          provider: row.market_provider || row.sportsbook || marketJson.source || quote?.book || "TENNIS MARKET · RESEARCH",
          spread: spreadP1Line,
          spreadDetail: spreadP1Line == null ? null : {
            home: spreadP1Line, away: spreadP2Line, homePrice: spreadP1Price, awayPrice: spreadP2Price,
            noVigHome: row.spread_player1_no_vig == null ? null : Number(row.spread_player1_no_vig),
            noVigAway: row.spread_player2_no_vig == null ? null : Number(row.spread_player2_no_vig),
          },
          total: totalLine,
          totalDetail: totalLine == null ? null : {
            line: totalLine, overPrice, underPrice,
            noVigOver: row.over_no_vig_prob == null ? null : Number(row.over_no_vig_prob),
            noVigUnder: row.under_no_vig_prob == null ? null : Number(row.under_no_vig_prob),
          },
          moneyline: {
            home: p1Price,
            away: p2Price,
          },
          noVig: {
            home: marketP1,
            away: marketP2,
          },
          observedAt: row.market_observed_at || row.market_collected_at || null,
        },
      },
      actionIntel: (row.public_ticket_pct != null || row.public_money_pct != null || row.money_minus_ticket_pct != null || Object.keys(actionJson).length)
        ? {
            provider: row.market_provider || "ACTION",
            role: "market_intelligence",
            collectedAt: row.market_collected_at || row.market_observed_at || row.decision_timestamp,
            publicSplits: {
              ticketPct: row.public_ticket_pct == null ? null : Number(row.public_ticket_pct),
              moneyPct: row.public_money_pct == null ? null : Number(row.public_money_pct),
              moneyTicketGap: row.money_minus_ticket_pct == null ? null : Number(row.money_minus_ticket_pct),
              markets: [
                ...(actionJson?.publicSplits?.markets || []),
                ...(row.spread_ticket_pct != null || row.spread_money_pct != null ? [{
                  market: "SPREAD", ticketPct: row.spread_ticket_pct == null ? null : Number(row.spread_ticket_pct),
                  moneyPct: row.spread_money_pct == null ? null : Number(row.spread_money_pct),
                  moneyTicketGap: row.spread_money_ticket_gap == null ? null : Number(row.spread_money_ticket_gap),
                }] : []),
                ...(row.total_ticket_pct != null || row.total_money_pct != null ? [{
                  market: "TOTAL", ticketPct: row.total_ticket_pct == null ? null : Number(row.total_ticket_pct),
                  moneyPct: row.total_money_pct == null ? null : Number(row.total_money_pct),
                  moneyTicketGap: row.total_money_ticket_gap == null ? null : Number(row.total_money_ticket_gap),
                }] : []),
              ],
            },
            trackedBetCount: actionJson?.trackedBetCount ?? null,
            trackedVolume: actionJson?.trackedVolume ?? null,
          }
        : null,
      matchupFactors: [
        ...(p1Rank?.rank != null && p2Rank?.rank != null ? [{
          id: "ranking", label: "Current ranking", edge: p1Rank.rank < p2Rank.rank ? tennisPlayerAbbr(row.player1) : p2Rank.rank < p1Rank.rank ? tennisPlayerAbbr(row.player2) : "EVEN",
          value: Math.abs(Number(p1Rank.rank) - Number(p2Rank.rank)), detail: `${row.player1} #${p1Rank.rank} · ${row.player2} #${p2Rank.rank}`, source: "ESPN tennis rankings"
        }] : []),
        ...(p1Prob != null ? [{
          id: "pure-model", label: "Pure win probability", edge: p1Prob >= .5 ? tennisPlayerAbbr(row.player1) : tennisPlayerAbbr(row.player2),
          value: `${(Math.max(p1Prob,p2Prob)*100).toFixed(1)}%`, detail: `${row.player1} ${(p1Prob*100).toFixed(1)}% · ${row.player2} ${(p2Prob*100).toFixed(1)}%`, source: row.pure_model_id || "TENNIS-FBIS-v2-CONTEXT"
        }] : []),
        ...(marketP1 != null && p1Prob != null ? [{
          id: "model-market", label: "Model vs no-vig market", edge: (p1Prob-marketP1) >= 0 ? tennisPlayerAbbr(row.player1) : tennisPlayerAbbr(row.player2),
          value: `${Math.abs((p1Prob-marketP1)*100).toFixed(1)} pts`, detail: `Pure P1 ${(p1Prob*100).toFixed(1)}% · market P1 ${(marketP1*100).toFixed(1)}%`, source: row.market_provider || row.sportsbook || "tennis market snapshot"
        }] : []),
        ...(row.surface ? [{ id:"surface", label:"Surface / conditions", edge:String(row.surface).toUpperCase(), value: row.court_speed_index == null ? null : Number(row.court_speed_index), detail:`${row.surface}${row.indoor == null ? "" : Number(row.indoor) ? " · indoor" : " · outdoor"}`, source:"tennis context snapshot" }] : []),
      ],
      quality: {
        score: null,
        state: "RESEARCH",
        flags: ["research_only", "tennis_v2"],
      },
      rec: null,
      lean: null,
      authorized: false,
    };
  }));
  return {
    sport: "tennis",
    date,
    games,
    parlay: { cached: true, skipped: true },
    research: {
      configured: true,
      source: "D1 tennis_v2_research_decisions",
      records: games.length,
      modelId: "TENNIS-FBIS-v2-CONTEXT",
      maturity: "RESEARCH",
      canQualify: false,
      canAuthorizeWager: false,
    },
  };
}

export async function buildTodayBoard(
  date,
  env = {},
  { buildSlateFn, querySnapshotsFn, queryOddsSnapshotsFn, now = Date.now(), focusSport = "all" } = {}
) {
  const builder = buildSlateFn || buildSlate;
  const querySnaps = querySnapshotsFn || querySnapshots;
  const queryOdds = queryOddsSnapshotsFn || queryOddsSnapshots;
  const sportsToLoad =
    focusSport && focusSport !== "all" && BOARD_SPORTS.includes(focusSport) ? [focusSport] : BOARD_SPORTS;
  const sports = [];
  const games = [];
  const feeds = {};
  let parlayNetwork = 0;
  const actionIntelMeta = {
    attached: 0,
    checked: 0,
    rematched: 0,
    durableMatched: 0,
    legacyFallbackMatched: 0,
    matchedIds: new Set(),
  };
  for (const sport of sportsToLoad) {
    try {
      const focused = focusSport && focusSport !== "all" && focusSport === sport;
      // The customer-facing board is a read path, never a collection path.
      // A focused tab must not burn quota or block on live provider/network I/O.
      // Scheduled /api/collect jobs own live provider refreshes and D1/cache writes.
      const slate = sport === "tennis"
        ? await buildTennisResearchSlate(date, env)
        : await builder(sport, date, {
        ...env,
        parlayCacheOnly: true,
        palCacheOnly: true,
      });
      let bySnapshot = new Map();
      let byMarketOdds = new Map();
      let byMarketHistory = new Map();
      if (env.DB) {
        const snapQ = await querySnaps(env, { sport, since: date, until: date, checkpoint: "LATEST" });
        if (snapQ?.ok && Array.isArray(snapQ.rows) && snapQ.rows.length) {
          bySnapshot = buildSnapshotOddsByGame(snapQ.rows);
        }
        const oddsQ = await queryOdds(env, { sport, since: date, until: date });
        if (oddsQ?.ok && Array.isArray(oddsQ.rows) && oddsQ.rows.length) {
          byMarketOdds = buildMarketOddsByGame(oddsQ.rows);
          byMarketHistory = buildMarketLineHistoryByGame(oddsQ.rows);
        }
      }
      if (slate?.parlay?.cached === false && slate?.parlay?.skipped !== true && !slate?.parlay?.error) {
        parlayNetwork += 1;
      }
      // Some provider scoreboards return a weekly/windowed slate even when a
      // YYYYMMDD date is requested (notably football). TODAY is explicitly a
      // Chicago-calendar-day product, so fail closed to games that actually
      // start on the selected CT date before recommendation/qualification.
      const selectedDateGames = (slate.games || []).filter(
        (g) => boardDateCtForStart(g?.start) === date
      );
      const hydratedGames = selectedDateGames.map((g) => ({
        ...hydrateOddsFromMarketRows(hydrateOddsFromSnapshot(g, bySnapshot.get(String(g.id))), byMarketOdds.get(String(g.id))),
        marketLineHistory: byMarketHistory.get(String(g.id)) || [],
      }));
      const recSlate = sport === "tennis"
        ? {
            ...slate,
            games: hydratedGames.map((g) => ({
              ...g,
              rec: null,
              lean: null,
              qualificationBlocked: true,
              qualificationBlockReason: "TENNIS_V2_RESEARCH_ONLY",
            })),
          }
        : withRecs({ ...slate, games: hydratedGames }, DEFAULT_WEIGHTS);
      const palReason = sport === "mlb" ? palUnavailableReason(slate.pal?.meta || slate.pal || {}, null) : null;

      // ACTION must hydrate onto slate games BEFORE resolveCanonicalMarket / toBoardGame.
      let slateGames = (recSlate.games || []).map((g) => ({
        ...g,
        sport,
        palUnavailableReason: g.bpp ? g.palUnavailableReason : palReason,
      }));
      if (env.DB) {
        try {
          const { attachActionIntelToGames } = await import("./boardActionIntel.js");
          const attached = await attachActionIntelToGames(slateGames, env.DB);
          slateGames = attached.games || slateGames;
          actionIntelMeta.checked += attached.checked || 0;
          actionIntelMeta.attached += attached.attached || 0;
          actionIntelMeta.rematched += attached.rematched || 0;
          actionIntelMeta.durableMatched += attached.durableMatched || 0;
          actionIntelMeta.legacyFallbackMatched += attached.legacyFallbackMatched || 0;
          for (const id of attached.matchedIds || []) actionIntelMeta.matchedIds.add(String(id));
        } catch {
          // Fail-open: continue without ACTION on this sport.
        }
      }

      if (sport === "nhl") slateGames = slateGames.map((g)=>({...g,nhlWagerV1:evaluateNhlGameWagers(g)}));
      if (env.DB) slateGames = await attachPrizePicksMarkets(slateGames, sport, date, env.DB);
      const rows = slateGames.map((g) => toBoardGame(g, sport, now));
      feeds[sport] = {
        ok: true,
        n: rows.length,
        error: null,
        liveFocus: false,
        focused,
        pal: slate.pal || null,
        palReason: sport === "mlb" ? palUnavailableReason(slate.pal?.meta || slate.pal || {}, null) : null,
        parlay: slate.parlay || null,
        cachedParlay: Boolean(slate.parlay?.cached || slate.parlay?.skipped),
        // Preserve upstream model-source telemetry on the TODAY response. Previously
        // the board could fall back to a projection and look healthy even when the
        // subscribed/advanced data source feeding that sport was unavailable.
        sources: {
          ...(sport === "mlb" ? {
            savant: slate.savant || null,
            ballparkPal: slate.pal || null,
            bullpen: slate.research?.mlbBullpen || null,
          } : {}),
          ...(sport === "cfb" ? {
            cfbd: slate.cfb || null,
            deep: slate.research?.cfbDeepFeed || null,
          } : {}),
          ...(sport === "cbb" ? {
            cbbd: slate.cbbd || null,
            researchBoard: slate.research?.cbbResearchBoard || null,
          } : {}),
          ...(sport === "nfl" ? {
            nflverse: slate.research?.nflVerse || null,
            baseline: slate.research?.nflBaseline || null,
          } : {}),
          ...(sport === "tennis" ? {
            tennisV2: slate.research || null,
          } : {}),
        },
      };
      sports.push({
        sport,
        label: SPORTS[sport].label,
        n: rows.length,
        games: sortByStart(rows),
      });
      games.push(...rows);
    } catch (err) {
      feeds[sport] = { ok: false, n: 0, error: String(err?.message || err) };
      sports.push({
        sport,
        label: SPORTS[sport].label,
        n: 0,
        games: [],
        error: String(err?.message || err),
      });
    }
  }
  const all = sortByStart(games);
  // Derive sport groups from the same canonical game objects (already ACTION-hydrated).
  for (const s of sports) {
    const byId = new Map(all.filter((g) => g.sport === s.sport).map((g) => [g.id, g]));
    s.games = sortByStart((s.games || []).map((g) => byId.get(g.id) || g));
  }
  const empty = all.length ? null : emptyTodayState({ date, feeds });
  return {
    date,
    timezone: "America/Chicago",
    generatedAt: new Date().toISOString(),
    sports,
    games: all,
    actionIntel: {
      role: "market_intelligence",
      governanceMode: "shadow",
      displayOnly: true,
      inProductionRouter: false,
      canQualify: false,
      canAuthorizeWager: false,
      decisionEligible: false,
      pureGameFeatureAllowed: false,
      purePlayerFeatureAllowed: false,
      source: "durable-series",
      attached: actionIntelMeta.attached,
      checked: actionIntelMeta.checked,
      rematched: actionIntelMeta.rematched,
      durableMatched: actionIntelMeta.durableMatched,
      legacyFallbackMatched: actionIntelMeta.legacyFallbackMatched,
      unmatched: Math.max(0, actionIntelMeta.checked - actionIntelMeta.attached),
      matchedIds: [...actionIntelMeta.matchedIds],
    },
    groups: groupBySport(all).filter((g) => sportsToLoad.includes(g.sport)),
    counts: {
      games: all.length,
      bySport: Object.fromEntries(sports.map((s) => [s.sport, s.n])),
      scheduled: all.filter((g) => isPreStartStatus(g.status)).length,
      live: all.filter((g) => isLiveStatus(g.status)).length,
      final: all.filter((g) => g.status === "final").length,
      qualified: all.filter((g) => g.rec).length,
      leans: all.filter((g) => g.lean && !g.rec).length,
      postponed: all.filter((g) => g.status === "postponed").length,
      mlbPropWatch: summarizeMlbPropWatch(all, feeds.mlb?.parlay || {}),
      cfbDiagnostics: (all.filter((g) => g.sport === "cfb").length
        ? {
            states: Object.fromEntries(
              ["COMPLETE", "PARTIAL", "PRIOR_ONLY", "LEAGUE_AVERAGE_ONLY", "UNAVAILABLE"].map((s) => [
                s,
                all.filter((g) => g.sport === "cfb" && g.projectionState === s).length,
              ])
            ),
          }
        : null),
    },
    feeds,
    empty,
    parlay: {
      cacheOnly: true,
      focusSport: focusSport || "all",
      extraFullOddsRequests: parlayNetwork,
    },
  };
}
