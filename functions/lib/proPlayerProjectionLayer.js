/**
 * Pro player projection research layer.
 *
 * Ensures every MLB/NFL/NBA/NHL game projection carries an explicit
 * player-prop projection state. Sportsbook lines are never used as projection inputs.
 */

import { buildSportAvailabilityPreflight, normalizeAvailabilityStatus } from "./availability.js";

export const PRO_PLAYER_PROJECTION_VERSION = "research-v1.1-availability-gated";

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(Number(v) * 10) / 10; }
function teamAbbr(team = {}) { return String(team.abbr || team.shortName || team.name || "").toUpperCase(); }

function scoreForTeam(game, side) {
  const home = finite(game.researchProjection?.home ?? game.nhlV1?.home ?? game.mlbDeepShadow?.home ?? game.model?.projHome ?? game.projHomeScore);
  const away = finite(game.researchProjection?.away ?? game.nhlV1?.away ?? game.mlbDeepShadow?.away ?? game.model?.projAway ?? game.projAwayScore);
  return side === "home" ? home : away;
}

function normName(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function playerAvailabilityGate(game = {}, sport = "", player = {}, team = null) {
  const preflight = buildSportAvailabilityPreflight(game, sport);
  const players = [
    ...(game?.availabilityImpact?.home?.players || []),
    ...(game?.availabilityImpact?.away?.players || []),
  ];
  const pid = player?.id != null ? String(player.id) : null;
  const pname = normName(player?.name);
  const match = players.find((p) => {
    if (pid && p.playerId && String(p.playerId) === pid) return true;
    return pname && normName(p.name) === pname;
  }) || null;
  const status = normalizeAvailabilityStatus(match?.status || "UNKNOWN");

  if (["OUT","IR","PUP","NFI","SUSPENDED"].includes(status)) {
    return { state:"BLOCKED", reason:"player_unavailable", status, match, preflight };
  }
  if (["DOUBTFUL","QUESTIONABLE","LIMITED"].includes(status)) {
    return { state:"HOLD", reason:"player_status_unresolved", status, match, preflight };
  }
  if (sport === "nhl" && String(player?.position || "").toUpperCase() === "G") {
    const goalieSide = team && String(game?.home?.abbr || "").toUpperCase() === String(team).toUpperCase() ? "home" : "away";
    const g = game?.nhlV1?.layers?.goalie?.[goalieSide] || null;
    if (!g?.goalieId || String(g.status || "").includes("PRIOR") || String(g.status || "") === "UNKNOWN") {
      return { state:"HOLD", reason:"goalie_not_confirmed", status, match, preflight };
    }
  }
  if (sport === "mlb" && String(player?.position || "").toUpperCase() === "P") {
    if (preflight.reasons?.includes("probable_starter_unresolved")) {
      return { state:"HOLD", reason:"probable_starter_unresolved", status, match, preflight };
    }
  }
  return { state:"CLEAR", reason:null, status, match, preflight };
}

function statRow({ sport, game, team, player, market, projection, sigma = null, source, notes = null }) {
  const p = finite(projection);
  if (p == null) return null;
  const gate = playerAvailabilityGate(game, sport, player, team);
  return {
    sport,
    eventId: String(game.id || ""),
    team,
    playerId: player?.id != null ? String(player.id) : null,
    playerName: player?.name || null,
    position: player?.position || null,
    market,
    fbisProjection: round1(p),
    fbisSigma: finite(sigma) == null ? null : round1(sigma),
    source,
    maturity: "RESEARCH",
    independent: true,
    marketInformed: false,
    canQualify: false,
    canAuthorizeWager: false,
    availabilityStatus: gate.status,
    propGate: gate.state,
    gateReason: gate.reason,
    eligibleForCard: gate.state === "CLEAR",
    availabilityPreflight: gate.preflight,
    notes,
  };
}

export function attachMlbPlayerProjectionResearch(games = []) {
  return (games || []).map((game) => {
    const rows = [];
    const ks = game.mlbDeepShadow?.pitcherKs || null;
    for (const side of ["home", "away"]) {
      const p = ks?.[side];
      if (!p || finite(p.projection) == null) continue;
      rows.push(statRow({
        sport: "mlb",
        game,
        team: p.team || teamAbbr(game[side]),
        player: { id: p.playerId, name: p.playerName, position: "P" },
        market: "strikeouts",
        projection: p.projection,
        sigma: p.sigma ?? null,
        source: "MLB_STATS_STARTER_K_RATE_X_WORKLOAD_X_OPPONENT_K_RATE",
        notes: "Ballpark Pal starter K is retained separately as an external comparison.",
      }));
    }
    return {
      ...game,
      playerProjectionRows: rows.filter(Boolean),
      playerProjectionStatus: {
        sport: "mlb",
        state: rows.some((r)=>r?.eligibleForCard) ? "ACTIVE_RESEARCH" : rows.length ? "HOLD_AVAILABILITY" : "NO_ELIGIBLE_STARTER_PROJECTION",
        model: "MLB-FBIS-v2.1-PITCHER-K",
        version: PRO_PLAYER_PROJECTION_VERSION,
        independent: true,
        marketInformed: false,
        canQualify: false,
      },
    };
  });
}

function nflEnvironmentFactor(game, side) {
  const pts = scoreForTeam(game, side);
  return pts == null ? 1 : clamp(pts / 22.5, 0.78, 1.25);
}

function nflRowsForSide(game, side, playerFeed = {}) {
  const team = teamAbbr(game[side]);
  const players = playerFeed.byTeam?.[team] || [];
  const factor = nflEnvironmentFactor(game, side);
  const out = [];
  for (const p of players) {
    const position = String(p.position || "").toUpperCase();
    const volumeFactor = position === "QB"
      ? clamp(0.96 + (factor - 1) * 0.45, 0.84, 1.12)
      : position === "RB"
        ? clamp(1 + (factor - 1) * 0.35, 0.82, 1.16)
        : clamp(1 + (factor - 1) * 0.55, 0.82, 1.18);
    const map = [
      ["passing_yards", p.passing_yards, p.sd?.passing_yards],
      ["passing_attempts", p.attempts, p.sd?.attempts],
      ["completions", p.completions, p.sd?.completions],
      ["passing_touchdowns", p.passing_tds, p.sd?.passing_tds],
      ["interceptions", p.interceptions, p.sd?.interceptions],
      ["rushing_yards", p.rushing_yards, p.sd?.rushing_yards],
      ["rushing_attempts", p.carries, p.sd?.carries],
      ["receiving_yards", p.receiving_yards, p.sd?.receiving_yards],
      ["receptions", p.receptions, p.sd?.receptions],
      ["touchdowns", p.total_tds, p.sd?.total_tds],
    ];
    for (const [market, base, sd] of map) {
      if (finite(base) == null) continue;
      const projection = Number(base) * volumeFactor;
      if (projection <= 0.05) continue;
      out.push(statRow({
        sport: "nfl",
        game,
        team,
        player: p,
        market,
        projection,
        sigma: sd,
        source: "NFLVERSE_WEEKLY_PLAYER_PRIOR_CURRENT_BLEND",
        notes: "Player per-game baseline adjusted only by FBIS team scoring environment; no sportsbook line input.",
      }));
    }
  }
  return out.filter(Boolean);
}

export function attachNflPlayerProjectionResearch(games = [], playerFeed = {}) {
  return (games || []).map((game) => {
    const rows = [
      ...nflRowsForSide(game, "home", playerFeed),
      ...nflRowsForSide(game, "away", playerFeed),
    ];
    return {
      ...game,
      playerProjectionRows: rows,
      playerProjectionStatus: {
        sport: "nfl",
        state: rows.some((r)=>r?.eligibleForCard) ? "ACTIVE_RESEARCH" : rows.length ? "HOLD_AVAILABILITY" : "PLAYER_DATA_UNAVAILABLE",
        model: "NFL-PLAYER-PROJ-v1",
        version: PRO_PLAYER_PROJECTION_VERSION,
        independent: true,
        marketInformed: false,
        canQualify: false,
      },
    };
  });
}

function nhlRowsForSide(game, side, ctx = {}) {
  const team = teamAbbr(game[side]);
  const skaters = ctx.skatersByTeam?.[team] || [];
  const projectedGoals = scoreForTeam(game, side);
  const teamBase = finite(ctx.teams?.[team]?.gfpg);
  const scoringFactor = projectedGoals != null && teamBase != null && teamBase > 0
    ? clamp(projectedGoals / teamBase, 0.78, 1.25)
    : 1;
  const rows = [];
  for (const p of skaters.slice(0, 12)) {
    for (const [market, value] of [
      ["shots_on_goal", p.shotsPerGame],
      ["points", p.pointsPerGame],
      ["goals", p.goalsPerGame],
      ["assists", p.assistsPerGame],
    ]) {
      if (finite(value) == null) continue;
      rows.push(statRow({
        sport: "nhl",
        game,
        team,
        player: p,
        market,
        projection: Number(value) * scoringFactor,
        source: "NHL_STATS_SKATER_PRIOR_CURRENT_BLEND",
        notes: "Season/prior per-game rate adjusted by FBIS team-goal environment; no sportsbook line input.",
      }));
    }
  }

  const goalie = game.nhlV1?.layers?.goalie?.[side] || null;
  if (goalie?.goalieId) {
    const opponentSide = side === "home" ? "away" : "home";
    const opp = teamAbbr(game[opponentSide]);
    const oppShots = finite(ctx.teams?.[opp]?.shotsFor);
    const savePct = finite(goalie.savePct);
    if (oppShots != null && savePct != null) {
      rows.push(statRow({
        sport: "nhl",
        game,
        team,
        player: { id: goalie.goalieId, name: goalie.name, position: "G" },
        market: "saves",
        projection: oppShots * savePct,
        source: "NHL_STATS_EXPECTED_STARTER_X_OPPONENT_SHOTS",
        notes: "Expected starter only; goalie uncertainty remains a research flag.",
      }));
    }
  }
  return rows.filter(Boolean);
}

export function attachNhlPlayerProjectionResearch(games = [], ctx = {}) {
  return (games || []).map((game) => {
    const rows = [
      ...nhlRowsForSide(game, "home", ctx),
      ...nhlRowsForSide(game, "away", ctx),
    ];
    return {
      ...game,
      playerProjectionRows: rows,
      playerProjectionStatus: {
        sport: "nhl",
        state: rows.some((r)=>r?.eligibleForCard) ? "ACTIVE_RESEARCH" : rows.length ? "HOLD_AVAILABILITY" : "PLAYER_DATA_UNAVAILABLE",
        model: "NHL-PLAYER-PROJ-v1",
        version: PRO_PLAYER_PROJECTION_VERSION,
        independent: true,
        marketInformed: false,
        canQualify: false,
      },
    };
  });
}

export function attachNbaPlayerProjectionBlocked(games = []) {
  return (games || []).map((game) => ({
    ...game,
    playerProjectionRows: [],
    playerProjectionStatus: {
      sport: "nba",
      state: "BLOCKED_RIGHTS_CLEARED_PLAYER_FEED",
      model: "NBA-PLAYER-PROJ-v1",
      version: PRO_PLAYER_PROJECTION_VERSION,
      independent: true,
      marketInformed: false,
      canQualify: false,
      reason: "NBA production player-stat ingestion remains provider/license blocked. Market lines may display but are never substituted for a projection.",
    },
  }));
}
