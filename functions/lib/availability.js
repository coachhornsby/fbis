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

export const AVAILABILITY_SPORTS = Object.freeze(["nfl","cfb","mlb","nba","nhl","cbb"]);

const STATUS_WEIGHT = Object.freeze({
  OUT: 1,
  IR: 1,
  PUP: 1,
  NFI: 1,
  SUSPENDED: 1,
  DOUBTFUL: 0.8,
  QUESTIONABLE: 0.35,
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
  if(/LIMIT/.test(raw)) return "LIMITED";
  if(/PROBAB/.test(raw)) return "PROBABLE";
  if(/FULL|ACTIVE|AVAILABLE|CLEARED/.test(raw)) return "ACTIVE";
  return raw.replace(/\s+/g,"_");
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
    const points=round2(playerBasePoints(position,sport)*depthFactor(rank)*weight);
    const fr=freshness(row.observed_at,nowMs);
    if(freshest==null || (fr.ageHours!=null && fr.ageHours<freshest)) freshest=fr.ageHours;
    if(points>0){
      if(DEFENSE_POSITIONS.has(position)) defensePenalty+=points;
      else if(SPECIAL_POSITIONS.has(position)) specialPenalty+=points;
      else offensePenalty+=points;
    }
    if(position==="QB" && (rank==null || rank<=1) && ["DOUBTFUL","QUESTIONABLE"].includes(status)){
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
  if(direct){
    next.projHomeScore=direct.home;
    next.projAwayScore=direct.away;
    next.availabilityAdjustedProjection=direct;
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
    };
  }
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
  const since=new Date(Date.now()-7*24*3600000).toISOString();
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
      note:"Two Deep is preferred for NFL/CFB once licensed API access is installed; persisted official/licensed observations are normalized before model use.",
    },
  };
}
