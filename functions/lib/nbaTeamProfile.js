import { NBA_TEAM_GEO, haversineMiles, timeZonesCrossed } from "./nbaTravelContext.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const DAY=86400000;

export const NBA_TEAM_KEY_ALIASES=Object.freeze({
  GS:"GSW",GSW:"GSW",NO:"NOP",NOP:"NOP",NY:"NYK",NYK:"NYK",SA:"SAS",SAS:"SAS",UTAH:"UTA",UTA:"UTA"
});
export function normalizeNbaTeamKey(v){
  const k=String(v||"").toUpperCase().trim();
  return NBA_TEAM_KEY_ALIASES[k]||k;
}
export function normalizePlayerName(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
export function injuryType(detail=""){
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
  if(/illness/.test(s))return"ILLNESS";
  if(/concussion/.test(s))return"CONCUSSION";
  return detail?"OTHER":"NONE";
}
export function injurySeverity(detail="",status=""){
  const s=String(detail||"").toLowerCase(),st=String(status||"").toUpperCase();
  if(/grade\s*(3|iii)|rupture|surgery|fracture|torn|tear\s*(?:of|in)?\s*(?:acl|mcl|achilles)|achilles/.test(s))return"SEVERE";
  if(/grade\s*(2|ii)|moderate|high ankle|stress fracture/.test(s))return"MODERATE";
  if(/grade\s*(1|i)|mild|soreness|contusion|bruise|tightness/.test(s))return"MINOR";
  if(st==="OUT")return"UNKNOWN_OUT";
  if(st==="DOUBTFUL")return"UNKNOWN_DOUBTFUL";
  return"UNKNOWN";
}
export function stateConfidence(source,status,carried=false){
  const s=String(source||"").toUpperCase(),st=String(status||"").toUpperCase();
  let v=
    s.includes("CONFIRMED_LINEUP")?0.99:
    s.includes("ACTUAL_GAME")?0.98:
    s.includes("NBA_OFFICIAL_INJURY_REPORT")?0.97:
    s.includes("ROSTER")?0.70:
    s.includes("CARRIED")?0.72:0.60;
  if(carried)v-=.10;
  if(st==="UNKNOWN")v-=.12;
  return round(clamp(v,.2,.99));
}
export function evidenceRank(source,status=null){
  const s=String(source||"").toUpperCase(),st=String(status||"").toUpperCase();
  if(s.includes("CONFIRMED_LINEUP"))return 100;
  if(s.includes("ACTUAL_GAME"))return 95;
  if(s.includes("NBA_OFFICIAL_INJURY_REPORT"))return st==="AVAILABLE"?92:90;
  if(s.includes("ROSTER"))return 30;
  if(s.includes("CARRIED"))return 20;
  return 10;
}

function newer(a,b){
  const ta=Date.parse(a?.timestamp||a?.sourceTimestamp||0),tb=Date.parse(b?.timestamp||b?.sourceTimestamp||0);
  if(ta!==tb)return ta>tb;
  return Number(a?.rank||0)>Number(b?.rank||0);
}
export function resolvePersistentPlayerState({
  player,priorState=null,availabilityRows=[],lineupRows=[],gameAppearances=[],asOf=new Date().toISOString(),gameAppearanceMaxAgeDays=21
}={}){
  const pid=String(player?.id||player?.playerId||""),name=player?.name||player?.displayName||priorState?.player_name||"";
  const norm=normalizePlayerName(name),events=[];
  if(priorState){
    events.push({
      status:String(priorState.status||"UNKNOWN").toUpperCase(),
      source:"CARRIED_PROFILE",
      timestamp:priorState.state_source_timestamp||priorState.as_of||priorState.updated_at,
      detail:priorState.injury_detail||null,
      rank:evidenceRank("CARRIED_PROFILE"),
      carried:true
    });
  }
  for(const a of availabilityRows||[]){
    if(pid&&a.player_id&&String(a.player_id)!==pid)continue;
    if(!pid&&normalizePlayerName(a.player_name)!==norm)continue;
    if(pid&&a.player_id==null&&normalizePlayerName(a.player_name)!==norm)continue;
    if(Date.parse(a.observed_at||a.source_updated_at||0)>Date.parse(asOf))continue;
    events.push({
      status:String(a.status||"UNKNOWN").toUpperCase(),
      source:a.source||"NBA_OFFICIAL_INJURY_REPORT",
      timestamp:a.observed_at||a.source_updated_at,
      detail:a.injury_detail||null,
      rank:evidenceRank(a.source||"NBA_OFFICIAL_INJURY_REPORT",a.status),
      raw:a
    });
  }
  for(const l of lineupRows||[]){
    if(pid&&l.player_id&&String(l.player_id)!==pid)continue;
    if(!pid&&normalizePlayerName(l.player_name)!==norm)continue;
    if(pid&&l.player_id==null&&normalizePlayerName(l.player_name)!==norm)continue;
    if(Date.parse(l.observed_at||0)>Date.parse(asOf))continue;
    const ls=String(l.lineup_status||"").toUpperCase();
    const active=["STARTER","ACTIVE","CONFIRMED_ACTIVE","BENCH"].includes(ls);
    events.push({
      status:active?"AVAILABLE":"OUT",
      source:"CONFIRMED_LINEUP",
      timestamp:l.observed_at,
      detail:active?null:"lineup inactive",
      rank:evidenceRank("CONFIRMED_LINEUP"),
      raw:l
    });
  }
  for(const g of gameAppearances||[]){
    const gt=Date.parse(g.date||g.start||0),at=Date.parse(asOf);
    if(gt>at)continue;
    if(!Number.isFinite(gt)||!Number.isFinite(at)||at-gt>gameAppearanceMaxAgeDays*DAY)continue;
    if((finite(g.minutes)||0)<=0)continue;
    events.push({
      status:"AVAILABLE",source:"ACTUAL_GAME_APPEARANCE",timestamp:g.date||g.start,
      detail:null,rank:evidenceRank("ACTUAL_GAME_APPEARANCE"),raw:g
    });
  }
  events.sort((a,b)=>newer(a,b)?1:newer(b,a)?-1:0);
  let winner=events.at(-1)||{
    status:"UNKNOWN",source:"ROSTER_UNVERIFIED",timestamp:asOf,detail:null,rank:evidenceRank("ROSTER")
  };
  const carried=winner.source==="CARRIED_PROFILE";
  return {
    playerId:pid||null,playerName:name,
    status:winner.status,source:winner.source,sourceTimestamp:winner.timestamp||asOf,
    injuryDetail:winner.detail||null,injuryType:injuryType(winner.detail),
    injurySeverity:injurySeverity(winner.detail,winner.status),
    carriedForward:carried,
    confidence:stateConfidence(winner.source,winner.status,carried),
    evidenceCount:events.length,
    latestEvidence:winner.raw||null
  };
}

function venueKey(item){
  return normalizeNbaTeamKey(item?.venueTeamKey||item?.homeTeamKey||item?.home?.abbr||item?.homeAbbr);
}
function gameStart(item){return Date.parse(item?.startTime||item?.start||item?.date||0)}
export function deriveScheduleStress(schedule=[],teamKey){
  const team=normalizeNbaTeamKey(teamKey),rows=[...(schedule||[])].sort((a,b)=>gameStart(a)-gameStart(b));
  const out=[];
  let roadRun=0;
  for(let i=0;i<rows.length;i++){
    const g=rows[i],t=gameStart(g),prev=rows[i-1]||null,prevT=prev?gameStart(prev):null;
    const restDays=prevT!=null?Math.max(0,Math.floor((t-prevT)/DAY)-1):3;
    const recent4=rows.slice(0,i).filter(x=>t-gameStart(x)<=4*DAY);
    const recent6=rows.slice(0,i).filter(x=>t-gameStart(x)<=6*DAY);
    const b2b=restDays===0,threeInFour=recent4.length>=2,fourInSix=recent6.length>=3;
    const ha=String(g.homeAway||"").toLowerCase();
    if(ha==="away")roadRun++;else roadRun=0;
    const prevVenue=prev?venueKey(prev):team,currentVenue=venueKey(g);
    const travelMiles=prevVenue&&currentVenue&&NBA_TEAM_GEO[prevVenue]&&NBA_TEAM_GEO[currentVenue]
      ?haversineMiles(NBA_TEAM_GEO[prevVenue],NBA_TEAM_GEO[currentVenue]):0;
    const tzCross=prevVenue&&currentVenue?timeZonesCrossed(prevVenue,currentVenue,g.startTime||g.start||g.date):0;
    const altitude=NBA_TEAM_GEO[currentVenue]?.altitudeFt||0;
    const reasons=[];
    let stress=0;
    if(b2b){stress+=28;reasons.push("BACK_TO_BACK")}
    if(threeInFour){stress+=18;reasons.push("THREE_IN_FOUR")}
    if(fourInSix){stress+=16;reasons.push("FOUR_IN_SIX")}
    if(travelMiles>=1800){stress+=18;reasons.push("LONG_HAUL_1800_PLUS")}
    else if(travelMiles>=1000){stress+=11;reasons.push("LONG_TRAVEL_1000_PLUS")}
    if(tzCross>=2){stress+=12;reasons.push("MULTI_TIME_ZONE")}
    else if(tzCross===1){stress+=5;reasons.push("TIME_ZONE_CHANGE")}
    if(altitude>=4000&&ha==="away"){stress+=10;reasons.push("ALTITUDE_ROAD_GAME")}
    if(roadRun>=4){stress+=10;reasons.push("ROAD_TRIP_GAME_"+roadRun)}
    else if(roadRun>=3){stress+=6;reasons.push("ROAD_TRIP_GAME_"+roadRun)}
    if(prev&&String(prev.homeAway||"").toLowerCase()==="away"&&ha==="home"&&restDays===0){stress+=8;reasons.push("TRAVEL_HOME_B2B")}
    stress=clamp(stress,0,100);
    out.push({
      ...g,teamKey:team,restDays,backToBack:b2b,threeInFour,fourInSix,
      travelMiles:round(travelMiles,1),timeZonesCrossed:tzCross,altitudeFeet:altitude,
      roadTripGameNumber:ha==="away"?roadRun:0,consecutiveRoadGames:ha==="away"?roadRun:0,
      scheduleStressScore:stress,stressLevel:stress>=55?"SEVERE":stress>=35?"HIGH":stress>=20?"MODERATE":"NORMAL",
      stressReasons:reasons
    });
  }
  return out;
}
export function scheduleWeakSpots(schedule=[],teamKey,{asOf=new Date().toISOString(),days=45}={}){
  const start=Date.parse(asOf),end=start+days*DAY;
  return deriveScheduleStress(schedule,teamKey)
    .filter(g=>{const t=gameStart(g);return t>=start&&t<=end&&g.scheduleStressScore>=20})
    .sort((a,b)=>b.scheduleStressScore-a.scheduleStressScore||gameStart(a)-gameStart(b));
}
export function scheduleSummary(schedule=[],teamKey,{asOf=new Date().toISOString()}={}){
  const derived=deriveScheduleStress(schedule,teamKey),future=derived.filter(g=>gameStart(g)>=Date.parse(asOf));
  const next10=future.slice(0,10);
  return {
    nextGame:future[0]||null,
    next10,
    backToBacks:future.filter(x=>x.backToBack).length,
    threeInFour:future.filter(x=>x.threeInFour).length,
    fourInSix:future.filter(x=>x.fourInSix).length,
    longTravelGames:future.filter(x=>(x.travelMiles||0)>=1000).length,
    severeStressGames:future.filter(x=>x.scheduleStressScore>=55).length,
    highStressGames:future.filter(x=>x.scheduleStressScore>=35&&x.scheduleStressScore<55).length,
    weakSpots:scheduleWeakSpots(schedule,teamKey,{asOf})
  };
}
export function rotationRole(minutes=0,starterRate=0){
  const m=finite(minutes)||0,s=finite(starterRate)||0;
  if(s>=.65&&m>=28)return"CORE_STARTER";
  if(m>=28)return"CORE_ROTATION";
  if(m>=20)return"ROTATION";
  if(m>=10)return"FRINGE_ROTATION";
  return"DEPTH";
}
export function replacementCandidates(targetId,roster=[],states={},impactByPlayer={}){
  const target=roster.find(p=>String(p.id)===String(targetId));if(!target)return[];
  const pos=String(target.position||target.positionAbbr||"").toUpperCase();
  return roster.filter(p=>String(p.id)!==String(targetId))
    .filter(p=>!["OUT","DOUBTFUL"].includes(String(states?.[String(p.id)]?.status||"").toUpperCase()))
    .map(p=>{
      const ppos=String(p.position||p.positionAbbr||"").toUpperCase();
      const same=pos&&ppos?(pos===ppos?1:/G/.test(pos)&&/G/.test(ppos)||/F/.test(pos)&&/F/.test(ppos)||/C/.test(pos)&&/C/.test(ppos)?.8:.45):.55;
      const min=finite(p.expectedMinutes)||finite(impactByPlayer?.[String(p.id)]?.skill?.minutes)||0;
      return {playerId:String(p.id),playerName:p.name,position:ppos,score:round(same*0.65+clamp(min/36,0,1)*0.35)};
    })
    .sort((a,b)=>b.score-a.score).slice(0,4);
}
