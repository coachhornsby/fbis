import { estimatedPropHitProbability, prizePicksTierEconomics, rankSelectiveProps, selectivePropStars } from "../lib/selectivePropEdge.js";

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
function n(v) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function todayCt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
export function latestByCandidate(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [
      String(row.sport || "").toLowerCase(),
      String(row.player_name || "").toLowerCase(),
      String(row.canonical_market || row.stat_type || "").toLowerCase(),
      String(row.duration || "full").toLowerCase(),
      String(row.odds_tier || "standard").toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
function rawPayload(row = {}) {
  try { return row.raw_json ? JSON.parse(row.raw_json) : {}; }
  catch { return {}; }
}
function normalizedRows(rows = []) {
  return latestByCandidate(rows).map((row) => {
    const raw = rawPayload(row);
    return ({
    ...row,
    eventId: row.fbis_event_id || row.game_id,
    playerId: row.player_id,
    playerName: row.player_name,
    line: row.line,
    fbisProjection: row.fbis_projection,
    fbisSigma: row.fbis_sigma,
    roleConfidence: row.role_confidence,
    snapShare: row.snap_share,
    propGate: row.prop_gate,
    eligibleForCard: row.eligible_for_card == null ? undefined : Boolean(row.eligible_for_card),
    featureEvidence: row.feature_evidence_json ? JSON.parse(row.feature_evidence_json) : null,
    targetRole: (row.feature_evidence_json ? JSON.parse(row.feature_evidence_json) : null)?.targetRoleName || null,
    market: row.canonical_market || row.stat_type || null,
    statType: row.canonical_market || row.stat_type || null,
    modelSource: row.model_source,
    modelVersion: row.model_version,
    payoutBreakEvenProbability:
      raw.payout_break_even_probability ??
      raw.break_even_probability ??
      raw.payoutBreakEvenProbability ??
      raw.breakEvenProbability ??
      null,
    payoutCalibrationValidated:
      raw.payout_calibration_validated === true ||
      raw.payoutCalibrationValidated === true,
  });
  });
}

function is49ersTargetRole(row = {}) {
  if (String(row.sport || "").toLowerCase() !== "nfl") return false;
  const team = String(row.team || "").trim().toUpperCase();
  const role = String(row.targetRole || row.featureEvidence?.targetRoleName || "").trim().toUpperCase();
  return (team === "SF" || team === "SFO") && ["QB1","RB1","WR1","WR2","TE1"].includes(role);
}

function nflDisplayGroupKey(row = {}) {
  return [
    String(row.sport || "").toLowerCase(),
    String(row.playerName || row.player_name || "").toLowerCase(),
    String(row.market || row.canonical_market || row.statType || row.stat_type || "").toLowerCase(),
    String(row.duration || "full").toLowerCase(),
  ].join("|");
}

function applyNflDisplayPolicy(rows = []) {
  const ranked = rankAllProjected(rows);
  const groups = new Map();
  for (const row of ranked) {
    if (String(row.sport || "").toLowerCase() !== "nfl") continue;
    const key = nflDisplayGroupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const allowed = new Set();
  for (const [key, variants] of groups.entries()) {
    const standard = variants.find((r) => String(r.odds_tier || "standard").toLowerCase() === "standard");
    const primary = standard || variants[0];
    if (is49ersTargetRole(primary) || Number(primary?.confidenceStars || 0) >= 4) allowed.add(key);
  }
  return ranked.filter((row) => {
    if (String(row.sport || "").toLowerCase() !== "nfl") return true;
    return allowed.has(nflDisplayGroupKey(row));
  });
}

export function groupKey(row = {}) {
  return [
    String(row.sport || "").toLowerCase(),
    String(row.player_name || row.playerName || "").toLowerCase(),
    String(row.canonical_market || row.stat_type || row.market || "").toLowerCase(),
    String(row.duration || "full").toLowerCase(),
  ].join("|");
}
export function strongestByGroup(rows = []) {
  const map = new Map();
  for (const row of rows) {
    // Unpriced Demon/Goblin variants cannot represent a group in Top-25.
    if (row.prizePicksEconomics?.rankingEligible === false) continue;
    const key = groupKey(row);
    const prev = map.get(key);
    if (!prev) { map.set(key, row); continue; }
    const a = Number(row.selectionScore ?? -Infinity);
    const b = Number(prev.selectionScore ?? -Infinity);
    if (a > b) map.set(key, row);
  }
  return map;
}
function rankAllProjected(rows = []) {
  return rows.map((row) => {
    const projection = n(row.fbisProjection);
    const line = n(row.line);
    const sigma = n(row.fbisSigma);
    const stars = selectivePropStars(row);
    if (projection == null || line == null || stars == null) return null;
    const edge = projection - line;
    const standardizedEdge = sigma != null && sigma > 0 ? Math.abs(edge) / sigma : null;
    const relativeEdge = Math.abs(edge) / Math.max(Math.abs(line), 1);
    const estimatedHitProbability = estimatedPropHitProbability(row);
    const prizePicksEconomics = prizePicksTierEconomics(row, estimatedHitProbability);
    return {
      ...row,
      edge,
      candidateSide: edge > 0 ? "MORE" : edge < 0 ? "LESS" : null,
      confidenceStars: stars,
      standardizedEdge,
      relativeEdge,
      estimatedHitProbability,
      prizePicksEconomics,
      selectionScore:
        stars * 100 +
        (standardizedEdge ?? relativeEdge * 5) * 10,
    };
  }).filter(Boolean).sort((a, b) =>
    (b.confidenceStars - a.confidenceStars) ||
    ((b.standardizedEdge ?? b.relativeEdge ?? 0) - (a.standardizedEdge ?? a.relativeEdge ?? 0)) ||
    (b.selectionScore - a.selectionScore)
  );
}

export async function onRequestGet(context) {
  if (!context.env?.DB) return json({ ok: false, error: "database unavailable", rows: [] }, 503);
  const url = new URL(context.request.url);
  const date = s(url.searchParams.get("date")) || todayCt();
  const sport = s(url.searchParams.get("sport"))?.toLowerCase() || null;
  const mode = String(url.searchParams.get("mode") || (sport ? "sport" : "top25")).toLowerCase();

  const where = [
    "run_id IN (SELECT run_id FROM prizepicks_daily_acquisitions WHERE state='COMPLETE') AND julianday(collected_at) BETWEEN julianday('now','-24 hours') AND julianday('now')",
    "substr(start_time,1,10)=?",
    "fbis_projection IS NOT NULL",
    "line IS NOT NULL",
  ];
  const bind = [date];
  if (sport && sport !== "all") { where.push("LOWER(sport)=?"); bind.push(sport); }

  const sql =
    "SELECT id,run_id,projection_id,fbis_event_id,sport,league,player_id,player_name,player_headshot_url," +
    " team,opponent,game_id,start_time,stat_type,canonical_market,line,odds_tier,duration," +
    " fbis_projection,fbis_sigma,delta_fbis_minus_line,candidate_side,role_confidence,snap_share,prop_gate,eligible_for_card,feature_evidence_json,model_source,model_version,observed_at,collected_at,raw_json" +
    " FROM prizepicks_prop_lines WHERE " + where.join(" AND ") +
    " ORDER BY collected_at DESC LIMIT 5000";

  const rows = (await context.env.DB.prepare(sql).bind(...bind).all())?.results || [];
  const candidates = normalizedRows(rows);

  let selected;
  let policy;

  if (mode === "sport") {
    selected = sport === "nfl" ? applyNflDisplayPolicy(candidates) : rankAllProjected(candidates);
    policy = {
      view: sport === "nfl" ? "NFL_4STAR_PLUS_WITH_49ERS_EXCEPTION" : "SPORT_ALL_PROJECTED",
      cap: null,
      minStars: sport === "nfl" ? 4 : 1,
      concentrationLimits: false,
      lineRole: "comparison-only",
      tiers: ["standard","goblin","demon"],
      note: sport === "nfl"
        ? "NFL groups are listed only when the Standard line is 4-star or 5-star, except all 49ers QB1/RB1/WR1/WR2/TE1 projections remain visible. Alternate Goblin/Demon rows are returned only as variants for those visible groups."
        : "Every current Standard, Goblin and Demon line with a valid FBIS projection is shown for the selected sport, sorted by stars then edge strength.",
    };
  } else {
    const allRanked = applyNflDisplayPolicy(candidates);
    const strongest = [...strongestByGroup(allRanked).values()]
      .sort((a, b) =>
        (b.confidenceStars - a.confidenceStars) ||
        ((b.standardizedEdge ?? b.relativeEdge ?? 0) - (a.standardizedEdge ?? a.relativeEdge ?? 0)) ||
        (b.selectionScore - a.selectionScore)
      )
      .slice(0, 25);
    const selectedKeys = new Set(strongest.map(groupKey));
    selected = allRanked.filter((row) => selectedKeys.has(groupKey(row)));
    policy = {
      view: "TOP_25",
      cap: 25,
      minStars: 1,
      concentrationLimits: false,
      lineRole: "comparison-only",
      tiers: ["standard","goblin","demon"],
      note: "Top 25 player/market groups are ranked only by economically comparable tiers. Standard lines qualify normally; unpriced Goblin/Demon variants remain visible inside selected groups but cannot create or represent a Top-25 group.",
    };
  }

  const output = selected.map((row) => ({
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
    sport,
    mode,
    rows: output,
    count: output.length,
    policy,
    freshness: {
      current: acquisition?.state === "COMPLETE",
      acquisition: acquisition || null,
      stale: acquisition?.state !== "COMPLETE",
    },
  });
}
