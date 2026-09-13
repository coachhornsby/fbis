import { authorizeOperatorWrite, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { productProjectionCard } from "../lib/productProjection.js";
import { insertPublishedProjection, listPublishedProjections, sha256Hex } from "../lib/publishedProjectionStore.js";

const SPORTS = new Set(["mlb", "cfb", "cbb", "nfl"]);

function json(data, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const sport = String(url.searchParams.get("sport") || "").toLowerCase() || null;
    if (sport && !SPORTS.has(sport)) return json({ ok: false, error: "unsupported-sport" }, 400);
    const date = url.searchParams.get("date") || null;
    const rows = await listPublishedProjections(context.env, { sport, date, limit: url.searchParams.get("limit") || 100 });
    return json({ ok: true, count: rows.length, rows }, 200, "public, max-age=60, stale-while-revalidate=300");
  } catch (err) {
    return json({ ok: false, error: "published-projections-unavailable", detail: String(err?.message || err) }, 502);
  }
}

export async function onRequestPost(context) {
  const auth = authorizeOperatorWrite(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 403);
  let body = {};
  try { body = await context.request.json(); } catch { return json({ ok: false, error: "invalid-json" }, 400); }

  const sport = String(body.sport || "").toLowerCase();
  const gameId = String(body.gameId || "");
  if (!SPORTS.has(sport) || !gameId) return json({ ok: false, error: "sport-and-gameId-required" }, 400);
  const rawDate = String(body.date || "");
  const window = sport === "cfb" || sport === "cbb" ? { maxPast: 7, maxFuture: 14 } : { maxPast: 2, maxFuture: 1 };
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
    const slate = await buildSlate(sport, resolved.date, env);
    const game = (slate.games || []).find((g) => String(g.id) === gameId);
    if (!game) return json({ ok: false, error: "game-not-found" }, 404);
    if (game.status?.live || game.status?.completed || (game.start && Date.parse(game.start) <= Date.now())) {
      return json({ ok: false, error: "publication-must-freeze-before-start" }, 409);
    }
    const card = productProjectionCard(game, sport, { tier: "public" });
    if (!card.projection?.independent) return json({ ok: false, error: "independent-fbis-projection-required" }, 409);
    const { buildXGameCopy, publicationEligibilityForGame } = await import("../lib/xPublication.js");
    const eligibility = publicationEligibilityForGame(game);
    if (!eligibility.eligible) return json({ ok: false, error: eligibility.reason || "not-publishable" }, 409);
    const xCopy = buildXGameCopy(game, sport);
    const payload = {
      ...card,
      publicationStatus: eligibility.status,
      research: eligibility.status === "RESEARCH_PUBLISHABLE",
      canQualify: false,
      xCopy: xCopy.text,
      projectionCard: xCopy.card,
    };
    const payloadJson = JSON.stringify(payload);
    const payloadHash = await sha256Hex(payloadJson);
    const publishedAt = new Date().toISOString();
    const saved = await insertPublishedProjection(context.env, {
      sport,
      gameId,
      gameDate: resolved.date,
      startTime: game.start || null,
      modelVersion: card.modelVersion || slate.modelVersion || game.researchProjection?.modelVersion || null,
      payloadHash,
      payloadJson,
      publishedAt,
      publishedBy: "operator",
    });
    if (saved.conflict) return json({ ok: false, error: saved.reason, existingHash: saved.existing?.payload_hash || null }, 409);
    return json({
      ok: true,
      inserted: saved.inserted,
      payloadHash,
      publishedAt,
      publicationStatus: eligibility.status,
      projection: payload,
      xCopy: xCopy.text,
    }, saved.inserted ? 201 : 200);
  } catch (err) {
    return json({ ok: false, error: "projection-publication-failed", detail: String(err?.message || err) }, 502);
  }
}
