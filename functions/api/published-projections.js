import { authorizeOperatorWrite, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate, shiftDateCT, todayCT } from "../lib/slateEngine.js";
import { productProjectionCard } from "../lib/productProjection.js";
import { insertPublishedProjection, listPublishedProjections, sha256Hex } from "../lib/publishedProjectionStore.js";

const SPORTS = new Set(["mlb", "cfb", "cbb", "nfl"]);

function json(data, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}

function dateFromGameId(gameId) {
  const m = String(gameId || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function findGameOnSlate(sport, gameId, preferredDate, env, window) {
  const tried = [];
  const candidates = [];
  const push = (d) => {
    if (d && !candidates.includes(d)) candidates.push(d);
  };
  push(preferredDate || null);
  push(dateFromGameId(gameId));
  const today = todayCT();
  push(today);
  for (let i = 1; i <= Math.max(1, window.maxFuture || 1); i += 1) push(shiftDateCT(today, i));
  for (let i = 1; i <= Math.max(1, window.maxPast || 2); i += 1) push(shiftDateCT(today, -i));

  for (const date of candidates.filter(Boolean)) {
    const resolved = resolveSlateDate(date, window);
    if (!resolved.ok) continue;
    tried.push(resolved.date);
    const slate = await buildSlate(sport, resolved.date, env);
    const game = (slate.games || []).find((g) => String(g.id) === String(gameId));
    if (game) return { game, slate, date: resolved.date, tried };
  }
  return { game: null, slate: null, date: preferredDate || today, tried };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const sport = String(url.searchParams.get("sport") || "").toLowerCase() || null;
    if (sport && !SPORTS.has(sport)) return json({ ok: false, error: "unsupported-sport" }, 400);
    const date = url.searchParams.get("date") || null;
    const rows = await listPublishedProjections(context.env, {
      sport,
      date,
      limit: url.searchParams.get("limit") || 100,
    });
    return json({ ok: true, count: rows.length, rows }, 200, "public, max-age=60, stale-while-revalidate=300");
  } catch (err) {
    return json({ ok: false, error: "published-projections-unavailable", detail: String(err?.message || err) }, 502);
  }
}

export async function onRequestPost(context) {
  const auth = authorizeOperatorWrite(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400);
  }

  const sport = String(body.sport || "").toLowerCase();
  const gameId = String(body.gameId || body.game_id || "");
  if (!SPORTS.has(sport) || !gameId) return json({ ok: false, error: "sport-and-gameId-required" }, 400);
  const rawDate = String(body.date || "");
  const window = sport === "cfb" || sport === "cbb" ? { maxPast: 7, maxFuture: 14 } : { maxPast: 2, maxFuture: 2 };
  const resolved = resolveSlateDate(rawDate, window);
  if (rawDate && !resolved.ok) return json({ ok: false, error: resolved.error }, 400);

  const env = {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    DB: context.env.DB,
    caches: caches.default,
  };

  try {
    const found = await findGameOnSlate(sport, gameId, rawDate ? resolved.date : null, env, window);
    const game = found.game;
    if (!game) {
      return json({ ok: false, error: "game-not-found", triedDates: found.tried }, 404);
    }
    if (game.status?.live || game.status?.completed || (game.start && Date.parse(game.start) <= Date.now())) {
      return json({ ok: false, error: "publication-must-freeze-before-start" }, 409);
    }
    const card = productProjectionCard(game, sport, { tier: "public" });
    if (!card.projection?.independent) {
      return json({ ok: false, error: "independent-fbis-projection-required" }, 409);
    }
    const { buildXGameCopy, publicationEligibilityForGame } = await import("../lib/xPublication.js");
    const eligibility = publicationEligibilityForGame(game);
    if (!eligibility.eligible) return json({ ok: false, error: eligibility.reason || "not-publishable" }, 409);
    const xCopy = buildXGameCopy(game, sport);
    const payload = {
      ...card,
      publicationStatus: eligibility.status,
      research: eligibility.status === "RESEARCH_PUBLISHABLE",
      canQualify: false,
      canAuthorizeWager: false,
      xCopy: xCopy.text,
      projectionCard: xCopy.card,
      marketSnapshot: {
        book: game.odds?.book || game.pin?.book || "pinnacle",
        homeSpread: game.odds?.pinSpread ?? game.odds?.spread ?? game.pin?.spread?.line ?? null,
        spreadPrice: game.odds?.pinSpreadHomePrice ?? game.pin?.spread?.priceA ?? null,
        total: game.odds?.pinTotal ?? game.odds?.total ?? game.pin?.total?.line ?? null,
        totalPrice: game.odds?.pinOverPrice ?? game.pin?.total?.priceA ?? null,
        moneyline: {
          home: game.odds?.pinHomeMl ?? null,
          away: game.odds?.pinAwayMl ?? null,
        },
        observedAt: game.odds?.observedAt || game.odds?.asOf || null,
        sourceTimestamp: game.odds?.sourceTimestamp || null,
        freshness: game.odds?.freshness || null,
      },
      frozenProjectionRef: {
        gameId: game.id,
        modelId: game.researchProjection?.modelId || game.projectionEngine || null,
        modelVersion: game.researchProjection?.modelVersion || game.modelVersion || null,
        projAway: game.model?.projAway ?? game.projAway ?? game.projAwayScore ?? null,
        projHome: game.model?.projHome ?? game.projHome ?? game.projHomeScore ?? null,
        frozenAt: game.researchProjection?.generatedAt || null,
      },
    };
    const payloadJson = JSON.stringify(payload);
    const payloadHash = await sha256Hex(payloadJson);
    const publishedAt = new Date().toISOString();
    const saved = await insertPublishedProjection(context.env, {
      sport,
      gameId,
      gameDate: found.date,
      startTime: game.start || null,
      modelVersion:
        card.modelVersion ||
        found.slate?.modelVersion ||
        game.researchProjection?.modelVersion ||
        null,
      payloadHash,
      payloadJson,
      publishedAt,
      publishedBy: "operator",
    });
    if (saved.conflict) {
      return json({ ok: false, error: saved.reason, existingHash: saved.existing?.payload_hash || null }, 409);
    }
    return json(
      {
        ok: true,
        inserted: saved.inserted,
        publicationId: saved.id || null,
        payloadHash,
        publishedAt,
        publicationStatus: eligibility.status,
        projection: payload,
        xCopy: xCopy.text,
      },
      saved.inserted ? 201 : 200
    );
  } catch (err) {
    return json({ ok: false, error: "projection-publication-failed", detail: String(err?.message || err) }, 502);
  }
}
