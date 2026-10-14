import { resolveTennisFixturePlayers } from "./tennisFixturePlayerLink.js";
import { tennisCardContext, tennisKey } from "./tennisPlayerBank.js";
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

export async function buildTennisIntelligenceBank(db, { limit = 50, now = new Date() } = {}) {
  const until = now.toISOString(), since = new Date(+now - 18 * 3600000).toISOString();
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
    const venueOffers = await tennisFixtureOffers(db, fixture, { now });
    fixtures.push({ ...fixture, players, playerIdentityVerified: identity.verified, venueOffers,
      linkedMarkets: [...new Set(venueOffers.map(o => o.source))].map(source => ({ source,
        observations: venueOffers.filter(o => o.source === source).length })),
      officialSourceVerified: false, researchOnly: true, canQualify: false, canAuthorizeWager: false });
  }
  return { ok: true, researchOnly: true, asOf: until, fixtureCount: fixtures.length, fixtures,
    playerIdentityComplete: fixtures.filter(f => f.playerIdentityVerified).length,
    fixturesWithLinkedMarkets: fixtures.filter(f => f.venueOffers.length).length, canQualify: false, canAuthorizeWager: false };
}

export async function buildIndependentTennisCards(db, date, { now = new Date() } = {}) {
  const bank = await buildTennisIntelligenceBank(db, { now, limit: 100 });
  const ctDay = start => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start));
  const games = [];
  for (const f of bank.fixtures.filter(f => ctDay(f.start) === date)) {
    // Existing card player1 is home, independent fixture player1 is away.
    const [p1, p2] = f.players;
    const team = p => ({ name: p.fixtureName, fullName: p.fixtureName, abbr: p.fixtureName.split(" ").at(-1),
      rank: p.rank ?? null, rankingPoints: p.rankingPoints ?? null, country: p.country ?? null,
      logo: p.headshotUrl ?? null, headshotUrl: p.headshotUrl ?? null, fbisPlayerId: p.fbisPlayerId ?? null });
    const context = await tennisCardContext(db, { tour: f.tour, player1: p1.fixtureName,
      player2: p2.fixtureName, surface: null }).catch(() => null);
    const playerBank = { ...context, players: f.players.map((p, i) => ({ ...(context?.players?.[i] || {}),
      ...p, headshot: p.headshotUrl ?? null, recentForm: context?.players?.[i]?.recentForm || [] })) };
    const venueOffers = f.venueOffers.map(o => ({ ...o, side: o.side === "home" ? "away" : o.side === "away" ? "home" : o.side }));
    games.push({ id: f.id, sport: "tennis", tour: f.tour, start: f.start, status: f.status,
      home: team(p1), away: team(p2), projectionKind: "UNAVAILABLE", pureProjectionAvailable: false, projectionUnavailable: true,
      publicationStatus: "RESEARCH_FIXTURE_ONLY", canQualify: false, canAuthorizeWager: false, qualificationBlocked: true,
      qualificationBlockReason: "INDEPENDENT_FIXTURE_NO_PIT_PROJECTION", rec: null, lean: null, authorized: false,
      quality: { state: "RESEARCH", flags: ["research_only", "independent_fixture", "projection_unavailable"] },
      market: { reference: { available: venueOffers.length > 0 }, venueOffers, executionActionable: false },
      tennisProjection: { researchFixture: { verified: true, source: f.source, fixtureId: f.id,
        fetchedAt: f.fetched_at, rawHash: f.raw_hash, rawKey: f.raw_key },
        eventIntegrity: { valid: false, reason: "OFFICIAL_PROJECTION_UNAVAILABLE" },
        blockedReason: "OFFICIAL_EVENT_MISSING: independent ESPN fixture has no official schedule proof; surface and match format unverified",
        player1: p1.fixtureName, player2: p2.fixtureName, player1WinProb: null, player2WinProb: null,
        surface: null, tournament: null, playerBank, venueOffers, canQualify: false, canAuthorizeWager: false }
    });
  }
  return { games, coverage: { fixtures: games.length, playerIdentityComplete: bank.playerIdentityComplete,
    fixturesWithLinkedMarkets: bank.fixturesWithLinkedMarkets, asOf: bank.asOf } };
}
