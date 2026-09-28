import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { runSnapshotLearning, LEARNING_SPORTS } from "../lib/snapshotLearning.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function envFrom(context) {
  return {
    DB: context.env.DB,
    caches: caches.default,
  };
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);

  const url = new URL(context.request.url);
  const sport = String(url.searchParams.get("sport") || "").toLowerCase();
  const recentN = url.searchParams.get("recentN")
    ? Number(url.searchParams.get("recentN"))
    : 50;

  if (!sport) {
    return json({
      ok: false,
      error: "sport-required",
      supportedSports: [...LEARNING_SPORTS],
    }, 400);
  }

  try {
    const payload = await runSnapshotLearning(envFrom(context), {
      sport,
      recentN,
    });
    if (!payload.ok && payload.error === "unsupported-sport") return json(payload, 400);
    if (!payload.ok && payload.status === "failed") return json(payload, 503);
    return json(payload, 200);
  } catch (err) {
    return json({
      ok: false,
      status: "failed",
      sport,
      error: String(err?.message || err),
    }, 502);
  }
}
