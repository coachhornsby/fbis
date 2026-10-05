/**
 * Player availability / injury context.
 *
 * Licensed feeds are normalized into player_availability_observations.
 * Two Deep is the preferred football source once licensed API credentials/docs
 * are installed. Until then this module consumes only persisted approved rows.
 *
 * Adjustments are deliberately bounded and auditable. They are context
 * corrections, not replacements for the underlying team model.
 */

import { queryAvailabilityObservations } from "./store.js";

export const AVAILABILITY_SPORTS = Object.freeze(["nfl","cfb","mlb","nba","wnba","nhl","cbb"]);

export const SPORT_AVAILABILITY_POLICY = Object.freeze({
  nfl: {
    primary: "NFL official injury report + persisted licensed availability",
    nativeChecks: ["official practice status","official game status","active/inactive","depth role"],
    numericalAdjustment: true,
    criticalRoles: ["QB"],
  },
  cfb: {
    primary: "Two Deep / persisted official or licensed availability",
    nativeChecks: ["availability","depth role","suspension"],
    numericalAdjustment: true,
    criticalRoles: ["QB"],
  },
  mlb: {
    primary: "Persisted availability + MLB probable starter/lineup context",
    nativeChecks: ["probable starter","official lineup","IL/inactive status"],
    numericalAdjustment: false,
    criticalRoles: ["SP"],
  },
  nhl: {
    primary: "Persisted availability + NHL expected/confirmed goalie context",
    nativeChecks: ["goalie status","scratches/injuries","lineup role"],
    numericalAdjustment: false,
    criticalRoles: ["G"],
  },
  nba: {
    primary: "Rights-cleared official injury/availability feed required",
    nativeChecks: ["official injury report","starter/rotation role"],
    numericalAdjustment: false,
    criticalRoles: ["STARTER"],
  },
  wnba: {
    primary: "Persisted approved WNBA availability observations",
    nativeChecks: ["availability","starter/rotation role","minutes restriction"],
    numericalAdjustment: false,
    criticalRoles: ["STARTER"],
  },
  cbb: {
    primary: "Persisted approved availability rows",
    nativeChecks: ["availability","starter role"],
    numericalAdjustment: false,
    criticalRoles: [],
  },
});

const STATUS_WEIGHT = Object.freeze({
  OUT: 1,
  IR: 1,
  PUP: 1,
  NFI: 1,
  SUSPENDED: 1,
  DOUBTFUL: 0.8,
  QUESTIONABLE: 0.35,
  DNP_PRACTICE: 0.28,
  LIMITED: 0.15,
  PROBABLE: 0.08,
  ACTIVE: 0,
  FULL: 0,
  AVAILABLE: 0,
});

const POSITION_POINTS = Object.freeze({
  QB: 2.25,
  LT: 0.38, RT: 0.34, LG: 0.28, RG: 0.28, C: 0.3, OL: 0.3,
  WR: 0.42, TE: 0.25, RB: 0.24, FB: 0.08,
  EDGE: 0.38, DE: 0.34, DT: 0.27, NT: 0.24, DL: 0.28,
  LB: 0.24, ILB: 0.24, OLB: 0.26,
  CB: 0.34, S: 0.26, DB: 0.28,
  K: 0.12, P: 0.06,
});

const DEFENSE_POSITIONS = new Set(["EDGE","DE","DT","NT","DL","LB","ILB","OLB","CB","S","DB"]);
const SPECIAL_POSITIONS = new Set(["K","P"]);

function finite(v){
  if(v==null || v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function round2(v){ return Math.round(Number(v)*100)/100; }
function clean(v){ return String(v||"").trim(); }
function cleanUpper(v){ return clean(v).toUpperCase().replace(/[._-]+/g," "); }

export function normalizeAvailabilityStatus(value){
  const raw=cleanUpper(value);
  if(!raw) return "UNKNOWN";
  if(/INJURED RESERVE|\bIR\b/.test(raw)) return "IR";
  if(/PHYSICALLY UNABLE|\bPUP\b/.test(raw)) return "PUP";
  if(/NON FOOTBALL INJURY|\bNFI\b/.test(raw)) return "NFI";
  if(/SUSPEND/.test(raw)) return "SUSPENDED";
  if(/\bOUT\b|INACTIVE|SEASON END|SEASON-ENDING/.test(raw)) return "OUT";
  if(/DOUBT/.test(raw)) return "DOUBTFUL";
  if(/QUESTION/.test(raw)) return "QUESTIONABLE";
  if(/DID NOT PARTICIPATE|DID NOT PRACTICE|\bDNP\b/.test(raw)) return "DNP_PRACTICE";
  if(/LIMIT/.test(raw)) return "LIMITED";
  if(/PROBAB/.test(raw)) return "PROBABLE";
  if(/FULL|ACTIVE|AVAILABLE|CLEARED/.test(raw)) return "ACTIVE";
  return raw.replace(/\s+/g,"_");
}

function availabilityId(parts=[]){
  return parts.map((v)=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")).filter(Boolean).join(":").slice(0,220);
}

export function normalizeAvailabilityRecord(raw={}, {source="manual", observedAt=null}={}){
  const sport=clean(raw.sport).toLowerCase();
  const teamKey=clean(raw.teamKey ?? raw.team_key ?? raw.teamAbbr ?? raw.team_abbr ?? raw.teamId ?? raw.team_id).toLowerCase();
  const playerName=clean(raw.playerName ?? raw.player_name ?? raw.name);
  const playerId=clean(raw.playerId ?? raw.player_id ?? raw.athleteId ?? raw.athlete_id) || null;
  const sourceUpdatedAt=clean(raw.sourceUpdatedAt ?? raw.source_updated_at ?? raw.updatedAt ?? raw.updated_at) || null;
  const seen=clean(observedAt ?? raw.observedAt ?? raw.observed_at) || new Date().toISOString();
  const status=normalizeAvailabilityStatus(raw.status ?? raw.availability ?? raw.designation ?? raw.injuryStatus ?? raw.injury_status);
  if(!sport || !teamKey || !playerName || !status) return null;
  const position=normalizePosition(raw.position ?? raw.pos ?? raw.positionAbbr ?? raw.position_abbr);
  const depthRank=finite(raw.depthRank ?? raw.depth_rank ?? raw.string ?? raw.rank);
  const id=clean(raw.id) || availabilityId([
    source,sport,teamKey,playerId||playerName,status,sourceUpdatedAt||seen,
  ]);
  return {
    id,
    source:clean(source||raw.source||"manual").toLowerCase(),
    sport,
    teamKey,
    teamName:clean(raw.teamName ?? raw.team_name) || null,
    playerId,
    playerName,
    position,
    positionGroup:normalizePosition(raw.positionGroup ?? raw.position_group ?? position),
    depthRank,
    status,
    practiceStatus:clean(raw.practiceStatus ?? raw.practice_status ?? raw.practice) || null,
    injuryDetail:clean(raw.injuryDetail ?? raw.injury_detail ?? raw.injury ?? raw.note) || null,
    gameId:clean(raw.gameId ?? raw.game_id) || null,
    opponentKey:clean(raw.opponentKey ?? raw.opponent_key ?? raw.opponent) || null,
    effectiveFrom:clean(raw.effectiveFrom ?? raw.effective_from) || null,
    sourceUpdatedAt,
    observedAt:seen,
    sourceUrl:clean(raw.sourceUrl ?? raw.source_url ?? raw.url) || null,
    rawJson:JSON.stringify(raw),
    createdAt:new Date().toISOString(),
  };
}

export function normalizePosition(value){
  const raw=cleanUpper(value).replace(/\s+/g,"");
  if(!raw) return "UNK";
  if(["LDE","RDE"].includes(raw)) return "DE";
  if(["LDT","RDT"].includes(raw)) return "DT";
  if(["FS","SS"].includes(raw)) return "S";
  if(["LCB","RCB","NB","NICKEL"].includes(raw)) return "CB";
  if(["MLB"].includes(raw)) return "ILB";
  if(["WLB","SLB"].includes(raw)) return "OLB";
  if(["T","OT"].includes(raw)) return "OL";
  if(["G","OG"].includes(raw)) return "OL";
  return raw;
}

export function availabilityTeamKeys(team={}){
  return [...new Set([
    team.canonicalId,
    team.espnId,
    team.abbr,
    team.school,
    team.fullName,
    team.name,
    team.location,
  ].map((v)=>clean(v).toLowerCase()).filter(Boolean))];
}

function depthFactor(rank){
  const n=finite(rank);
  if(n==null) return 0.55;
  if(n<=1) return 1;
  if(n===2) return 0.45;
  if(n===3) return 0.2;
  return 0.1;
}

function statusFactor(status){
  return STATUS_WEIGHT[normalizeAvailabilityStatus(status)] ?? 0.1;
}

function playerBasePoints(position, sport){
  const p=normalizePosition(position);
  const base=POSITION_POINTS[p] ?? 0.12;
  // CFB depth/injury information is noisier than NFL, so shrink impact modestly.
  return sport==="cfb" ? base*0.88 : base;
}

function latestPerPlayer(rows=[]){
  const byPlayer=new Map();
  for(const row of rows){
    const key=[
      clean(row.team_key).toLowerCase(),
      clean(row.player_id || row.player_name).toLowerCase(),
    ].join("|");
    if(!key || key==="|") continue;
    const cur=byPlayer.get(key);
    if(!cur || String(row.observed_at||"")>String(cur.observed_at||"")) byPlayer.set(key,row);
  }
  return [...byPlayer.values()];
}

function freshness(observedAt, nowMs=Date.now()){
  const ms=Date.parse(observedAt||"");
  if(!Number.isFinite(ms)) return {ageHours:null,stale:true};
  const ageHours=Math.max(0,(nowMs-ms)/3600000);
  return {ageHours:round2(ageHours),stale:ageHours>36};
}

function teamAvailabilityImpact(rows=[], {sport, nowMs=Date.now()}={}){
  const latest=latestPerPlayer(rows);
  let offensePenalty=0;
  let defensePenalty=0;
  let specialPenalty=0;
  let criticalUnresolved=false;
  const players=[];
  let freshest=null;

  for(const row of latest){
    const status=normalizeAvailabilityStatus(row.status);
    const weight=statusFactor(status);
    const position=normalizePosition(row.position_group || row.position);
    const rank=finite(row.depth_rank);
    const fr=freshness(row.source_updated_at || row.observed_at,nowMs);
    const persistentStatus=["IR","PUP","NFI","SUSPENDED"].includes(status);
    const effectiveWeight=fr.stale && !persistentStatus ? 0 : weight;
    const points=round2(playerBasePoints(position,sport)*depthFactor(rank)*effectiveWeight);
    if(freshest==null || (fr.ageHours!=null && fr.ageHours<freshest)) freshest=fr.ageHours;
    if(points>0){
      if(DEFENSE_POSITIONS.has(position)) defensePenalty+=points;
      else if(SPECIAL_POSITIONS.has(position)) specialPenalty+=points;
      else offensePenalty+=points;
    }
    if(position==="QB" && rank===1 && ["DOUBTFUL","QUESTIONABLE"].includes(status)){
      criticalUnresolved=true;
    }
    players.push({
      playerId:row.player_id||null,
      name:row.player_name,
      position,
      depthRank:rank,
      status,
      practiceStatus:row.practice_status||null,
      injury:row.injury_detail||null,
      impactPoints:points,
      observedAt:row.observed_at,
      source:row.source,
      sourceUrl:row.source_url||null,
      stale:fr.stale,
    });
  }

  return {
    offensePenalty:round2(clamp(offensePenalty,0,3.25)),
    defensePenalty:round2(clamp(defensePenalty,0,3.25)),
    specialPenalty:round2(clamp(specialPenalty,0,0.5)),
    criticalUnresolved,
    playerCount:players.length,
    impactedCount:players.filter((p)=>p.impactPoints>0).length,
    stale:players.length ? players.every((p)=>p.stale) : true,
    freshestAgeHours:freshest,
    players,
  };
}

export function buildGameAvailabilityImpact(game, rows=[], {sport, nowMs=Date.now()}={}){
  const homeKeys=new Set(availabilityTeamKeys(game.home));
  const awayKeys=new Set(availabilityTeamKeys(game.away));
  const homeRows=[];
  const awayRows=[];
  for(const row of rows){
    const key=clean(row.team_key).toLowerCase();
    const name=clean(row.team_name).toLowerCase();
    if(homeKeys.has(key) || (name && homeKeys.has(name))) homeRows.push(row);
    if(awayKeys.has(key) || (name && awayKeys.has(name))) awayRows.push(row);
  }
  const home=teamAvailabilityImpact(homeRows,{sport,nowMs});
  const away=teamAvailabilityImpact(awayRows,{sport,nowMs});
  const homeScoreAdjustment=round2(clamp(
    -home.offensePenalty-home.specialPenalty*0.5+away.defensePenalty,
    -3.5,3.5
  ));
  const awayScoreAdjustment=round2(clamp(
    -away.offensePenalty-away.specialPenalty*0.5+home.defensePenalty,
    -3.5,3.5
  ));
  const configured=rows.length>0;
  return {
    source:configured ? [...new Set(rows.map((r)=>r.source).filter(Boolean))].join("+") : null,
    configured,
    home,
    away,
    homeScoreAdjustment,
    awayScoreAdjustment,
    marginAdjustment:round2(homeScoreAdjustment-awayScoreAdjustment),
    totalAdjustment:round2(homeScoreAdjustment+awayScoreAdjustment),
    criticalUnresolved:home.criticalUnresolved || away.criticalUnresolved,
    stale:configured ? home.stale && away.stale : true,
    generatedAt:new Date(nowMs).toISOString(),
    methodology:"availability-impact-v1-bounded",
  };
}

export function applyAvailabilityAdjustment(game, sport){
  const impact=game?.availabilityImpact;
  if(game?.availabilityAdjustmentApplied) return game;
  if(!impact?.configured || !["nfl","cfb"].includes(String(sport).toLowerCase())) return game;
  const adjustPair=(home,away)=>{
    if(!Number.isFinite(Number(home)) || !Number.isFinite(Number(away))) return null;
    const h=round2(Number(home)+Number(impact.homeScoreAdjustment||0));
    const a=round2(Number(away)+Number(impact.awayScoreAdjustment||0));
    return {home:h,away:a,total:round2(h+a),margin:round2(h-a)};
  };
  const direct=adjustPair(game.projHomeScore,game.projAwayScore);
  const research=adjustPair(game.researchProjection?.home,game.researchProjection?.away);
  const next={...game};
  let applied=false;
  if(direct){
    next.projHomeScore=direct.home;
    next.projAwayScore=direct.away;
    next.availabilityAdjustedProjection=direct;
    if(game.model && game.model.projectionKind==="FBIS"){
      next.model={
        ...game.model,
        rawProjHome:game.model.projHome,
        rawProjAway:game.model.projAway,
        rawProjTotal:game.model.projTotal,
        rawProjMargin:game.model.projMargin,
        projHome:direct.home,
        projAway:direct.away,
        projTotal:direct.total,
        projMargin:direct.margin,
        availabilityImpact:impact,
      };
    }
    if(game.cfb){
      next.cfb={
        ...game.cfb,
        rawHome:game.cfb.home,
        rawAway:game.cfb.away,
        rawTotal:game.cfb.total,
        rawMargin:game.cfb.margin,
        home:direct.home,
        away:direct.away,
        total:direct.total,
        margin:direct.margin,
        availabilityImpact:impact,
        flags:[...new Set([...(game.cfb.flags||[]),"availability_adjusted"])],
      };
    }
    if(game.cfbFbisV2?.ok){
      next.cfbFbisV2={
        ...game.cfbFbisV2,
        rawHome:game.cfbFbisV2.home,
        rawAway:game.cfbFbisV2.away,
        rawTotal:game.cfbFbisV2.total,
        rawMargin:game.cfbFbisV2.margin,
        home:direct.home,
        away:direct.away,
        total:direct.total,
        margin:direct.margin,
        availabilityImpact:impact,
      };
    }
    if(String(sport).toLowerCase()==="nfl" && game.nflProShadow?.ok){
      const nfl=adjustPair(game.nflProShadow.home,game.nflProShadow.away);
      if(nfl){
        next.nflProShadow={
          ...game.nflProShadow,
          rawHome:game.nflProShadow.home,
          rawAway:game.nflProShadow.away,
          rawTotal:game.nflProShadow.total,
          rawMargin:game.nflProShadow.margin,
          home:nfl.home,
          away:nfl.away,
          total:nfl.total,
          margin:nfl.margin,
          availabilityImpact:impact,
          availabilityAdjusted:true,
        };
        if(next.challengers?.["NFL-PRO-v1"]){
          next.challengers={
            ...next.challengers,
            "NFL-PRO-v1":next.nflProShadow,
          };
        }
      }
    }
    applied=true;
  }
  if(research){
    next.researchProjection={
      ...game.researchProjection,
      rawHome:game.researchProjection.home,
      rawAway:game.researchProjection.away,
      home:research.home,
      away:research.away,
      total:research.total,
      margin:research.margin,
      availabilityAdjusted:true,
      availabilityImpact:impact,
    };
    if(game.model?.projectionKind==="FBIS"){
      next.model={
        ...next.model,
        rawProjHome:game.model.projHome,
        rawProjAway:game.model.projAway,
        rawProjTotal:game.model.projTotal,
        rawProjMargin:game.model.projMargin,
        projHome:research.home,
        projAway:research.away,
        projTotal:research.total,
        projMargin:research.margin,
        availabilityImpact:impact,
      };
    }
    next.projHomeScore=research.home;
    next.projAwayScore=research.away;
    next.availabilityAdjustedProjection=research;
    applied=true;
  }
  if(applied) next.availabilityAdjustmentApplied=true;
  return next;
}

export async function attachAvailability(games=[], sport, env={}){
  const id=String(sport||"").toLowerCase();
  if(!AVAILABILITY_SPORTS.includes(id) || !env?.DB?.prepare){
    return {
      games:(games||[]).map((game)=>({...game,availabilityImpact:buildGameAvailabilityImpact(game,[],{sport:id})})),
      meta:{source:null,configured:false,rows:0,reason:"availability-store-unbound"},
    };
  }
  const teamKeys=[...new Set((games||[]).flatMap((g)=>[
    ...availabilityTeamKeys(g.home),
    ...availabilityTeamKeys(g.away),
  ]))];
  const since=new Date(Date.now()-30*24*3600000).toISOString();
  const queried=await queryAvailabilityObservations(env,{sport:id,since,teamKeys,limit:3000});
  const rows=queried.ok ? queried.rows : [];
  const next=(games||[]).map((game)=>{
    const availabilityImpact=buildGameAvailabilityImpact(game,rows,{sport:id});
    return applyAvailabilityAdjustment({...game,availabilityImpact},id);
  });
  return {
    games:next,
    meta:{
      source:rows.length ? [...new Set(rows.map((r)=>r.source).filter(Boolean))].join("+") : null,
      configured:rows.length>0,
      rows:rows.length,
      error:queried.ok?null:queried.reason,
      note:id==="nfl"
        ? "NFL official injury reports are primary public availability evidence; licensed observations may augment depth/role context. All rows are normalized before model use."
        : "Two Deep is preferred for CFB once licensed API access is installed; persisted official/licensed observations are normalized before model use.",
    },
  };
}


export function buildSportAvailabilityPreflight(game = {}, sport = "") {
  const id = String(sport || game?.sport || "").toLowerCase();
  const policy = SPORT_AVAILABILITY_POLICY[id] || null;
  const impact = game?.availabilityImpact || null;
  const flags = new Set(game?.quality?.flags || []);
  const allPlayers = [
    ...(impact?.home?.players || []),
    ...(impact?.away?.players || []),
  ];
  const blocking = allPlayers.filter((p) =>
    ["OUT","IR","PUP","NFI","SUSPENDED"].includes(normalizeAvailabilityStatus(p.status))
  );
  const unresolved = allPlayers.filter((p) =>
    ["DOUBTFUL","QUESTIONABLE","DNP_PRACTICE","LIMITED"].includes(normalizeAvailabilityStatus(p.status))
  );

  let state = "CLEAR";
  const reasons = [];

  if (!impact?.configured) {
    state = "UNVERIFIED";
    reasons.push("availability_feed_unconfigured_or_empty");
  } else if (impact?.stale) {
    state = "STALE";
    reasons.push("availability_data_stale");
  }
  if (impact?.criticalUnresolved) {
    state = "HOLD";
    reasons.push("critical_availability_unresolved");
  }

  if (id === "mlb") {
    const homeSpMissing = flags.has("missing_home_sp") || !game?.homeSp?.id;
    const awaySpMissing = flags.has("missing_away_sp") || !game?.awaySp?.id;
    if (homeSpMissing || awaySpMissing) {
      state = "HOLD";
      reasons.push("probable_starter_unresolved");
    }
    const lineupsOfficial = game?.bpp?.lineupsOfficial === true;
    if (!lineupsOfficial) reasons.push("official_lineup_not_confirmed");
  }

  if (id === "nhl") {
    const homeGoalie = game?.nhlV1?.layers?.goalie?.home || null;
    const awayGoalie = game?.nhlV1?.layers?.goalie?.away || null;
    const unresolvedGoalie = [homeGoalie, awayGoalie].some((g) =>
      !g?.goalieId || String(g?.status || "").includes("PRIOR") || String(g?.status || "") === "UNKNOWN"
    );
    if (unresolvedGoalie) {
      if (state === "CLEAR") state = "HOLD";
      reasons.push("starting_goalie_not_confirmed");
    }
  }

  if (id === "nba" && !impact?.configured) {
    state = "BLOCKED";
    reasons.push("rights_cleared_injury_feed_required");
  }

  return {
    sport: id,
    state,
    policy,
    configured: Boolean(impact?.configured),
    stale: Boolean(impact?.stale),
    blockingCount: blocking.length,
    unresolvedCount: unresolved.length,
    blockingPlayers: blocking,
    unresolvedPlayers: unresolved,
    reasons: [...new Set(reasons)],
    numericalAdjustmentApplied: Boolean(game?.availabilityAdjustmentApplied),
    generatedAt: new Date().toISOString(),
  };
}
