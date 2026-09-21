import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) return json(unauthorizedBody(), 401);
  const db = context?.env?.DB;
  if (!db?.prepare) return json({ ok: false, error: "d1_unavailable" }, 503);

  const url = new URL(context.request.url);
  const day = String(url.searchParams.get("date") || "").trim();
  const sport = String(url.searchParams.get("sport") || "all").toLowerCase();
  const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") || 2000)));

  const where = ["r.provider = 'ACTION_APIFY'", "r.profile = 'DAILY'", "r.lifecycle = 'daily'"];
  const binds = [];
  if (day) {
    where.push("substr(r.started_at,1,10)=?");
    binds.push(day);
  }
  if (sport !== "all") {
    where.push("lower(o.sport)=?");
    binds.push(sport);
  }

  const run = await db.prepare(
    `SELECT id, status, apify_run_id, dataset_id, started_at, finished_at,
            games_returned, games_matched, games_unmatched, observations_written,
            malformed_rows, estimated_cost_usd, actual_cost_usd
     FROM shadow_collection_runs r
     WHERE ${where.filter((x) => !x.includes("o.sport")).join(" AND ")}
     ORDER BY r.started_at DESC
     LIMIT 1`
  ).bind(...binds.slice(0, day ? 1 : 0)).first();

  if (!run?.id) return json({ ok: true, run: null, count: 0, rows: [] });

  const obsWhere = ["o.run_id = ?"];
  const obsBinds = [run.id];
  if (sport !== "all") {
    obsWhere.push("lower(o.sport)=?");
    obsBinds.push(sport);
  }

  const res = await db.prepare(
    `SELECT o.*
     FROM shadow_market_observations o
     WHERE ${obsWhere.join(" AND ")}
     ORDER BY COALESCE(o.collected_at, o.created_at) DESC
     LIMIT ?`
  ).bind(...obsBinds, limit).all();

  return json({
    ok: true,
    run: {
      id: run.id,
      status: run.status,
      apifyRunId: run.apify_run_id || null,
      datasetId: run.dataset_id || null,
      startedAt: run.started_at || null,
      finishedAt: run.finished_at || null,
      gamesReturned: Number(run.games_returned || 0),
      gamesMatched: Number(run.games_matched || 0),
      gamesUnmatched: Number(run.games_unmatched || 0),
      observationsWritten: Number(run.observations_written || 0),
      malformedRows: Number(run.malformed_rows || 0),
      estimatedCostUsd: run.estimated_cost_usd == null ? null : Number(run.estimated_cost_usd),
      actualCostUsd: run.actual_cost_usd == null ? null : Number(run.actual_cost_usd),
    },
    count: (res?.results || []).length,
    rows: res?.results || [],
  });
}
