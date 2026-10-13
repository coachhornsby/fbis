import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";

/**
 * Read-only queue peek for drain preflight. Does not lease work.
 * Empty queue → workflow exits green without spawning six workers.
 * Count aligns with claim eligibility: PENDING or expired LEASED, attempts<6,
 * and not blocked by another active same-league lease.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function pendingEligibleCount(db, nowIso) {
  const row = await db
    .prepare(`
    SELECT COUNT(*) AS n
    FROM soccer_pitchapi_backfill_queue q
    WHERE (q.status='PENDING' OR (q.status='LEASED' AND (q.lease_until IS NULL OR q.lease_until<?)))
      AND q.attempts<6
      AND NOT EXISTS (
        SELECT 1 FROM soccer_pitchapi_backfill_queue active
        WHERE active.heritage_key=q.heritage_key
          AND active.id<>q.id
          AND active.status='LEASED'
          AND active.lease_until IS NOT NULL
          AND active.lease_until>=?
      )
  `)
    .bind(nowIso, nowIso)
    .first();
  return Math.max(0, Number(row?.n) || 0);
}

export async function onRequestGet(context) {
  const auth = authorizeSoccerWorker(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(auth.reason), 401);
  const db = context.env?.DB;
  if (!db?.prepare) return json({ ok: false, error: "d1-unbound" }, 503);
  const nowIso = new Date().toISOString();
  const pendingEligible = await pendingEligibleCount(db, nowIso);
  return json({
    ok: true,
    empty: pendingEligible === 0,
    pendingEligible,
    signalClass: pendingEligible === 0 ? "EXPECTED_EMPTY_QUEUE" : "QUEUE_HAS_WORK",
  });
}

export async function onRequestPost(context) {
  return onRequestGet(context);
}
