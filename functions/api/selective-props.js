import {chicagoDayBounds} from '../lib/chicagoDayBounds.js';
import { estimatedPropHitProbability, prizePicksTierEconomics, rankSelectiveProps, selectivePropStars, selectivePropRating } from "../lib/selectivePropEdge.js";

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
function isPlayerHeadshotUrl(url = "") {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return false;
  // PrizePicks often embeds team marks under /images/teams/; those are not headshots.
  if (/\/images\/teams\//i.test(u)) return false;
  if (/NFL_team_|team_logo|team-logo/i.test(u)) return false;
  return true;
}
function resolvedPlayerHeadshot(row = {}, raw = {}) {
  const candidates = [
    row.player_headshot_url,
    raw.player_image,
    raw.playerImage,
    raw.player_headshot_url,
    raw.headshot,
    raw.image_url,
  ];
  for (const c of candidates) {
    if (isPlayerHeadshotUrl(c)) return String(c).trim();
  }
  return null;
}
function normalizedRows(rows = []) {
  return latestByCandidate(rows).map((row) => {
    const raw = rawPayload(row);
    const headshot = resolvedPlayerHeadshot(row, raw);
    return ({
    ...row,
    player_headshot_url: headshot || row.player_headshot_url || null,
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

/**
 * NFL card board shows every projected PrizePicks line (Standard/Goblin/Demon),
 * matching other sports. 4★+ remains a ranking signal for Top 25 / badges, not
 * a hide-gate — otherwise unvalidated calibration (max 3★) empties the board.
 * 49ers role rows stay explicitly marked for the UI exception badge.
 */
function applyNflDisplayPolicy(rows = []) {
  return rankAllProjected(rows).map((row) => {
    if (String(row.sport || "").toLowerCase() !== "nfl") return row;
    const stars = Number(row.confidenceStars || 0);
    const fortyNiners = is49ersTargetRole(row);
    return {
      ...row,
      nflDisplayMode:
        stars >= 4 ? "QUALIFIED_EDGE"
          : fortyNiners ? "TEAM_PROJECTION"
            : "PRIZEPICKS_CARD",
      nflQualifiedEdge: stars >= 4,
      nfl49ersRoleProjection: fortyNiners,
    };
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
    "julianday(start_time)>=julianday(?) AND julianday(start_time)<julianday(?)",
    "fbis_projection IS NOT NULL",
    "line IS NOT NULL",
  ];
  const bounds=chicagoDayBounds(date);
  const bind = [bounds.start,bounds.end];
  if (sport && sport !== "all") { where.push("LOWER(sport)=?"); bind.push(sport); }

  const sql =
    "SELECT id,run_id,projection_id,fbis_event_id,sport,league,player_id,player_name,player_headshot_url," +
    " team,opponent,game_id,start_time,stat_type,canonical_market,line,odds_tier,duration," +
    " fbis_projection,fbis_sigma,delta_fbis_minus_line,candidate_side,role_confidence,snap_share,prop_gate,eligible_for_card,feature_evidence_json,model_source,model_version,observed_at,collected_at,raw_json" +
    " FROM prizepicks_prop_lines WHERE " + where.join(" AND ") +
    " ORDER BY collected_at DESC LIMIT 5000";

  const rows = (await context.env.DB.prepare(sql).bind(...bind).all())?.results || [];
  const candidates = normalizedRows(rows);
  const coverageRows = (await context.env.DB.prepare(
    "SELECT LOWER(sport) AS sport, COUNT(*) AS lines, SUM(fbis_projection IS NOT NULL) AS projected FROM prizepicks_prop_lines WHERE " + where.slice(0,2).join(" AND ") + " GROUP BY LOWER(sport)"
  ).bind(bounds.start,bounds.end).all())?.results || [];

  let selected;
  let policy;

  if (mode === "sport") {
    selected = sport === "nfl" ? applyNflDisplayPolicy(candidates) : rankAllProjected(candidates);
    policy = {
      view: sport === "nfl" ? "NFL_PRIZEPICKS_CARDS_ALL_PROJECTED" : "SPORT_ALL_PROJECTED",
      cap: null,
      minStars: 1,
      concentrationLimits: false,
      lineRole: "comparison-only",
      tiers: ["standard","goblin","demon"],
      note: sport === "nfl"
        ? "Every current NFL Standard, Goblin and Demon line with a valid FBIS projection is shown as a PrizePicks-style card (headshot, line, FBIS, last-5). 4★+ edges and 49ers role projections are badged, not used to hide cards."
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
      note: "Top 25 player/market groups are ranked by stars and edge. NFL cards remain visible below 4★ when they have a valid FBIS projection; unpriced Goblin/Demon variants cannot create a Top-25 group.",
    };
  }

  const output = selected.map((row) => ({
    ...row,
    confidence_stars: row.confidenceStars,
    ratingExplanation: selectivePropRating(row),
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
    coverage: { capturedSports: coverageRows.map(row => row.sport), bySport: coverageRows },
    freshness: {
      current: acquisition?.state === "COMPLETE",
      acquisition: acquisition || null,
      stale: acquisition?.state !== "COMPLETE",
    },
  });
}
