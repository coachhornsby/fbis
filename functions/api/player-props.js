import {
  PRO_PLAYER_PROP_SPORTS,
  canonicalizeProPlayerPropMarket,
  extractMlbId,
  mlbHeadshotUrl,
  normalizeProPropSport,
} from "../lib/proPlayerProps.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
    },
  });
}

function safeJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function str(value) {
  if (value == null) return null;
  const out = String(value).trim();
  return out || null;
}

function num(value) {
  if (value == null || value === "") return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function playerKey(row) {
  return str(row.canonical_player_id) || str(row.provider_player_id) || null;
}

function metaKey(sourceObservationId, providerPlayerId) {
  return `${sourceObservationId || ""}|${providerPlayerId || ""}`;
}

function pickRawMarket(prop = {}) {
  return prop.marketCanonical || prop.canonicalMarket || prop.market || prop.marketType || prop.marketRaw || null;
}

function findMetadata(metaBySourcePlayer, row) {
  const exact = metaBySourcePlayer.get(metaKey(row.source_observation_id, row.provider_player_id));
  if (exact?.length) {
    const canonical = canonicalizeProPlayerPropMarket(row.sport, row.market_type);
    return (
      exact.find((p) => canonicalizeProPlayerPropMarket(row.sport, pickRawMarket(p)) === canonical) ||
      exact[0]
    );
  }
  return null;
}

async function loadMetadata(db, sourceIds = []) {
  const map = new Map();
  const ids = [...new Set(sourceIds.filter(Boolean).map(String))];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT id, research_fields_json
           FROM shadow_market_observations
          WHERE id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all();
    for (const row of result?.results || []) {
      const research = safeJson(row.research_fields_json) || {};
      const props = Array.isArray(research.playerProps) ? research.playerProps : [];
      for (const prop of props) {
        const pid = str(prop.providerPlayerId ?? prop.playerId);
        if (!pid) continue;
        const key = metaKey(row.id, pid);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(prop);
      }
    }
  }
  return map;
}

function buildRows(observations, metadata) {
  // Durable series can contain many snapshots. Keep the newest quote for each
  // event/player/market/book/selection, then pair over/under into one board row.
  const newestSide = new Map();
  for (const row of observations) {
    const sport = normalizeProPropSport(row.sport);
    if (!sport) continue;
    const player = playerKey(row);
    if (!player) continue;
    const canonical = canonicalizeProPlayerPropMarket(sport, row.market_type);
    if (!canonical) continue;
    const selection = String(row.selection || "").toLowerCase();
    if (selection !== "over" && selection !== "under") continue;
    const key = [row.canonical_event_id, player, canonical, row.sportsbook, selection].join("|");
    if (!newestSide.has(key)) newestSide.set(key, { ...row, sport, canonical });
  }

  const markets = new Map();
  for (const row of newestSide.values()) {
    const meta = findMetadata(metadata, row) || {};
    const player = playerKey(row);
    const key = [row.canonical_event_id, player, row.canonical, row.sportsbook].join("|");
    if (!markets.has(key)) {
      const mlbId = row.sport === "mlb" ? extractMlbId(meta) : null;
      const upstreamImage = str(meta.imageUrl || meta.headshotUrl || meta.photoUrl);
      markets.set(key, {
        provider: "ACTION_APIFY",
        providerGameId: str(row.provider_event_id),
        fbisEventId: str(row.canonical_event_id),
        providerPlayerId: str(row.provider_player_id),
        fbisPlayerId: str(row.canonical_player_id),
        playerName: str(meta.playerName || meta.name),
        team: str(meta.team || meta.teamAbbr || meta.team_abbr),
        position: str(meta.position),
        mlbId,
        imageUrl: upstreamImage || (mlbId ? mlbHeadshotUrl(mlbId) : null),
        imageSource: upstreamImage ? "ACTION_UPSTREAM" : mlbId ? "MLB_STATIC" : null,
        sport: row.sport,
        market: str(row.market_type),
        marketCanonical: row.canonical,
        period: str(row.market_period) || "event",
        book: str(row.sportsbook),
        side: null,
        line: num(row.line),
        price: null,
        overOdds: null,
        underOdds: null,
        sourceObservedAt: str(row.provider_timestamp),
        collectedAt: str(row.collected_at),
        gameIdentityConfidence: str(row.match_confidence) || "UNKNOWN",
        playerIdentityConfidence: row.canonical_player_id ? "EXACT" : row.provider_player_id ? "HIGH" : "UNMATCHED",
        marketComplete: false,
        decisionEligible: false,
        reasonCodes: ["ACTION_MARKET_INTELLIGENCE", "NOT_DECISION_ELIGIBLE"],
      });
    }
    const market = markets.get(key);
    if (market.line == null && row.line != null) market.line = num(row.line);
    const observedAt = Date.parse(row.provider_timestamp || row.collected_at || "") || 0;
    const existingAt = Date.parse(market.sourceObservedAt || market.collectedAt || "") || 0;
    if (observedAt > existingAt) {
      market.sourceObservedAt = str(row.provider_timestamp);
      market.collectedAt = str(row.collected_at);
    }
    if (String(row.selection).toLowerCase() === "over") market.overOdds = num(row.american_price);
    if (String(row.selection).toLowerCase() === "under") market.underOdds = num(row.american_price);
    market.marketComplete = Boolean(
      market.line != null && market.book && (market.overOdds != null || market.underOdds != null),
    );
  }

  return [...markets.values()].sort((a, b) => {
    const event = String(a.fbisEventId || "").localeCompare(String(b.fbisEventId || ""));
    if (event) return event;
    const player = String(a.playerName || a.providerPlayerId || "").localeCompare(
      String(b.playerName || b.providerPlayerId || ""),
    );
    if (player) return player;
    return String(a.marketCanonical || "").localeCompare(String(b.marketCanonical || ""));
  });
}

export async function onRequestGet(context) {
  if (!context.env?.DB) return json({ ok: false, error: "database unavailable", rows: [] }, 503);

  const url = new URL(context.request.url);
  const eventIds = [...new Set(
    String(url.searchParams.get("eventIds") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )].slice(0, 80);
  const sportParam = normalizeProPropSport(url.searchParams.get("sport"));

  if (!eventIds.length) {
    return json({
      ok: true,
      rows: [],
      sports: PRO_PLAYER_PROP_SPORTS,
      diagnostics: { checkedEvents: 0, durableObservations: 0, boardRows: 0 },
    });
  }

  const placeholders = eventIds.map(() => "?").join(",");
  const sportClause = sportParam ? " AND LOWER(sport) = ?" : "";
  const binds = sportParam ? [...eventIds, sportParam] : eventIds;

  try {
    const result = await context.env.DB
      .prepare(
        `SELECT id, canonical_event_id, canonical_player_id, provider_event_id, provider_player_id,
                sport, market_type, market_period, selection, line, american_price, sportsbook,
                provider_timestamp, collected_at, snapshot_type, match_confidence,
                source_observation_id
           FROM action_market_book_observations
          WHERE canonical_event_id IN (${placeholders})
            AND (canonical_player_id IS NOT NULL OR provider_player_id IS NOT NULL)
            AND LOWER(sport) IN ('mlb','nfl','nba','nhl')
            AND COALESCE(decision_eligible, 0) = 0
            AND COALESCE(can_qualify, 0) = 0
            AND COALESCE(can_authorize_wager, 0) = 0
            ${sportClause}
          ORDER BY COALESCE(provider_timestamp, collected_at) DESC, collected_at DESC
          LIMIT 4000`,
      )
      .bind(...binds)
      .all();

    const observations = result?.results || [];
    const metadata = await loadMetadata(
      context.env.DB,
      observations.map((row) => row.source_observation_id),
    );
    const rows = buildRows(observations, metadata);

    return json({
      ok: true,
      rows,
      sports: PRO_PLAYER_PROP_SPORTS,
      governance: {
        role: "market_intelligence",
        inProductionRouter: false,
        decisionEligible: false,
        canQualify: false,
        canAuthorizeWager: false,
      },
      diagnostics: {
        checkedEvents: eventIds.length,
        durableObservations: observations.length,
        boardRows: rows.length,
        metadataSources: new Set(observations.map((row) => row.source_observation_id).filter(Boolean)).size,
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: String(error?.message || error),
        rows: [],
        diagnostics: { checkedEvents: eventIds.length, durableObservations: 0, boardRows: 0 },
      },
      500,
    );
  }
}
