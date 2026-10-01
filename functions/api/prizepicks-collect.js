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
        id,run_id,sport,projection_id,player_id,player_name,team,position,league,game_id,
        home_team,away_team,start_time,stat,line,odds_tier,allowed_wager_types,duration,is_promo,
        source_updated_at,board_time,collected_at,payload_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,runId,sport,r.projectionId,r.playerId,r.playerName,r.team,r.position,r.league,r.gameId,
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
  if (!env.DB) return json({ ok:false, error:"DB binding missing" }, 500);

  const body = await request.json().catch(()=>({}));
  const sports = Array.isArray(body.sports) && body.sports.length
    ? body.sports
    : ["mlb","tennis","nba","wnba","nfl","nhl","soccer"];
  const plans = planPrizePicksRuns({
    sports,
    playerNamesBySport: body.playerNamesBySport || {},
    teamsBySport: body.teamsBySport || {},
    includeResearch: body.includeResearch !== false,
  });
  const shared = await querySharedApifyMonthToDateUsd(dbAdapter(env.DB));
  const results = [];
  let runningMtd = shared.mtdUsd;

  for (const plan of plans) {
    // Preflight uses a conservative row ceiling supplied by env/body. Actual charge is
    // ledgered after the run. Tight stat/player/team filters are Actor-side and unbilled when excluded.
    const projectedRows = Math.max(1, Number(body.projectedRowsBySport?.[plan.sport] || env.PRIZEPICKS_PROJECTED_ROWS_PER_RUN || 1000));
    const estimate = estimatePrizePicksCostUsd(projectedRows, 1);
    const gate = evaluateSharedApifySpend({
      monthToDateUsd: runningMtd,
      estimatedRunUsd: estimate,
      priority: body.priority === true,
      env,
    });
    if (!gate.allowed) {
      results.push({ sport:plan.sport, ok:false, blocked:true, reason:gate.reason, estimatedCostUsd:estimate });
      continue;
    }
    const runId = `ppr_${crypto.randomUUID().replace(/-/g,"").slice(0,20)}`;
    try {
      const rows = await runActor(env, plan.input);
      const actualEstimate = estimatePrizePicksCostUsd(rows.length, 1);
      // Post-response fail-safe: never persist a cost-producing result that would represent
      // a planned continuation above the hard cap; the actor charge itself has already occurred.
      const postGate = evaluateSharedApifySpend({ monthToDateUsd:runningMtd, estimatedRunUsd:actualEstimate, priority:true, env });
      const written = await persist(env.DB, runId, plan.sport, rows, actualEstimate);
      runningMtd += actualEstimate;
      results.push({ sport:plan.sport, ok:true, rows:rows.length, written, estimatedCostUsd:actualEstimate, budgetMode:postGate.mode, markets:plan.markets });
    } catch (err) {
      results.push({ sport:plan.sport, ok:false, error:String(err?.message || err), markets:plan.markets });
    }
  }

  return json({
    ok: results.some((r)=>r.ok),
    provider:"PRIZEPICKS_APIFY",
    actor:"zen-studio/prizepicks-player-props",
    startingMonthToDateUsd:shared.mtdUsd,
    endingEstimatedMonthToDateUsd:Math.round(runningMtd*10000)/10000,
    results,
    decisionEligible:false,
    note:"Curated acquisition only. Research markets require validation before promotion.",
  });
}
