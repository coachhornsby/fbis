/**
 * Pro player projection research layer.
 *
 * Ensures every MLB/NFL/NBA/NHL game projection carries an explicit
 * player-prop projection state. Sportsbook lines are never used as projection inputs.
 */

import { buildSportAvailabilityPreflight, normalizeAvailabilityStatus } from "./availability.js";
import { nhlPlayerProV2RowsForSide, NHL_PLAYER_PRO_V2_ID, NHL_PLAYER_PRO_V2_VERSION } from "./nhlPlayerProV2.js";

export const PRO_PLAYER_PROJECTION_VERSION = "research-v2-tracking-usage-gated";

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
    const g = game?.nhlProV2?.layers?.goalie?.[goalieSide] || game?.nhlV1?.layers?.goalie?.[goalieSide] || null;
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

export function attachKboPlayerProjectionResearch(games = []) {
  return (games || []).map((game) => {
    const rows = [];
    for (const side of ["home","away"]) {
      const p = game.kboV1?.pitcherKs?.[side];
      const st = game.kboV1?.starters?.[side];
      if (!p || finite(p.projection) == null || !st?.name) continue;
      const row = statRow({
        sport:"kbo", game,
        team: teamAbbr(game[side]),
        player:{ id:st.playerId || null, name:st.name, position:"P" },
        market:"strikeouts", projection:p.projection,
        source:p.source || "KBO_OFFICIAL_K9_X_EXPECTED_IP_X_OPPONENT_K_RATE",
        notes:"KBO-FBIS-v1.1 official-data starter K projection; research-only."
      });
      if (row) {
        row.propGate = game.kboV1?.starterState === "OFFICIAL_KBO_STARTERS_RESOLVED" ? row.propGate : "HOLD";
        row.gateReason = game.kboV1?.starterState === "OFFICIAL_KBO_STARTERS_RESOLVED" ? row.gateReason : "official_kbo_starter_unresolved";
        row.eligibleForCard = row.propGate === "CLEAR";
        rows.push(row);
      }
    }
    return {
      ...game,
      playerProjectionRows: rows,
      playerProjectionStatus:{
        sport:"kbo",
        state:rows.some(r=>r.eligibleForCard)?"ACTIVE_RESEARCH":rows.length?"HOLD_STARTER_CONFIRMATION":"PROBABLE_STARTER_UNRESOLVED",
        model:"KBO-PLAYER-PROJ-v1",version:PRO_PLAYER_PROJECTION_VERSION,
        independent:true,marketInformed:false,canQualify:false
      }
    };
  });
}

export function attachNpbPlayerProjectionResearch(games = []) {
  return (games || []).map((game) => {
    const rows = [];
    for (const side of ["home","away"]) {
      const p = game.npbV1?.pitcherKs?.[side];
      const st = game.npbV1?.starters?.[side];
      if (!p || finite(p.projection) == null) continue;
      rows.push(statRow({
        sport:"npb", game,
        team: teamAbbr(game[side]),
        player:{ id:st?.playerId || null, name:st?.name || null, position:"P" },
        market:"strikeouts", projection:p.projection,
        source:p.source || "NPB_OFFICIAL_PITCHER_K_RATE_X_WORKLOAD_X_OPPONENT_K_RATE",
        notes:"NPB-FBIS-v1 official-data starter K projection; research-only."
      }));
    }
    return {
      ...game,
      playerProjectionRows:rows.filter(Boolean),
      playerProjectionStatus:{
        sport:"npb",state:rows.length?"ACTIVE_RESEARCH":"PROBABLE_STARTER_UNRESOLVED",
        model:"NPB-PLAYER-PROJ-v1",version:PRO_PLAYER_PROJECTION_VERSION,
        independent:true,marketInformed:false,canQualify:false
      }
    };
  });
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
    const snapShare = finite(p.snapShare);
    const roleConfidence = snapShare == null
      ? (Number(p.games || 0) > 0 ? clamp((Number(p.games || 0) + 2) / 8, 0.45, 0.82) : 0.65)
      : clamp((snapShare - 0.25) / 0.65, 0.2, 1);
    const environmentFactor = position === "QB"
      ? clamp(0.96 + (factor - 1) * 0.45, 0.84, 1.12)
      : position === "RB"
        ? clamp(1 + (factor - 1) * 0.35, 0.82, 1.16)
        : clamp(1 + (factor - 1) * 0.55, 0.82, 1.18);
    const snapVolumeFactor = snapShare == null
      ? 1
      : position === "QB"
        ? clamp(0.96 + (snapShare - 0.90) * 0.20, 0.92, 1.03)
        : clamp(0.82 + snapShare * 0.28, 0.82, 1.10);
    const volumeFactor = environmentFactor * snapVolumeFactor;
    const ngs = p.ngs || {};
    const passingEff = clamp(
      1 +
        (finite(ngs.cpoe) == null ? 0 : Number(ngs.cpoe) * 0.006) +
        (finite(ngs.avgTimeToThrow) == null ? 0 : (2.75 - Number(ngs.avgTimeToThrow)) * 0.025),
      0.92, 1.08
    );
    const rushEff = clamp(
      1 + (finite(ngs.ryoePerAtt) == null ? 0 : Number(ngs.ryoePerAtt) * 0.045),
      0.90, 1.11
    );
    const recEff = clamp(
      1 +
        (finite(ngs.avgSeparation) == null ? 0 : (Number(ngs.avgSeparation) - 2.9) * 0.035) +
        (finite(ngs.yacOverExpected) == null ? 0 : Number(ngs.yacOverExpected) * 0.025),
      0.90, 1.12
    );
    const map = [
      ["passing_yards", p.passing_yards, p.sd?.passing_yards, passingEff],
      ["passing_attempts", p.attempts, p.sd?.attempts, 1],
      ["completions", p.completions, p.sd?.completions, clamp(passingEff, 0.95, 1.05)],
      ["passing_touchdowns", p.passing_tds, p.sd?.passing_tds, clamp(passingEff, 0.94, 1.08)],
      ["interceptions", p.interceptions, p.sd?.interceptions, 1],
      ["rushing_yards", p.rushing_yards, p.sd?.rushing_yards, rushEff],
      ["rushing_attempts", p.carries, p.sd?.carries, 1],
      ["receiving_yards", p.receiving_yards, p.sd?.receiving_yards, recEff],
      ["receptions", p.receptions, p.sd?.receptions, clamp(recEff, 0.95, 1.05)],
      ["touchdowns", p.total_tds, p.sd?.total_tds, 1],
    ];
    for (const [market, base, rawSigma, efficiencyFactor] of map) {
      if (finite(base) == null) continue;
      const projection = Number(base) * volumeFactor * Number(efficiencyFactor || 1);
      if (projection <= 0.05) continue;
      const sigmaBase = finite(rawSigma);
      const sigma = sigmaBase == null ? null : sigmaBase * (1 + (1 - roleConfidence) * 0.35);
      const row = statRow({
        sport: "nfl",
        game,
        team,
        player: p,
        market,
        projection,
        sigma,
        source: "NFLVERSE_WEEKLY_PLUS_NGS_SNAP_V2",
        notes: "Pregame player baseline adjusted by FBIS team environment, snap-role reliability, and capped Next Gen efficiency. No PrizePicks or sportsbook line is a projection input.",
      });
      if (!row) continue;
      row.roleConfidence = round1(roleConfidence);
      row.snapShare = snapShare == null ? null : round1(snapShare);
      row.environmentFactor = round1(environmentFactor);
      row.snapVolumeFactor = round1(snapVolumeFactor);
      row.featureEvidence = {
        nextGen: Boolean(p.ngs && Object.values(p.ngs).some((v)=>finite(v)!=null)),
        snapShare: snapShare != null,
        trackingGames: Number(p.trackingGames || 0),
        snapGames: Number(p.snapGames || 0),
      };
      if (roleConfidence < 0.45 && row.propGate === "CLEAR") {
        row.propGate = "HOLD";
        row.gateReason = "low_role_confidence";
        row.eligibleForCard = false;
      }
      out.push(row);
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
        model: "NFL-PLAYER-PROJ-v2",
        version: PRO_PLAYER_PROJECTION_VERSION,
        independent: true,
        marketInformed: false,
        canQualify: false,
      },
    };
  });
}

function nhlRowsForSide(game, side, ctx = {}) {
  return nhlPlayerProV2RowsForSide(game, side, ctx).map((p)=>{
    const row=statRow({
      sport:"nhl",
      game,
      team:p.team,
      player:p.player,
      market:p.market,
      projection:p.projection,
      sigma:p.sigma,
      source:p.source,
      notes:p.notes,
    });
    if(!row)return null;
    const validationStatus=p.validationStatus||"PENDING_VALIDATION";
    const modelValidated=validationStatus==="PROMOTE_RESEARCH";
    return {
      ...row,
      validationStatus,
      validatedLines:p.validatedLines||{},
      shotEnvironment:p.shotEnvironment||null,
      modelValidated,
      propGate:modelValidated?row.propGate:"HOLD",
      gateReason:modelValidated?row.gateReason:"market_not_validated_vs_baseline",
      eligibleForCard:modelValidated&&row.propGate==="CLEAR",
    };
  }).filter(Boolean);
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
        model: NHL_PLAYER_PRO_V2_ID,
        version: NHL_PLAYER_PRO_V2_VERSION,
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
