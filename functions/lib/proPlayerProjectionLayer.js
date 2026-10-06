/**
 * Pro player projection research layer.
 *
 * Ensures every MLB/NFL/NBA/NHL game projection carries an explicit
 * player-prop projection state. Sportsbook lines are never used as projection inputs.
 */

import { buildSportAvailabilityPreflight, normalizeAvailabilityStatus } from "./availability.js";
import { nhlPlayerProV2RowsForSide, NHL_PLAYER_PRO_V2_ID, NHL_PLAYER_PRO_V2_VERSION } from "./nhlPlayerProV2.js";
import { buildMlbPersistentPlayerPropRows, MLB_PLAYER_PROP_MODEL_VERSION } from "./mlbPlayerPropModel.js";

export const PRO_PLAYER_PROJECTION_VERSION = "research-v3.1-calibrated-last5-role-defense";

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
  if (["DOUBTFUL","QUESTIONABLE","DNP_PRACTICE","LIMITED"].includes(status)) {
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

export function attachMlbPlayerProjectionResearch(games = [], persistent = {}) {
  return (games || []).map((game) => {
    const rows = [];
    const ks = game.mlbDeepShadow?.pitcherKs || null;
    for (const side of ["home", "away"]) {
      const p = ks?.[side];
      if (!p || finite(p.projection) == null) continue;
      const kRow=statRow({
        sport: "mlb",
        game,
        team: p.team || teamAbbr(game[side]),
        player: { id: p.playerId, name: p.playerName, position: "P" },
        market: "strikeouts",
        projection: p.projection,
        sigma: p.sigma ?? null,
        source: p.source || "MLB_STATS_STARTER_K_RATE_X_WORKLOAD_X_OPPONENT_K_RATE_FALLBACK",
        notes: String(p.source || "").startsWith("STATCAST_PITCH_SHAPE_X_HITTER_ZONE_X_WORKLOAD")
          ? "Primary MLB K projection uses Statcast pitcher arsenal/shape versus hitter contact zones, expected batters faced and workload. Ballpark Pal starter K remains external comparison."
          : "Fallback MLB K projection uses season K/9, workload and opponent team K rate. Ballpark Pal starter K remains external comparison.",
      });
      if(kRow){
        rows.push({
          ...kRow,
          modelVersion:game?.mlbDeepShadow?.version || game?.mlbDeepShadow?.modelVersion || "research-v2.5-postseason-context",
          sourceObservedAt:state?.asOf || null,
          stateAsOf:state?.asOf || null,
        });
      }
    }
    const state=persistent?.byGameId?.[String(game.id||game.bpp?.gamePk||"")]||null;
    const extra=buildMlbPersistentPlayerPropRows(game,state).map((p)=>{
      const row=statRow({
        sport:"mlb",game,team:p.team,
        player:{id:p.playerId,name:p.playerName,position:p.position},
        market:p.market,projection:p.projection,sigma:p.sigma,source:p.source,
        notes:"Persistent MLB player-prop model. Independent of market lines; research-only until historical validation."
      });
      if(!row)return null;
      const hitterLineupHold=String(p.position||"").toUpperCase()!=="P" && p.lineupState==="ROSTER_FALLBACK";
      return {
        ...row,...p,
        modelVersion:p.modelVersion || MLB_PLAYER_PROP_MODEL_VERSION,
        sourceObservedAt:p.stateAsOf || state?.asOf || null,
        stateAsOf:p.stateAsOf || state?.asOf || null,
        propGate:hitterLineupHold?"HOLD":row.propGate,
        gateReason:hitterLineupHold?"lineup_not_expected_or_confirmed":(row.gateReason||"research_unvalidated"),
        eligibleForCard:false,
        modelAuthorized:false,
        decisionEligible:false,
        canQualify:false,
        canAuthorizeWager:false
      };
    }).filter(Boolean);
    const allRows=[...rows.filter(Boolean),...extra];
    return {
      ...game,
      playerProjectionRows: allRows,
      playerProjectionStatus: {
        sport: "mlb",
        state: allRows.some((r)=>r?.eligibleForCard) ? "ACTIVE_RESEARCH" : allRows.length ? "HOLD_AVAILABILITY" : "NO_ELIGIBLE_PLAYER_PROJECTION",
        model: "MLB-FBIS-v2.5-POSTSEASON-CONTEXT",
        propModel: MLB_PLAYER_PROP_MODEL_VERSION,
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

function nflMatchupFactors(game, side) {
  const oppSide = side === "home" ? "away" : "home";
  const defense = game.nflFeatures?.[oppSide] || {};
  const passAllowed = finite(defense.passEpaAllowed);
  const rushAllowed = finite(defense.rushEpaAllowed);
  const pressure = finite(defense.pressureRate);
  return {
    pass: clamp(1 + (passAllowed == null ? 0 : passAllowed * 0.22) - (pressure == null ? 0 : (pressure - 0.30) * 0.12), 0.88, 1.12),
    rush: clamp(1 + (rushAllowed == null ? 0 : rushAllowed * 0.24), 0.88, 1.12),
    pressure: pressure == null ? null : pressure,
    passEpaAllowed: passAllowed,
    rushEpaAllowed: rushAllowed,
  };
}

function recentUsageScore(p = {}) {
  const position=String(p.position||"").toUpperCase();
  const r=p.recent5||{};
  const snap=finite(p.snapShare)||0;
  if(position==="QB") return (finite(r.attempts)??finite(p.attempts)??0) + snap*45;
  if(position==="RB") return (finite(r.carries)??finite(p.carries)??0) + (finite(r.targets)??finite(p.targets)??0)*0.8 + snap*15;
  return (finite(r.targets)??finite(p.targets)??0)*2 + (finite(r.receptions)??finite(p.receptions)??0) + snap*12;
}

function nflTargetRoles(players = []) {
  const groups={QB:[],RB:[],WR:[],TE:[]};
  for(const p of players){
    const pos=String(p.position||"").toUpperCase();
    if(groups[pos])groups[pos].push(p);
  }
  for(const arr of Object.values(groups))arr.sort((a,b)=>recentUsageScore(b)-recentUsageScore(a));
  const role=new Map();
  if(groups.QB[0])role.set(groups.QB[0].id||groups.QB[0].name,"QB1");
  if(groups.RB[0])role.set(groups.RB[0].id||groups.RB[0].name,"RB1");
  if(groups.WR[0])role.set(groups.WR[0].id||groups.WR[0].name,"WR1");
  if(groups.WR[1])role.set(groups.WR[1].id||groups.WR[1].name,"WR2");
  if(groups.TE[0])role.set(groups.TE[0].id||groups.TE[0].name,"TE1");
  return role;
}

function marketDefenseField(market){
  const map={
    passing_yards:"passing_yards",passing_attempts:"attempts",completions:"completions",passing_touchdowns:"passing_tds",interceptions:"interceptions",
    rushing_yards:"rushing_yards",rushing_attempts:"carries",
    receiving_yards:"receiving_yards",receptions:"receptions",touchdowns:"total_tds"
  };
  return map[market]||null;
}
function marketStatField(market){
  const map={
    passing_yards:"passing_yards",passing_attempts:"attempts",completions:"completions",passing_touchdowns:"passing_tds",interceptions:"interceptions",
    rushing_yards:"rushing_yards",rushing_attempts:"carries",
    receiving_yards:"receiving_yards",receptions:"receptions",touchdowns:"total_tds"
  };
  return map[market]||null;
}
function calibratedPlayerBase(p,market){
  const field=marketStatField(market);
  if(!field)return finite(p?.[market]);
  const recent=finite(p?.recent5?.[field]);
  const season=finite(p?.seasonAvg?.[field]);
  const prior=finite(p?.priorAvg?.[field]);
  const w=market==="passing_attempts"
    ? {recent:0.70,season:0.15,prior:0.15}
    : {recent:0.65,season:0.20,prior:0.15};
  let n=0,d=0;
  for(const [v,weight] of [[recent,w.recent],[season,w.season],[prior,w.prior]]){
    if(v==null||weight<=0)continue;n+=v*weight;d+=weight;
  }
  return {value:d>0?n/d:finite(p?.[field]),weights:w,field};
}

function positionalDefenseStrength(position,market){
  const pos=String(position||"").toUpperCase();
  if(pos==="QB"){
    if(market==="passing_yards"||market==="passing_attempts")return 0.65;
    if(market==="completions")return 0.45;
    if(market==="rushing_attempts")return 0.25;
    return 0;
  }
  if(pos==="RB"){
    if(market==="receiving_yards")return 0.65;
    if(market==="receptions")return 0.25;
    return 0;
  }
  if(pos==="TE"){
    if(market==="receptions")return 0.25;
    return 0;
  }
  // WR receiving production and all remaining rushing markets were more accurate
  // without a position-allowance multiplier in the 2025-2026 walk-forward.
  return 0;
}

function positionalDefenseFactor(game,side,position,market,playerFeed={}){
  const oppSide=side==="home"?"away":"home";
  const defense=game.nflFeatures?.[oppSide]?.positionDefense?.[position]||{};
  const league=playerFeed.leaguePositionDefense?.[position]||{};
  const field=marketDefenseField(market);
  const strength=positionalDefenseStrength(position,market);
  if(!field)return{factor:1,available:false,allowed:null,league:null,strength};
  const allowed=finite(defense[field]),avg=finite(league[field]);
  if(allowed==null||avg==null||avg<=0)return{factor:1,available:false,allowed,league:avg,strength};
  const ratio=allowed/avg;
  return{factor:clamp(1+(ratio-1)*strength,0.86,1.14),available:true,allowed,league:avg,strength};
}

function nflRowsForSide(game, side, playerFeed = {}) {
  const team = teamAbbr(game[side]);
  const players = playerFeed.byTeam?.[team] || [];
  const targetRoles=nflTargetRoles(players);
  const factor = nflEnvironmentFactor(game, side);
  const matchup = nflMatchupFactors(game, side);
  const out = [];
  for (const p of players) {
    const position = String(p.position || "").toUpperCase();
    const targetRole=targetRoles.get(p.id||p.name)||null;
    if(!targetRole) continue;
    const snapShare = finite(p.snapShare);
    const roleFloor=position==="QB"?0.72:position==="RB"?0.38:position==="TE"?0.45:0.50;
    const snapRole = snapShare == null ? 0.55 : clamp((snapShare-roleFloor)/(1-roleFloor),0,1);
    const recentGames=Number(p.recent5?.games||p.recentGames?.length||0);
    const roleConfidence=clamp(0.50 + snapRole*0.35 + Math.min(recentGames,5)/5*0.15,0,1);
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
    const passingEff = clamp(1 +(finite(ngs.cpoe)==null?0:Number(ngs.cpoe)*0.006)+(finite(ngs.avgTimeToThrow)==null?0:(2.75-Number(ngs.avgTimeToThrow))*0.025),0.92,1.08);
    const rushEff = clamp(1 + (finite(ngs.ryoePerAtt) == null ? 0 : Number(ngs.ryoePerAtt) * 0.045),0.90,1.11);
    const recEff = clamp(1 +(finite(ngs.avgSeparation)==null?0:(Number(ngs.avgSeparation)-2.9)*0.035)+(finite(ngs.yacOverExpected)==null?0:Number(ngs.yacOverExpected)*0.025),0.90,1.12);
    const map = [
      ["passing_yards", p.passing_yards, p.sd?.passing_yards, passingEff * matchup.pass],
      ["passing_attempts", p.attempts, p.sd?.attempts, clamp(0.96 + matchup.pass * 0.04, 0.96, 1.04)],
      ["completions", p.completions, p.sd?.completions, clamp(passingEff * matchup.pass, 0.90, 1.10)],
      ["passing_touchdowns", p.passing_tds, p.sd?.passing_tds, clamp(passingEff * matchup.pass, 0.88, 1.12)],
      ["interceptions", p.interceptions, p.sd?.interceptions, clamp(2 - matchup.pass, 0.90, 1.10)],
      ["rushing_yards", p.rushing_yards, p.sd?.rushing_yards, rushEff * matchup.rush],
      ["rushing_attempts", p.carries, p.sd?.carries, clamp(0.96 + matchup.rush * 0.04, 0.96, 1.04)],
      ["receiving_yards", p.receiving_yards, p.sd?.receiving_yards, recEff * matchup.pass],
      ["receptions", p.receptions, p.sd?.receptions, clamp(recEff * matchup.pass, 0.90, 1.10)],
      ["touchdowns", p.total_tds, p.sd?.total_tds, position === "RB" ? matchup.rush : matchup.pass],
    ];
    for (const [market, base, rawSigma, efficiencyFactor] of map) {
      const calibrated=calibratedPlayerBase(p,market);
      const baseValue=finite(calibrated?.value ?? base);
      if (baseValue == null) continue;
      const positionDefense=positionalDefenseFactor(game,side,position,market,playerFeed);
      const projection = Number(baseValue) * volumeFactor * Number(efficiencyFactor || 1) * positionDefense.factor;
      if (projection <= 0.05) continue;
      const sigmaBase = finite(rawSigma);
      const sigma = sigmaBase == null ? null : sigmaBase * (1 + (1 - roleConfidence) * 0.30);
      const row = statRow({
        sport:"nfl",game,team,player:p,market,projection,sigma,
        source:"NFLVERSE_LAST5_65_FLOOR_MARKET_CALIBRATED_NGS_DEFENSE_V3_2",
        notes:"Target-role NFL projection: validated 65% last-five floor with 20% current-season and 15% prior-season stabilization; QB passing attempts use validated 70/15/15. Adjusted by snap role, Next Gen efficiency, team environment, market-calibrated opponent allowance, and pass/rush EPA. Market lines are excluded from projection inputs.",
      });
      if (!row) continue;
      row.targetRole=targetRole;
      row.roleConfidence=round1(roleConfidence);
      row.snapShare=snapShare==null?null:round1(snapShare);
      row.recent5=p.recent5||null;
      row.formBlend=calibrated?.weights||p.formBlend||null;
      row.recent5Games=recentGames;
      row.seasonAverage=p.seasonAvg||null;
      row.priorAverage=p.priorAvg||null;
      row.environmentFactor=round1(environmentFactor);
      row.snapVolumeFactor=round1(snapVolumeFactor);
      row.matchupFactor=round1(positionDefense.factor * (market.startsWith("rushing")?matchup.rush:market==="touchdowns"&&position==="RB"?matchup.rush:matchup.pass));
      row.opponentMatchup={
        passEpaAllowed:matchup.passEpaAllowed,rushEpaAllowed:matchup.rushEpaAllowed,pressureRate:matchup.pressure,
        position,market,allowed:positionDefense.allowed,leagueAllowed:positionDefense.league,positionDefenseFactor:round1(positionDefense.factor),positionDefenseStrength:positionDefense.strength,
      };
      row.featureEvidence={
        nextGen:Boolean(p.ngs&&Object.values(p.ngs).some(v=>finite(v)!=null)),
        snapShare:snapShare!=null,
        opponentMatchup:matchup.passEpaAllowed!=null||matchup.rushEpaAllowed!=null||matchup.pressure!=null,
        positionDefense:positionDefense.available,
        recent5:recentGames>=3,
        targetRole:true,
        targetRoleName:targetRole,
        trackingGames:Number(p.trackingGames||0),
        snapGames:Number(p.snapGames||0),
      };
      const roleConflict=snapShare!=null&&snapShare<roleFloor;
      if((roleConflict||roleConfidence<0.60||recentGames<2) && row.propGate==="CLEAR"){
        row.propGate="HOLD";
        row.gateReason=roleConflict?"starter_role_conflict":recentGames<2?"insufficient_recent_usage":"low_role_confidence";
        row.eligibleForCard=false;
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
        model: "NFL-PLAYER-PROJ-v3.1",
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
