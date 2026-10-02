import { planPrizePicksRuns, normalizePrizePicksProjection, estimatePrizePicksCostUsd } from "../lib/prizePicksApify.js";
import { querySharedApifyMonthToDateUsd, evaluateSharedApifySpend } from "../lib/sharedApifyBudget.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function authorized(request, env) {
  const expected = String(env.HARVEST_SECRET || "").trim();
  if (!expected) return false;
  return String(request.headers.get("x-harvest-secret") || "") === expected;
}
function dbAdapter(DB) {
  return {
    async queryOne(sql, params=[]) {
      return DB.prepare(sql).bind(...params).first();
    },
  };
}
async function runActor(env, input, fetchImpl = fetch) {
  const token = String(env.APIFY_TOKEN || "").trim();
  if (!token) throw new Error("APIFY_TOKEN missing");
  const actor = "zen-studio~prizepicks-player-props";
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?format=json&clean=true`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`PrizePicks Actor HTTP ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}
async function persist(DB, runId, sport, rows, estimatedCostUsd) {
  const now = new Date().toISOString();
  let written = 0;
  for (const raw of rows) {
    const r = normalizePrizePicksProjection(raw);
    const id = `ppo_${crypto.randomUUID().replace(/-/g,"").slice(0,24)}`;
    const out = await DB.prepare(
      `INSERT OR IGNORE INTO prizepicks_prop_observations (
        id,run_id,sport,projection_id,player_id,player_name,player_headshot_url,team,position,league,game_id,
        home_team,away_team,start_time,stat,line,odds_tier,allowed_wager_types,duration,is_promo,
        source_updated_at,board_time,collected_at,payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,runId,sport,r.projectionId,r.playerId,r.playerName,r.playerHeadshotUrl,r.team,r.position,r.league,r.gameId,
      r.homeTeam,r.awayTeam,r.startTime,r.stat,r.line,r.oddsTier,r.allowedWagerTypes,r.duration,
      r.isPromo?1:0,r.updatedAt,r.boardTime,now,JSON.stringify(raw)
    ).run();
    if ((out?.meta?.changes || 0) > 0) written++;
  }
  await DB.prepare(
    `INSERT INTO apify_sports_cost_ledger
      (id,provider,run_id,sport,cost_basis,estimated_total_usd,actual_total_usd,rows_returned,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    `cost_${crypto.randomUUID().replace(/-/g,"").slice(0,24)}`,"PRIZEPICKS_APIFY",runId,sport,
    "ESTIMATED",estimatedCostUsd,null,rows.length,now
  ).run();
  return written;
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ ok:false, error:"unauthorized" }, 401);
  return json({
    ok:false,
    blocked:true,
    error:"LEGACY_PRIZEPICKS_COLLECTOR_DISABLED",
    message:"Paid PrizePicks acquisition is centralized in the once-daily full-board workflow. Reuse the persisted daily snapshot."
  }, 410);
}
