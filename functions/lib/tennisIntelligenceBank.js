import { resolveTennisFixturePlayers } from "./tennisFixturePlayerLink.js";
import { tennisCardContext, tennisKey } from "./tennisPlayerBank.js";
import { approvedTennisPortraits } from "./tennisPortraits.js";
import { fetchEspnTennisRankings } from "./tennisPrizePicksResearch.js";
import {loadKalshiTennisResearch,matchKalshiTennisResearch} from "./tennisKalshiResearch.js";
import {discoverPolymarketGlobalTennis,matchPolymarketGlobalTennis} from "./tennisPolymarketGlobal.js";
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const number = v => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/** Read current offers; never relink historical observations or refresh their clocks. */
export async function tennisFixtureOffers(db, fixture, { now = new Date() } = {}) {
  const until = now.toISOString(), since = new Date(+now - 7 * 3600000).toISOString();
  const q = await db.prepare(`WITH ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY source,source_market_id,source_outcome_id,period
      ORDER BY collected_at DESC,created_at DESC) rn
    FROM normalized_market_observations WHERE sport='tennis' AND canonical_event_id=?
      AND julianday(collected_at) BETWEEN julianday(?) AND julianday(?)
      AND (source_observed_at IS NULL OR julianday(source_observed_at) BETWEEN julianday(?) AND julianday(?))
  ) SELECT * FROM ranked WHERE rn=1 ORDER BY source,market_family,side LIMIT 500`)
    .bind(fixture.id, since, until, since, until).all();
  return (q.results || []).filter(r => {
    const at = Date.parse(r.collected_at), observed = r.source_observed_at == null ? at : Date.parse(r.source_observed_at);
    return at >= Date.parse(since) && at <= +now && observed >= Date.parse(since) && observed <= +now &&
      Math.abs(Date.parse(r.event_start_time) - Date.parse(fixture.start)) <= 2 * 3600000;
  }).map(r => {
    const raw = parse(r.raw_payload_json), originalSide = String(r.side || "");
    const participant = originalSide === "home" ? r.home_team : originalSide === "away" ? r.away_team : originalSide;
    const side = raw?.contractLong === false ? null : tennisKey(participant) === tennisKey(fixture.home_name) ? "home" :
      tennisKey(participant) === tennisKey(fixture.away_name) ? "away" : /^(over|under)$/.test(originalSide) ? originalSide : null;
    return { observationId: r.id, source: r.source, sourceType: r.source_type, marketFamily: r.market_family,
      statFamily: r.stat_family, period: r.period, sourceMarketId: r.source_market_id, sourceOutcomeId: r.source_outcome_id,
      side, providerSide: originalSide, participantName: participant || null, line: number(r.line),
      americanOdds: number(r.american_odds), decimalOdds: number(r.decimal_odds), contractPrice: number(r.contract_price),
      standardOrAlt: r.standard_or_alt, sourceObservedAt: r.source_observed_at ?? null, collectedAt: r.collected_at,
      observedAt: r.source_observed_at ?? null, providerQuoteClockVerified: r.source_observed_at != null,
      rawSnapshotKey: raw?.rawSnapshotKey || null, canQualify: false, canAuthorizeWager: false, modelInfluence: "none" };
  });
}


/**
 * Read-only official ATP/WTA metadata for an independently observed ESPN fixture.
 * This does NOT verify the ESPN fixture, authorize its model, or match markets.
 * Fail closed when identity, kickoff, source or uniqueness are uncertain.
 */
export async function lookupOfficialTennisDisplayMetadata(db, fixture, players, {now=new Date()}={}) {
  const tour=String(fixture?.tour||"").toLowerCase();
  if (!["atp","wta"].includes(tour) ||
      !Array.isArray(players) || players.length!==2 ||
      players.some(p=>!p?.fbisPlayerId || p?.officialIdentityVerified!==true) ||
      !Number.isFinite(Date.parse(fixture.start))) return null;
  const ids=players.map(p=>p.fbisPlayerId);
  if(ids[0]===ids[1])return null;
  try {
    const officialSource=tour==='atp'?'ATP_OFFICIAL':'WTA_OFFICIAL';
    const q=await db.prepare(`SELECT match_id,tournament_name,tournament_level,round_code,
      match_time,surface,indoor_outdoor,venue,source,observed_at
      FROM tennis_official_matches
      WHERE tour=? AND source=?
        AND ((player1_id=? AND player2_id=?) OR (player1_id=? AND player2_id=?))
        AND ABS((julianday(match_time)-julianday(?))*24*60)<=120
        AND julianday(observed_at)<=julianday(?)
      ORDER BY ABS(julianday(match_time)-julianday(?)) LIMIT 2`)
      .bind(tour,officialSource,ids[0],ids[1],ids[1],ids[0],fixture.start,now.toISOString(),fixture.start).all();
    const rows=q?.results||[];
    if(rows.length!==1)return null;
    const r=rows[0];
    if(!r.match_id || Date.parse(r.observed_at)>+now ||
       Math.abs(Date.parse(r.match_time)-Date.parse(fixture.start))>120*60000)return null;
    return {source:officialSource,sourceMatchId:r.match_id,observedAt:r.observed_at,
      tournament:r.tournament_name||null,tournamentLevel:r.tournament_level||null,
      round:r.round_code||null,surface:r.surface||null,
      indoor:r.indoor_outdoor==="INDOOR"?true:r.indoor_outdoor==="OUTDOOR"?false:null,
      venue:r.venue||null, displayOnly:true, canQualify:false,canAuthorizeWager:false};
  } catch {return null;}
}

export async function buildTennisIntelligenceBank(db, { limit = 50, now = new Date() } = {}) {
  // Independent ESPN fixtures are display-only; retain a bounded 12-hour
  // source window for live/pregame continuity during collector interruptions.
  // Staleness is explicitly reported, never interpreted as live verification.
  const until = now.toISOString(), since = new Date(+now - 12 * 3600000).toISOString();
  const q = await db.prepare(`SELECT fixture_id AS id,tour,player1_name AS away_name,
    player2_name AS home_name,match_time AS start,status,source,fetched_at,raw_hash,raw_key
    FROM tennis_external_fixtures WHERE source='ESPN_PUBLIC' AND status IN ('SCHEDULED','IN_PROGRESS')
    AND julianday(fetched_at) BETWEEN julianday(?) AND julianday(?)
    AND julianday(match_time) BETWEEN julianday(?) AND julianday(?)
    ORDER BY match_time ASC LIMIT ?`).bind(since, until, new Date(+now - 8 * 3600000).toISOString(),
      new Date(+now + 72 * 3600000).toISOString(), Math.min(100, Math.max(1, Number(limit) || 50))).all();
  const fixtures = [];
  for (const fixture of q.results || []) {
    if (!fixture.id?.startsWith(`tennis:espn:${fixture.tour}:`) || fixture.source !== "ESPN_PUBLIC" ||
      !fixture.raw_hash || !fixture.raw_key || !["SCHEDULED", "IN_PROGRESS"].includes(fixture.status) ||
      !(Date.parse(fixture.fetched_at) >= Date.parse(since) && Date.parse(fixture.fetched_at) <= +now) ||
      !(Date.parse(fixture.start) >= +now - 8 * 3600000 && Date.parse(fixture.start) <= +now + 72 * 3600000)) continue;
    const identity = await resolveTennisFixturePlayers(db, fixture);
    if (!identity.players.length) continue;
    const players = [];
    for (const player of identity.players) {
      const profiles = player.matched ? await db.prepare(`SELECT surface,profile_json,last_match_date,
        source,source_license,source_as_of,production_dependency,updated_at FROM tennis_player_profiles_current
        WHERE tour=? AND player_key=? ORDER BY surface`).bind(fixture.tour, tennisKey(player.fixtureName)).all() : { results: [] };
      players.push({ ...player, profiles: (profiles.results || []).map(p => ({ surface: p.surface,
        profile: parse(p.profile_json), lastMatchDate: p.last_match_date, source: p.source, license: p.source_license,
        sourceAsOf: p.source_as_of, retrievedAt: p.updated_at, productionDependency: Boolean(p.production_dependency) })) });
    }
    const officialDisplay = await lookupOfficialTennisDisplayMetadata(db,fixture,players,{now});
    const venueOffers = await tennisFixtureOffers(db, fixture, { now });
    const fixtureAgeMs=+now-Date.parse(fixture.fetched_at);
    fixtures.push({ ...fixture, fixtureFreshness:fixtureAgeMs<=3*3600000?"CURRENT":"STALE", players, officialDisplay, playerIdentityVerified: identity.verified, venueOffers,
      linkedMarkets: [...new Set(venueOffers.map(o => o.source))].map(source => ({ source,
        observations: venueOffers.filter(o => o.source === source).length })),
      officialSourceVerified: false, researchOnly: true, canQualify: false, canAuthorizeWager: false });
  }
  return { ok: true, researchOnly: true, asOf: until, fixtureCount: fixtures.length, fixtures,
    playerIdentityComplete: fixtures.filter(f => f.playerIdentityVerified).length,
    fixturesWithLinkedMarkets: fixtures.filter(f => f.venueOffers.length).length, canQualify: false, canAuthorizeWager: false };
}

let tennisRankingDisplayCache = {expiresAt:0, value:null};
async function loadTennisRankingDisplayCache() {
  const now=Date.now();
  if(tennisRankingDisplayCache.value && now<tennisRankingDisplayCache.expiresAt)
    return tennisRankingDisplayCache.value;
  // Ranking snapshots never authorize a fixture, prediction or wager. A bounded
  // read prevents an external source outage from blocking the entire board.
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),3500);
  try {
    const value=await fetchEspnTennisRankings((url,init)=>fetch(url,{...init,signal:controller.signal}));
    tennisRankingDisplayCache={value,expiresAt:Date.now()+15*60*1000};
    return value;
  } catch {
    tennisRankingDisplayCache={value:{byName:new Map()},expiresAt:Date.now()+60*1000};
    return tennisRankingDisplayCache.value;
  } finally { clearTimeout(timeout); }
}


/** Surface-Elo-only *research estimate*. Not the FBIS PURE projection and
 * never eligible for market-edge, qualification, or wager decisions.
 * No neutral/hard default when event surface has not been verified.
 */
export function surfaceEloResearchEstimate(players, officialDisplay) {
  const surface=String(officialDisplay?.surface||"").toLowerCase();
  if(!["hard","clay","grass"].includes(surface)||!Array.isArray(players)||players.length!==2)return null;
  const observations=players.map(player=>{
    const row=player?.profiles?.find(x=>String(x.surface).toLowerCase()===surface);
    const p=row?.profile||{};
    const matches=Number(p.surfaceMatches);
    const elo=Number(p.surfaceElo?.[surface]);
    if(!Number.isFinite(matches)||matches<5||!Number.isFinite(elo)||elo<1000||elo>2400||!row.lastMatchDate)return null;
    return {elo,matches,lastMatchDate:row.lastMatchDate,source:row.source};
  });
  if(observations.some(x=>!x))return null;
  const probability=1/(1+Math.pow(10,(observations[1].elo-observations[0].elo)/400));
  return {player1WinProb:Math.round(probability*1000)/1000,
    player2WinProb:Math.round((1-probability)*1000)/1000,
    source:"SURFACE_ELO_RESEARCH_ONLY",surface,observations,
    canQualify:false,canAuthorizeWager:false,marketInformed:false};
}

export async function buildIndependentTennisCards(db, date, { now = new Date(), archive = null } = {}) {
  const bank = await buildTennisIntelligenceBank(db, { now, limit: 100 });
  const kalshi=await loadKalshiTennisResearch({ARCHIVE:archive},now);
  const polymarketGlobal=await discoverPolymarketGlobalTennis({now}).catch(()=>({events:[],code:"SOURCE_UNAVAILABLE"}));
  const ctDay = start => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start));
  // One bounded rights lookup for the slate. Approved R2 portraits take priority
  // over provider-feed URLs, including independently sourced research fixtures.
  const visibleFixtures=bank.fixtures.filter(f => ctDay(f.start) === date);
  const ids=[...new Set(visibleFixtures.flatMap(f => f.players.map(p => p.fbisPlayerId).filter(Boolean)))];
  const chunks=[];for(let i=0;i<ids.length;i+=20)chunks.push(ids.slice(i,i+20));
  const batches=await Promise.all(chunks.map(chunk=>approvedTennisPortraits(db,chunk)));
  const portraitMap=new Map(batches.flatMap(group=>[...group.entries()]));
  // ESPN rankings are independent display context, never fixture or projection proof.
  const rankingFeed = await loadTennisRankingDisplayCache();
  const games = [];
  for (const f of visibleFixtures) {
    // Existing card player1 is home, independent fixture player1 is away.
    const [p1, p2] = f.players;
    const team = p => {
      const approved=portraitMap.get(p.fbisPlayerId),url=approved?.url||p.headshotUrl||null;
      const ranking=rankingFeed.byName?.get(tennisKey(p.fixtureName));
      const externalRank=ranking?.tour===f.tour?ranking:null;
      return { name:p.fixtureName, fullName:p.fixtureName, abbr:p.fixtureName.split(" ").at(-1),
        rank:p.rank??externalRank?.rank??null, rankingPoints:p.rankingPoints??externalRank?.points??null, country:p.country??externalRank?.country??null,
        logo:url, headshotUrl:url, fbisPlayerId:p.fbisPlayerId??null,
        imageSource:approved?"RIGHTS_VERIFIED_TENNIS_PORTRAIT":p.headshotSource||null,
        portraitCredit:approved?.credit||null, portraitSourceUrl:approved?.sourceUrl||null,
        portraitLicenseUrl:approved?.licenseUrl||null };
    };
    const context = await tennisCardContext(db, { tour: f.tour, player1: p1.fixtureName,
      player2: p2.fixtureName, surface: f.officialDisplay?.surface||null }).catch(() => null);
    const researchEstimate=surfaceEloResearchEstimate(f.players,f.officialDisplay);
    const kalshiResearchOffers=matchKalshiTennisResearch(f,kalshi[f.tour]||[],now);
    const polymarketGlobalOffers=matchPolymarketGlobalTennis(f,polymarketGlobal.events||[],{now,asOf:polymarketGlobal.asOf||now.toISOString()});
    const playerBank = { ...context, players: f.players.map((p, i) => ({ ...(context?.players?.[i] || {}),
      ...p, headshot: p.headshotUrl ?? null, recentForm: context?.players?.[i]?.recentForm || [] })) };
    const venueOffers = f.venueOffers.map(o => ({ ...o, side: o.side === "home" ? "away" : o.side === "away" ? "home" : o.side }));
    const missingEvidence=[
      f.fixtureFreshness==="STALE" && "STALE_FIXTURE_STATUS",
      !f.officialDisplay && "OFFICIAL_MATCH_CONTEXT",
      f.players.some(p=>!p.matched) && "PLAYER_IDENTITY",
      f.players.some(p=>p.rank==null && rankingFeed.byName?.get(tennisKey(p.fixtureName))?.rank==null) && "CURRENT_RANKING",
      f.players.some(p=>!p.country && !rankingFeed.byName?.get(tennisKey(p.fixtureName))?.country) && "NATIONALITY",
      f.players.some(p=>!p.headshotUrl && !portraitMap.get(p.fbisPlayerId)) && "HEADSHOT",
      !f.venueOffers.length && "MATCHED_MARKET_QUOTES",
      "INDEPENDENT_MODEL_PROJECTION"
    ].filter(Boolean);
    games.push({ id: f.id, sport: "tennis", tour: f.tour, start: f.start, status: f.status,
      home: team(p1), away: team(p2), projectionKind: "UNAVAILABLE", pureProjectionAvailable: false, projectionUnavailable: true,
      publicationStatus: "RESEARCH_FIXTURE_ONLY", canQualify: false, canAuthorizeWager: false, qualificationBlocked: true,
      qualificationBlockReason: "INDEPENDENT_FIXTURE_NO_PIT_PROJECTION", rec: null, lean: null, authorized: false,
      quality: { state: "RESEARCH", flags: ["research_only", "independent_fixture", "projection_unavailable"] },
      market: { reference: { available: venueOffers.length > 0 }, venueOffers, executionActionable: false },
      tennisProjection: { researchFixture: { verified: true, source: f.source, fixtureId: f.id, officialDisplayEvidence: f.officialDisplay||null,
        fetchedAt: f.fetched_at, fixtureFreshness:f.fixtureFreshness, rawHash: f.raw_hash, rawKey: f.raw_key, missingEvidence },
        eventIntegrity: { valid: false, reason: "OFFICIAL_PROJECTION_UNAVAILABLE" },
        blockedReason: f.officialDisplay ? "OFFICIAL_METADATA_MATCHED_DISPLAY_ONLY: projection/event authority remains unverified for this ESPN fixture" : "OFFICIAL_EVENT_MISSING: independent ESPN fixture has no official schedule proof; surface and match format unverified",
        researchEstimate, kalshiResearchOffers, polymarketGlobalOffers, player1: p1.fixtureName, player2: p2.fixtureName, player1WinProb: null, player2WinProb: null,
        surface: f.officialDisplay?.surface||null, indoor:f.officialDisplay?.indoor??null,
        tournament:f.officialDisplay?.tournament||null, round:f.officialDisplay?.round||null,
        venue:f.officialDisplay?.venue||null, playerBank, venueOffers, canQualify: false, canAuthorizeWager: false }
    });
  }
  return { games, coverage: { fixtures: games.length, playerIdentityComplete: bank.playerIdentityComplete,
    fixturesWithLinkedMarkets: bank.fixturesWithLinkedMarkets, asOf: bank.asOf } };
}
