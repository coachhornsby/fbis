import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { cbbdGet } from "../lib/collegeApi.js";
import { collegeKeyHealth, assertNoSecretLeak, redactSecrets } from "../lib/collegeSecrets.js";

function envFrom(context) {
  return {
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    caches: caches.default,
    DB: context.env.DB,
  };
}

function pub(res) {
  return {
    ok: Boolean(res?.ok),
    status: Number(res?.status || 0),
    reason: res?.reason || null,
    n: Number(res?.n || 0),
    data: res?.ok ? res.data : [],
  };
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) {
    return new Response(JSON.stringify(unauthorizedBody(auth.reason)), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const url = new URL(context.request.url);
  const season = Number(url.searchParams.get("season") || 2027);
  const priorSeason = Number(url.searchParams.get("priorSeason") || (season - 1));
  if (!Number.isFinite(season) || !Number.isFinite(priorSeason)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid-season" }), { status: 400 });
  }

  const env = envFrom(context);
  const [rosters, teams, games, stats] = await Promise.all([
    cbbdGet("/teams/roster", env, { query: { season }, skipCache: true }),
    cbbdGet("/teams", env, { query: { season }, skipCache: true }),
    cbbdGet("/games", env, { query: { season }, skipCache: true }),
    cbbdGet("/stats/player/season", env, { query: { season: priorSeason, seasonType: "regular" }, skipCache: true }),
  ]);

  const payload = redactSecrets({
    ok: [rosters, teams, games, stats].every((x) => x?.ok),
    source: "CBBD_RUNTIME_BOUNDED_PHASE_B",
    season,
    priorSeason,
    capturedAt: new Date().toISOString(),
    keyHealth: collegeKeyHealth(context.env),
    endpoints: {
      rosters: pub(rosters),
      teams: pub(teams),
      games: pub(games),
      playerStats: pub(stats),
    },
    governance: {
      researchOnly: true,
      overlay: "FBIS-STATE-OVERLAY-v1",
      canInfluenceProjection: false,
      canQualify: false,
      canAuthorizeWager: false,
    },
  });
  assertNoSecretLeak(payload, env);

  const status = payload.ok ? 200 : 502;
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
