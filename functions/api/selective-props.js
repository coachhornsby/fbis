import { rankSelectiveProps } from "../lib/selectivePropEdge.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
function s(v) { const x = String(v ?? "").trim(); return x || null; }
function todayCt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function latestByCandidate(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [
      String(row.sport || "").toLowerCase(),
      String(row.player_name || "").toLowerCase(),
      String(row.canonical_market || row.stat_type || "").toLowerCase(),
      String(row.duration || "full").toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function onRequestGet(context) {
  if (!context.env?.DB) return json({ ok: false, error: "database unavailable", rows: [] }, 503);
  const url = new URL(context.request.url);
  const date = s(url.searchParams.get("date")) || todayCt();
  const sport = s(url.searchParams.get("sport"))?.toLowerCase() || null;
  const maxRows = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 20)));
  const where = [
    "substr(start_time,1,10)=?",
    "fbis_projection IS NOT NULL",
    "line IS NOT NULL",
    "LOWER(COALESCE(odds_tier,'standard'))='standard'",
  ];
  const bind = [date];
  if (sport && sport !== "all") { where.push("LOWER(sport)=?"); bind.push(sport); }

  const sql =
    "SELECT id,run_id,projection_id,fbis_event_id,sport,league,player_id,player_name,player_headshot_url," +
    " team,opponent,game_id,start_time,stat_type,canonical_market,line,odds_tier,duration," +
    " fbis_projection,fbis_sigma,delta_fbis_minus_line,candidate_side,observed_at,collected_at" +
    " FROM prizepicks_prop_lines WHERE " + where.join(" AND ") +
    " ORDER BY collected_at DESC LIMIT 2000";

  const rows = (await context.env.DB.prepare(sql).bind(...bind).all())?.results || [];
  const candidates = latestByCandidate(rows).map((row) => ({
    ...row,
    eventId: row.fbis_event_id || row.game_id,
    playerId: row.player_id,
    playerName: row.player_name,
    line: row.line,
    fbisProjection: row.fbis_projection,
    fbisSigma: row.fbis_sigma,
  }));
  const ranked = rankSelectiveProps(candidates, {
    maxRows,
    minStars: 2,
    maxPerEvent: 3,
    maxPerPlayer: 2,
  });
  const selected = ranked.rows.map((row) => ({
    ...row,
    confidence_stars: row.confidenceStars,
    standardized_edge: row.standardizedEdge,
    selection_score: row.selectionScore,
    candidate_side: row.candidateSide,
  }));
  const acquisition = await context.env.DB.prepare(
    "SELECT state,started_at,completed_at,rows_returned FROM prizepicks_daily_acquisitions WHERE ct_date=?"
  ).bind(date).first();

  return json({
    ok: true,
    date,
    rows: selected,
    count: selected.length,
    counts: ranked.counts,
    policy: {
      ...ranked.policy,
      targetDailyRange: "10-20",
      note: "FBIS does not fill the board with weak props. Fewer than 10 may publish when the slate is thin.",
      lineRole: "comparison-only",
    },
    freshness: {
      current: acquisition?.state === "COMPLETE",
      acquisition: acquisition || null,
      stale: acquisition?.state !== "COMPLETE",
    },
  });
}
