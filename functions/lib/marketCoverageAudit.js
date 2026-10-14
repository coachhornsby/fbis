/**
 * Reproducible sport × provider market linkage audit against D1.
 * Observation linkage and event coverage are reported separately.
 * Never invents matches, clocks, or provider capability.
 */

export const AUDIT_SPORTS = Object.freeze([
  "nfl", "cfb", "cbb", "nba", "wnba", "mlb", "npb", "kbo", "nhl", "soccer", "tennis",
]);

export const AUDIT_SOURCES = Object.freeze([
  "Polymarket US",
  "Polymarket US WebSocket",
  "PinnOdds",
  "PrizePicks GitHub Mirror",
]);

const PINNODDS_SPORT = Object.freeze({
  1: "soccer", 2: "tennis", 3: "basketball_family", 4: "nhl", 5: "football_family", 6: "baseball_family",
});

function rate(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 10000) / 10000;
}

/**
 * Summarize normalized_market_observations for one sport.
 * Eligibility: observations collected within lookbackHours (default 48h).
 */
export async function auditSportMarketCoverage(db, sport, {
  now = new Date(),
  lookbackHours = 48,
} = {}) {
  if (!db?.prepare || !sport) {
    return { sport, ok: false, error: "DATABASE_OR_SPORT_REQUIRED" };
  }
  const until = now instanceof Date ? now.toISOString() : String(now);
  const sinceMs = Date.parse(until) - lookbackHours * 3600 * 1000;
  if (!Number.isFinite(Date.parse(until)) || !Number.isFinite(sinceMs)) {
    return { sport, ok: false, error: "INVALID_TIME_WINDOW" };
  }
  const since = new Date(sinceMs).toISOString();

  const bySource = [];
  for (const source of AUDIT_SOURCES) {
    const row = (await db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN canonical_event_id IS NOT NULL AND TRIM(canonical_event_id) != '' THEN 1 ELSE 0 END) AS linked,
        SUM(CASE WHEN canonical_event_id IS NULL OR TRIM(canonical_event_id) = '' THEN 1 ELSE 0 END) AS unmatched,
        MAX(collected_at) AS latest_collected_at,
        MAX(source_observed_at) AS latest_provider_observed_at,
        COUNT(DISTINCT CASE WHEN canonical_event_id IS NOT NULL AND TRIM(canonical_event_id) != '' THEN canonical_event_id END) AS linked_events
      FROM normalized_market_observations
      WHERE sport = ? AND source = ?
        AND collected_at BETWEEN ? AND ?
    `).bind(sport, source, since, until).first().catch(() => null)) || {};

    const total = Number(row.total) || 0;
    const linked = Number(row.linked) || 0;
    const unmatched = Number(row.unmatched) || 0;
    bySource.push({
      source,
      totalObservations: total,
      linkedObservations: linked,
      unmatchedObservations: unmatched,
      observationLinkageRate: rate(linked, total),
      linkedEvents: Number(row.linked_events) || 0,
      latestCollectedAt: row.latest_collected_at || null,
      latestProviderObservedAt: row.latest_provider_observed_at || null,
      status: total === 0 ? "NO_RECENT_OBSERVATIONS" : linked === 0 ? "BROKEN_OR_UNMATCHED" : unmatched > linked ? "PARTIAL" : "LINKED",
    });
  }

  // Upcoming / recent slate events from games (tennis uses official + external fixtures).
  let eligibleEvents = 0;
  let eventsWithMarket = 0;
  if (sport === "tennis") {
    const slate = await db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT match_id AS id FROM tennis_official_matches
         WHERE match_time BETWEEN ? AND ?
        UNION
        SELECT fixture_id AS id FROM tennis_external_fixtures
         WHERE source='ESPN_PUBLIC' AND match_time BETWEEN ? AND ?
      )
    `).bind(since, until, since, until).first().catch(() => ({ n: 0 }));
    eligibleEvents = Number(slate?.n) || 0;
    // Event coverage denominator is the same fixture window — do not count
    // linked observations whose fixtures fall outside the eligible slate.
    const linked = await db.prepare(`
      SELECT COUNT(DISTINCT o.canonical_event_id) AS n
      FROM normalized_market_observations o
      WHERE o.sport='tennis'
        AND o.canonical_event_id IS NOT NULL AND TRIM(o.canonical_event_id) != ''
        AND o.collected_at BETWEEN ? AND ?
        AND (
          o.canonical_event_id IN (
            SELECT match_id FROM tennis_official_matches WHERE match_time BETWEEN ? AND ?
          )
          OR o.canonical_event_id IN (
            SELECT fixture_id FROM tennis_external_fixtures
             WHERE source='ESPN_PUBLIC' AND match_time BETWEEN ? AND ?
          )
        )
    `).bind(since, until, since, until, since, until).first().catch(() => ({ n: 0 }));
    eventsWithMarket = Number(linked?.n) || 0;
  } else {
    const slate = await db.prepare(`
      SELECT COUNT(*) AS n FROM games
      WHERE sport=? AND start BETWEEN ? AND ?
    `).bind(sport, since, until).first().catch(() => ({ n: 0 }));
    eligibleEvents = Number(slate?.n) || 0;
    const linked = await db.prepare(`
      SELECT COUNT(DISTINCT g.id) AS n
      FROM games g
      JOIN normalized_market_observations o
        ON o.canonical_event_id = g.id AND o.sport = g.sport
      WHERE g.sport=? AND g.start BETWEEN ? AND ?
        AND o.collected_at BETWEEN ? AND ?
        AND o.canonical_event_id IS NOT NULL
    `).bind(sport, since, until, since, until).first().catch(() => ({ n: 0 }));
    eventsWithMarket = Number(linked?.n) || 0;
  }

  const totalObs = bySource.reduce((n, s) => n + s.totalObservations, 0);
  const linkedObs = bySource.reduce((n, s) => n + s.linkedObservations, 0);

  return {
    sport,
    ok: true,
    window: { since, until, lookbackHours },
    totals: {
      totalObservations: totalObs,
      linkedObservations: linkedObs,
      unmatchedObservations: totalObs - linkedObs,
      observationLinkageRate: rate(linkedObs, totalObs),
      eligibleEvents,
      eventsWithLinkedMarket: eventsWithMarket,
      eventMarketCoverage: rate(eventsWithMarket, eligibleEvents),
    },
    bySource,
  };
}

export async function auditPlatformMarketCoverage(db, options = {}) {
  const sports = options.sports || AUDIT_SPORTS;
  const rows = [];
  for (const sport of sports) {
    rows.push(await auditSportMarketCoverage(db, sport, options));
  }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    pinnoddsSportIdMap: PINNODDS_SPORT,
    eligibility:
      "Observations collected within lookbackHours; event coverage uses games.start (or tennis official/ESPN fixtures) in the same window.",
    sports: rows,
  };
}
