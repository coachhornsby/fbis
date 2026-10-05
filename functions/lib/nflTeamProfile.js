import { NFL_TEAM_GEO, haversineMiles, timeZonesCrossed } from "./nflTravelContext.js";

const DAY=86400000;
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};

export const NFL_TEAM_KEY_ALIASES=Object.freeze({JAC:"JAX",JAX:"JAX",WSH:"WAS",WAS:"WAS",LA:"LAR",LAR:"LAR",SD:"LAC",OAK:"LV"});
export function normalizeNflTeamKey(v){
  const k=String(v||"").toUpperCase().trim();
  return NFL_TEAM_KEY_ALIASES[k]||k;
}
export function normalizePlayerName(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
export function nflInjuryType(detail=""){
  const s=String(detail||"").toLowerCase();
  if(/ankle/.test(s))return"ANKLE";
  if(/knee/.test(s))return"KNEE";
  if(/hamstring/.test(s))return"HAMSTRING";
  if(/groin/.test(s))return"GROIN";
  if(/calf/.test(s))return"CALF";
  if(/back/.test(s))return"BACK";
  if(/shoulder/.test(s))return"SHOULDER";
  if(/foot/.test(s))return"FOOT";
  if(/wrist/.test(s))return"WRIST";
  if(/hand|finger|thumb/.test(s))return"HAND";
  if(/hip/.test(s))return"HIP";
  if(/neck/.test(s))return"NECK";
  if(/concussion|head/.test(s))return"CONCUSSION";
  if(/illness/.test(s))return"ILLNESS";
  if(/achilles/.test(s))return"ACHILLES";
  return detail?"OTHER":"NONE";
}
export function nflInjurySeverity(detail="",status=""){
  const s=String(detail||"").toLowerCase(),st=String(status||"").toUpperCase();
  if(/rupture|surgery|fracture|torn|tear|achilles/.test(s))return"SEVERE";
  if(/high ankle|grade\s*(2|ii)|moderate|stress fracture/.test(s))return"MODERATE";
  if(/grade\s*(1|i)|mild|soreness|contusion|bruise|tightness/.test(s))return"MINOR";
  if(st==="OUT")return"UNKNOWN_OUT";
  if(st==="DOUBTFUL")return"UNKNOWN_DOUBTFUL";
  return"UNKNOWN";
}
export function nflEvidenceRank(source,status=""){
  const s=String(source||"").toUpperCase(),st=String(status||"").toUpperCase();
  if(s.includes("FINAL_INACTIVE"))return 110;
  if(s.includes("ACTUAL_GAME"))return 105;
  if(s.includes("CONFIRMED_DEPTH"))return 100;
  if(s.includes("NFL-OFFICIAL")||s.includes("NFL_OFFICIAL"))return ["OUT","DOUBTFUL","QUESTIONABLE"].includes(st)?95:90;
  if(s.includes("ROSTER"))return 35;
  if(s.includes("CARRIED"))return 20;
  return 10;
}
export function nflStateConfidence(source,status,carried=false){
  const s=String(source||"").toUpperCase(),st=String(status||"").toUpperCase();
  let v=s.includes("FINAL_INACTIVE")?0.995:s.includes("ACTUAL_GAME")?0.99:s.includes("NFL-OFFICIAL")||s.includes("NFL_OFFICIAL")?0.97:s.includes("CONFIRMED_DEPTH")?0.94:s.includes("ROSTER")?0.72:s.includes("CARRIED")?0.76:0.60;
  if(carried)v-=.10;if(st==="UNKNOWN")v-=.15;return round(clamp(v,.2,.995));
}
function newer(a,b){
  const ta=Date.parse(a?.timestamp||0),tb=Date.parse(b?.timestamp||0);
  if(ta!==tb)return ta>tb;
  return Number(a?.rank||0)>Number(b?.rank||0);
}
export function resolveNflPersistentPlayerState({
  player,priorState=null,availabilityRows=[],appearanceRows=[],inactiveRows=[],asOf=new Date().toISOString(),appearanceMaxAgeDays=16
}={}){
  const pid=String(player?.id||player?.playerId||""),name=player?.name||player?.displayName||priorState?.player_name||"";
  const norm=normalizePlayerName(name),events=[];
  if(priorState)events.push({status:String(priorState.status||"UNKNOWN").toUpperCase(),source:"CARRIED_PROFILE",timestamp:priorState.state_source_timestamp||priorState.as_of||priorState.updated_at,detail:priorState.injury_detail||null,rank:nflEvidenceRank("CARRIED_PROFILE"),carried:true});
  for(const a of availabilityRows||[]){
    if(pid&&a.player_id&&String(a.player_id)!==pid)continue;
    if(normalizePlayerName(a.player_name)!==norm&&(!pid||!a.player_id))continue;
    if(Date.parse(a.observed_at||0)>Date.parse(asOf))continue;
    events.push({status:String(a.status||"UNKNOWN").toUpperCase(),source:a.source||"nfl-official",timestamp:a.observed_at||a.source_updated_at,detail:a.injury_detail||null,rank:nflEvidenceRank(a.source||"nfl-official",a.status),raw:a});
  }
  for(const x of inactiveRows||[]){
    if(pid&&x.player_id&&String(x.player_id)!==pid)continue;
    if(normalizePlayerName(x.player_name)!==norm&&(!pid||!x.player_id))continue;
    if(Date.parse(x.observed_at||0)>Date.parse(asOf))continue;
    events.push({status:x.active===true?"AVAILABLE":"OUT",source:"FINAL_INACTIVE_LIST",timestamp:x.observed_at,detail:x.active===true?null:"final inactive list",rank:nflEvidenceRank("FINAL_INACTIVE_LIST"),raw:x});
  }
  for(const g of appearanceRows||[]){
    const gt=Date.parse(g.date||g.start||0),at=Date.parse(asOf);
    if(gt>at||!Number.isFinite(gt)||!Number.isFinite(at)||at-gt>appearanceMaxAgeDays*DAY)continue;
    if((finite(g.snaps)||finite(g.snapShare)||0)<=0)continue;
    events.push({status:"AVAILABLE",source:"ACTUAL_GAME_APPEARANCE",timestamp:g.date||g.start,detail:null,rank:nflEvidenceRank("ACTUAL_GAME_APPEARANCE"),raw:g});
  }
  events.sort((a,b)=>newer(a,b)?1:newer(b,a)?-1:0);
  const winner=events.at(-1)||{status:"UNKNOWN",source:"ROSTER_UNVERIFIED",timestamp:asOf,detail:null,rank:nflEvidenceRank("ROSTER")};
  const carried=winner.source==="CARRIED_PROFILE";
  return {
    playerId:pid||null,playerName:name,status:winner.status,source:winner.source,sourceTimestamp:winner.timestamp||asOf,
    injuryDetail:winner.detail||null,injuryType:nflInjuryType(winner.detail),injurySeverity:nflInjurySeverity(winner.detail,winner.status),
    carriedForward:carried,confidence:nflStateConfidence(winner.source,winner.status,carried),evidenceCount:events.length,latestEvidence:winner.raw||null
  };
}
function gameStart(g){return Date.parse(g?.startTime||g?.start||g?.date||0)}
function venueKey(g,team){return normalizeNflTeamKey(g?.venueTeamKey||g?.homeTeamKey||g?.home?.abbr||team)}
export function deriveNflScheduleStress(schedule=[],teamKey){
  const team=normalizeNflTeamKey(teamKey),rows=[...(schedule||[])].sort((a,b)=>gameStart(a)-gameStart(b)),out=[];
  let roadRun=0;
  for(let i=0;i<rows.length;i++){
    const g=rows[i],t=gameStart(g),prev=rows[i-1]||null,pt=prev?gameStart(prev):null;
    const daysRest=pt!=null?Math.max(0,Math.round((t-pt)/DAY)-1):6;
    const shortWeek=daysRest<6;
    const miniBye=daysRest>=9;
    const ha=String(g.homeAway||"").toLowerCase();
    if(ha==="away")roadRun++;else roadRun=0;
    const pv=prev?venueKey(prev,team):team,cv=venueKey(g,team);
    const travelMiles=pv&&cv&&NFL_TEAM_GEO[pv]&&NFL_TEAM_GEO[cv]?haversineMiles(NFL_TEAM_GEO[pv],NFL_TEAM_GEO[cv]):0;
    const tz=timeZonesCrossed(pv,cv,g.startTime||g.start||g.date);
    const altitude=NFL_TEAM_GEO[cv]?.altitudeFt||0;
    const international=Boolean(g.international)||Boolean(g.neutralSite&&g.venueCountry&&String(g.venueCountry).toUpperCase()!=="USA");
    let stress=0;const reasons=[];
    if(shortWeek){stress+=24;reasons.push("SHORT_WEEK")}
    if(daysRest<=4){stress+=10;reasons.push("FOUR_OR_FEWER_REST_DAYS")}
    if(travelMiles>=1800){stress+=18;reasons.push("LONG_HAUL_1800_PLUS")}
    else if(travelMiles>=1000){stress+=10;reasons.push("LONG_TRAVEL_1000_PLUS")}
    if(tz>=2){stress+=12;reasons.push("MULTI_TIME_ZONE")}
    else if(tz===1){stress+=5;reasons.push("TIME_ZONE_CHANGE")}
    if(altitude>=4000&&ha==="away"){stress+=10;reasons.push("ALTITUDE_ROAD_GAME")}
    if(roadRun>=3){stress+=8;reasons.push("ROAD_STRETCH_"+roadRun)}
    if(international){stress+=18;reasons.push("INTERNATIONAL_GAME")}
    if(miniBye){stress-=8;reasons.push("EXTENDED_REST")}
    stress=clamp(stress,0,100);
    out.push({...g,teamKey:team,daysRest,shortWeek,extendedRest:miniBye,travelMiles:round(travelMiles,1),timeZonesCrossed:tz,altitudeFeet:altitude,roadStretchGameNumber:ha==="away"?roadRun:0,international,scheduleStressScore:stress,stressLevel:stress>=55?"SEVERE":stress>=35?"HIGH":stress>=20?"MODERATE":"NORMAL",stressReasons:reasons});
  }
  return out;
}
export function nflScheduleSummary(schedule=[],teamKey,{asOf=new Date().toISOString()}={}){
  const rows=deriveNflScheduleStress(schedule,teamKey),future=rows.filter(g=>gameStart(g)>=Date.parse(asOf));
  return {
    nextGame:future[0]||null,next8:future.slice(0,8),
    shortWeeks:future.filter(x=>x.shortWeek).length,
    longTravelGames:future.filter(x=>(x.travelMiles||0)>=1000).length,
    internationalGames:future.filter(x=>x.international).length,
    severeStressGames:future.filter(x=>x.scheduleStressScore>=55).length,
    highStressGames:future.filter(x=>x.scheduleStressScore>=35&&x.scheduleStressScore<55).length,
    weakSpots:future.filter(x=>x.scheduleStressScore>=20).sort((a,b)=>b.scheduleStressScore-a.scheduleStressScore||gameStart(a)-gameStart(b))
  };
}
export function inferNflRole(player={},prior={}){
  const pos=String(player.position||player.positionAbbr||prior.position||"").toUpperCase();
  const depth=finite(player.depthRank??prior.depth_rank);
  const snap=finite(player.snapShare??prior.snap_share);
  if(depth===1)return"STARTER";
  if(depth===2)return"PRIMARY_BACKUP";
  if(snap!=null&&snap>=.65)return"STARTER";
  if(snap!=null&&snap>=.3)return"ROTATION";
  if(["QB","K","P","LS"].includes(pos)&&depth==null)return"ROLE_UNVERIFIED";
  return"DEPTH";
}
export function replacementCandidatesNfl(targetId,roster=[],states={}){
  const target=roster.find(p=>String(p.id)===String(targetId));if(!target)return[];
  const pos=String(target.position||"").toUpperCase();
  return roster.filter(p=>String(p.id)!==String(targetId)).filter(p=>!["OUT","IR","PUP","NFI","SUSPENDED"].includes(String(states?.[String(p.id)]?.status||"").toUpperCase())).map(p=>{
    const same=String(p.position||"").toUpperCase()===pos?1:.2;
    const depth=finite(p.depthRank);
    const snap=finite(p.snapShare)||0;
    return {playerId:String(p.id),playerName:p.name,position:p.position||null,score:round(same*.6+(depth?clamp((4-depth)/3,0,1):0)*.25+clamp(snap,0,1)*.15)};
  }).sort((a,b)=>b.score-a.score).slice(0,4);
}

function parseJson(v,fallback=null){try{return typeof v==="string"?JSON.parse(v):v??fallback}catch{return fallback}}
export async function loadNflTeamProfiles(db){
  if(!db?.prepare)return {byTeam:{},byPlayer:{},meta:{configured:false,reason:"db-unbound"}};
  try{
    const [t,p]=await Promise.all([
      db.prepare("SELECT team_key,profile_json,updated_at FROM nfl_team_profiles").all(),
      db.prepare("SELECT player_id,team_key,profile_json,status,state_confidence FROM nfl_player_state_profiles").all(),
    ]);
    const byTeam={};for(const r of t.results||[])byTeam[normalizeNflTeamKey(r.team_key)]={...parseJson(r.profile_json,{}),updatedAt:r.updated_at};
    const byPlayer={},playersByTeam={};
    for(const r of p.results||[]){
      if(r.player_id)byPlayer[String(r.player_id)]={...parseJson(r.profile_json,{}),status:r.status,stateConfidence:r.state_confidence};
      const tk=normalizeNflTeamKey(r.team_key);
      if(tk)(playersByTeam[tk]||(playersByTeam[tk]=[])).push({...parseJson(r.profile_json,{}),status:r.status,stateConfidence:r.state_confidence});
    }
    return {byTeam,byPlayer,playersByTeam,meta:{configured:true,teams:Object.keys(byTeam).length,players:Object.keys(byPlayer).length}};
  }catch(err){return {byTeam:{},byPlayer:{},playersByTeam:{},meta:{configured:false,reason:String(err?.message||err)}}}
}
function gameScheduleContext(profile,gameId){
  const rows=profile?.schedule?.summary?.next8||[];
  return rows.find(x=>String(x.gameId||"")===String(gameId||""))||profile?.schedule?.summary?.nextGame||null;
}
export function attachNflPersistentProfiles(games=[],ctx={}){
  return (games||[]).map(game=>{
    const hk=normalizeNflTeamKey(game?.home?.abbr),ak=normalizeNflTeamKey(game?.away?.abbr);
    const home=ctx.byTeam?.[hk]||null,away=ctx.byTeam?.[ak]||null;
    const hs=gameScheduleContext(home,game?.id),as=gameScheduleContext(away,game?.id);
    const homePlayers=ctx.playersByTeam?.[hk]||[],awayPlayers=ctx.playersByTeam?.[ak]||[];
    const nflFeatures={...(game.nflFeatures||{})};
    nflFeatures.home={...(nflFeatures.home||{}),
      daysRest:hs?.daysRest??nflFeatures.home?.daysRest??null,
      travelMiles:hs?.travelMiles??nflFeatures.home?.travelMiles??null,
      timeZonesCrossed:hs?.timeZonesCrossed??nflFeatures.home?.timeZonesCrossed??null,
      altitudeFeet:hs?.altitudeFeet??nflFeatures.home?.altitudeFeet??null,
      scheduleStressScore:hs?.scheduleStressScore??null,
      shortWeek:hs?.shortWeek===true,
      internationalGame:hs?.international===true,
    };
    nflFeatures.away={...(nflFeatures.away||{}),
      daysRest:as?.daysRest??nflFeatures.away?.daysRest??null,
      travelMiles:as?.travelMiles??nflFeatures.away?.travelMiles??null,
      timeZonesCrossed:as?.timeZonesCrossed??nflFeatures.away?.timeZonesCrossed??null,
      altitudeFeet:as?.altitudeFeet??nflFeatures.away?.altitudeFeet??null,
      scheduleStressScore:as?.scheduleStressScore??null,
      shortWeek:as?.shortWeek===true,
      internationalGame:as?.international===true,
    };
    return {...game,nflFeatures,nflPersistentProfile:{home,away,homePlayers,awayPlayers,homeSchedule:hs,awaySchedule:as,asOf:new Date().toISOString(),configured:Boolean(home||away)}};
  });
}
