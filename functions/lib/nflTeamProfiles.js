/**
 * Persistent NFL team + player operating profiles.
 *
 * State model:
 * immutable source observations -> persistent player/team state -> game/prop context.
 *
 * This module intentionally does NOT authorize wagers. Schedule stress and
 * coaching context are research features until leakage-safe validation proves
 * incremental value.
 */

import nflTeams from "../../data/teams/nfl.js";
import { loadNflVerseFeatures } from "./nflVerseFeed.js";
import { normalizeAvailabilityStatus } from "./availability.js";

export const NFL_PROFILE_VERSION="NFL-TEAM-PROFILE-v1";
export const NFL_PROFILE_SOURCE="espn+nfl-official+nflverse";

const TEAM_GEO=Object.freeze({
 ARI:{lat:33.5276,lon:-112.2626,tz:"America/Phoenix",altitudeFt:1070},
 ATL:{lat:33.7554,lon:-84.4008,tz:"America/New_York",altitudeFt:1050},
 BAL:{lat:39.2780,lon:-76.6227,tz:"America/New_York",altitudeFt:20},
 BUF:{lat:42.7738,lon:-78.7870,tz:"America/New_York",altitudeFt:600},
 CAR:{lat:35.2258,lon:-80.8528,tz:"America/New_York",altitudeFt:750},
 CHI:{lat:41.8623,lon:-87.6167,tz:"America/Chicago",altitudeFt:595},
 CIN:{lat:39.0954,lon:-84.5160,tz:"America/New_York",altitudeFt:490},
 CLE:{lat:41.5061,lon:-81.6995,tz:"America/New_York",altitudeFt:585},
 DAL:{lat:32.7473,lon:-97.0945,tz:"America/Chicago",altitudeFt:550},
 DEN:{lat:39.7439,lon:-105.0201,tz:"America/Denver",altitudeFt:5280},
 DET:{lat:42.3400,lon:-83.0456,tz:"America/New_York",altitudeFt:600},
 GB:{lat:44.5013,lon:-88.0622,tz:"America/Chicago",altitudeFt:640},
 HOU:{lat:29.6847,lon:-95.4107,tz:"America/Chicago",altitudeFt:50},
 IND:{lat:39.7601,lon:-86.1639,tz:"America/Indiana/Indianapolis",altitudeFt:715},
 JAX:{lat:30.3239,lon:-81.6373,tz:"America/New_York",altitudeFt:20},
 KC:{lat:39.0489,lon:-94.4839,tz:"America/Chicago",altitudeFt:900},
 LV:{lat:36.0908,lon:-115.1830,tz:"America/Los_Angeles",altitudeFt:2030},
 LAC:{lat:33.9535,lon:-118.3392,tz:"America/Los_Angeles",altitudeFt:100},
 LAR:{lat:33.9535,lon:-118.3392,tz:"America/Los_Angeles",altitudeFt:100},
 MIA:{lat:25.9580,lon:-80.2389,tz:"America/New_York",altitudeFt:10},
 MIN:{lat:44.9738,lon:-93.2581,tz:"America/Chicago",altitudeFt:830},
 NE:{lat:42.0909,lon:-71.2643,tz:"America/New_York",altitudeFt:285},
 NO:{lat:29.9511,lon:-90.0812,tz:"America/Chicago",altitudeFt:0},
 NYG:{lat:40.8135,lon:-74.0745,tz:"America/New_York",altitudeFt:10},
 NYJ:{lat:40.8135,lon:-74.0745,tz:"America/New_York",altitudeFt:10},
 PHI:{lat:39.9008,lon:-75.1675,tz:"America/New_York",altitudeFt:40},
 PIT:{lat:40.4468,lon:-80.0158,tz:"America/New_York",altitudeFt:730},
 SEA:{lat:47.5952,lon:-122.3316,tz:"America/Los_Angeles",altitudeFt:20},
 SF:{lat:37.4030,lon:-121.9700,tz:"America/Los_Angeles",altitudeFt:15},
 TB:{lat:27.9759,lon:-82.5033,tz:"America/New_York",altitudeFt:50},
 TEN:{lat:36.1665,lon:-86.7713,tz:"America/Chicago",altitudeFt:430},
 WAS:{lat:38.9076,lon:-76.8645,tz:"America/New_York",altitudeFt:50},
});

const INTERNATIONAL_GEO=Object.freeze({
 london:{lat:51.5074,lon:-0.1278,tz:"Europe/London",altitudeFt:36},
 berlin:{lat:52.5200,lon:13.4050,tz:"Europe/Berlin",altitudeFt:112},
 munich:{lat:48.1351,lon:11.5820,tz:"Europe/Berlin",altitudeFt:1710},
 madrid:{lat:40.4168,lon:-3.7038,tz:"Europe/Madrid",altitudeFt:2188},
 paris:{lat:48.8566,lon:2.3522,tz:"Europe/Paris",altitudeFt:115},
 dublin:{lat:53.3498,lon:-6.2603,tz:"Europe/Dublin",altitudeFt:66},
 melbourne:{lat:-37.8136,lon:144.9631,tz:"Australia/Melbourne",altitudeFt:102},
 "rio de janeiro":{lat:-22.9068,lon:-43.1729,tz:"America/Sao_Paulo",altitudeFt:7},
 "sao paulo":{lat:-23.5505,lon:-46.6333,tz:"America/Sao_Paulo",altitudeFt:2500},
});

const ABBR_ALIAS=Object.freeze({JAC:"JAX",LA:"LAR",WSH:"WAS"});
function canon(v){const s=String(v||"").trim().toUpperCase();return ABBR_ALIAS[s]||s;}
function clean(v){return String(v??"").replace(/\s+/g," ").trim();}
function normName(v){return clean(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,d=2){const f=10**d;return Math.round(Number(v)*f)/f;}
function seasonYear(now=new Date()){const y=now.getUTCFullYear(),m=now.getUTCMonth()+1;return m>=7?y:y-1;}
function teamRegistry(abbr){return nflTeams.find(t=>canon(t.abbr)===canon(abbr))||null;}
function teamKey(abbr){return canon(abbr).toLowerCase();}
function playerKey(team,player){return `nfl:${teamKey(team)}:${String(player?.id||normName(player?.name)||"unknown").replace(/[^a-zA-Z0-9_-]+/g,"-")}`;}

function radians(v){return Number(v)*Math.PI/180;}
export function haversineMiles(a,b){
 if(!a||!b)return null;
 const R=3958.7613,dLat=radians(b.lat-a.lat),dLon=radians(b.lon-a.lon);
 const q=Math.sin(dLat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLon/2)**2;
 return 2*R*Math.asin(Math.sqrt(q));
}
function tzOffsetMinutes(tz,iso){
 try{
  const d=new Date(iso),parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);
  const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return (Date.UTC(+x.year,+x.month-1,+x.day,+x.hour,+x.minute)-d.getTime())/60000;
 }catch{return null;}
}
function timeZonesCrossed(a,b,iso){
 if(!a||!b)return 0;
 const x=tzOffsetMinutes(a.tz,iso),y=tzOffsetMinutes(b.tz,iso);
 return x==null||y==null?0:Math.round(Math.abs(y-x)/60);
}
function venueGeo(event){
 const c=event?.competitions?.[0]||{};
 const venueText=clean([c?.venue?.fullName,c?.venue?.address?.city,c?.venue?.address?.state].filter(Boolean).join(" ")).toLowerCase();
 for(const [name,geo] of Object.entries(INTERNATIONAL_GEO))if(venueText.includes(name))return {...geo,label:name,international:true};
 const home=(c?.competitors||[]).find(x=>x?.homeAway==="home");
 const abbr=canon(home?.team?.abbreviation);
 return TEAM_GEO[abbr]?{...TEAM_GEO[abbr],label:abbr,international:false}:null;
}
function eventSides(event){
 const c=event?.competitions?.[0]||{};
 const comps=c?.competitors||[];
 const home=comps.find(x=>x?.homeAway==="home")?.team||{};
 const away=comps.find(x=>x?.homeAway==="away")?.team||{};
 return {home:canon(home.abbreviation),away:canon(away.abbreviation),competition:c};
}
function eventWeek(event){
 return finite(event?.week?.number??event?.week??event?.season?.week??event?.competitions?.[0]?.week?.number);
}

const NFL_POSITIONS=new Set(["QB","RB","FB","WR","TE","OT","T","G","OG","C","OL","DE","DT","NT","DL","EDGE","LB","ILB","OLB","CB","DB","S","FS","SS","K","P","LS"]);
function rosterPosition(v){
 const raw=clean(v).toUpperCase().replace(/[^A-Z]/g,"");
 const map={
  QUARTERBACK:"QB",RUNNINGBACK:"RB",FULLBACK:"FB",WIDERECEIVER:"WR",TIGHTEND:"TE",
  OFFENSIVETACKLE:"OT",OFFENSIVEGUARD:"G",CENTER:"C",DEFENSIVEEND:"DE",DEFENSIVETACKLE:"DT",
  LINEBACKER:"LB",CORNERBACK:"CB",SAFETY:"S",KICKER:"K",PUNTER:"P",LONGSNAPPER:"LS"
 };
 return map[raw]||raw;
}
export function parseNflRoster(payload){
 const out=[],seen=new Set();
 function walk(v,positionHint=null,depth=0){
  if(v==null||depth>7)return;
  if(Array.isArray(v)){for(const x of v)walk(x,positionHint,depth+1);return;}
  if(typeof v!=="object")return;
  const hint=rosterPosition(v?.position?.abbreviation||v?.position?.name||v?.position||positionHint||"");
  const id=clean(v.id||v.uid||v.athlete?.id);
  const name=clean(v.fullName||v.displayName||v.athlete?.fullName||v.athlete?.displayName);
  const pos=rosterPosition(v?.position?.abbreviation||v?.athlete?.position?.abbreviation||v?.position?.name||positionHint||"");
  const looksAthlete=Boolean(name&&id&&NFL_POSITIONS.has(pos));
  if(looksAthlete){
   const key=id+"|"+normName(name);
   if(!seen.has(key)){
    seen.add(key);
    out.push({
      id,name,position:pos||null,
      jersey:clean(v.jersey||v.athlete?.jersey)||null,
      rosterStatus:clean(v.status?.name||v.status?.type||v.status||v.athlete?.status?.name)||null,
      raw:v,
    });
   }
  }
  for(const [k,x] of Object.entries(v)){
   // ESPN athlete metadata is not another athlete. Passing the athlete's
   // position hint into taxonomy/status children creates false roster rows.
   if(["links","logos","images","position","parent","status"].includes(k))continue;
   walk(x,hint,depth+1);
  }
 }
 walk(payload);
 return out;
}

function parseCoach(payload){
 const found=[];
 const rosterCoach=Array.isArray(payload?.coach)?payload.coach[0]:null;
 if(rosterCoach){
  const rosterName=clean(rosterCoach.fullName||rosterCoach.displayName||[rosterCoach.firstName,rosterCoach.lastName].filter(Boolean).join(" "));
  if(rosterName)found.push({title:"Head Coach",name:rosterName});
 }
 function walk(v,depth=0){
  if(v==null||depth>7)return;
  if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}
  if(typeof v!=="object")return;
  const title=clean(v.title||v.role||v.position||v.type?.name||v.type?.text);
  const name=clean(v.fullName||v.displayName||v.name||v.coach?.displayName||v.coach?.fullName);
  if(name&&title&&/coach|coordinator/i.test(title))found.push({title,name});
  for(const [k,x] of Object.entries(v)){if(["links","logos","images"].includes(k))continue;walk(x,depth+1);}
 }
 walk(payload);
 const get=re=>found.find(x=>re.test(x.title))?.name||null;
 return {
  headCoach:get(/head coach/i),
  offensiveCoordinator:get(/offensive coordinator|offensive coord/i),
  defensiveCoordinator:get(/defensive coordinator|defensive coord/i),
  found,
 };
}

function scheduleEvents(payload){
 const candidates=[payload?.events,payload?.team?.events,payload?.schedule?.events,payload?.items];
 return candidates.find(Array.isArray)||[];
}

function parseDepthRanks(payload){
 const byId=new Map();
 function walk(v,depth=0,rankHint=null){
  if(v==null||depth>9)return;
  if(Array.isArray(v)){for(let i=0;i<v.length;i++)walk(v[i],depth+1,i+1);return;}
  if(typeof v!=="object")return;
  const rank=finite(v.rank??v.depth??v.order??rankHint);
  const refs=[v?.athlete?.$ref,v?.athlete?.ref,v?.$ref,v?.ref].filter(Boolean).map(String);
  const ids=[v?.athlete?.id,v?.id,...refs.map(x=>x.match(/athletes\/(\d+)/)?.[1])].filter(Boolean).map(String);
  if(rank!=null){
   for(const id of ids){
    if(!byId.has(id)||rank<byId.get(id))byId.set(id,rank);
   }
  }
  for(const [k,x] of Object.entries(v)){
   if(["links","logos","images"].includes(k))continue;
   walk(x,depth+1,rank);
  }
 }
 walk(payload);
 return byId;
}

export function buildScheduleProfile(events,abbr,season,nowMs=Date.now()){
 const team=canon(abbr),sorted=(events||[]).filter(e=>{
   const s=eventSides(e);return s.home===team||s.away===team;
 }).sort((a,b)=>Date.parse(a.date||a.startDate||0)-Date.parse(b.date||b.startDate||0));
 const rows=[];
 let previous=null,roadStreak=0;
 for(let i=0;i<sorted.length;i++){
   const e=sorted[i],s=eventSides(e),start=e.date||e.startDate||s.competition?.date||null,startMs=Date.parse(start||0);
   const site=s.home===team?"HOME":"ROAD",opp=s.home===team?s.away:s.home,geo=venueGeo(e);
   if(site==="ROAD")roadStreak+=1;else roadStreak=0;
   const prevStart=previous?Date.parse(previous.start_time||0):null;
   const gapHours=prevStart!=null&&Number.isFinite(startMs)?(startMs-prevStart)/3600000:null;
   const gapDays=gapHours==null?null:gapHours/24;
   const daysRest=gapDays==null?null:Math.max(0,round(gapDays-1,1));
   // "Short week" is based on kickoff-to-kickoff elapsed time, not rounded
   // rest-days. This prevents ordinary Sunday-to-Sunday games with different
   // kickoff windows (e.g. 4:25 PM -> 1:00 PM) from being falsely flagged.
   const shortWeek=gapHours!=null&&gapHours<144;
   const postBye=gapHours!=null&&gapHours>=264;
   const prior4=rows.filter(r=>startMs-Date.parse(r.start_time)<=28*86400000);
   const roadGamesLast4=prior4.filter(r=>r.site==="ROAD").length+(site==="ROAD"?1:0);
   const threeRoadInFour=roadGamesLast4>=3;
   const prevGeo=previous?.geo||(TEAM_GEO[team]||null);
   const travelMiles=prevGeo&&geo?haversineMiles(prevGeo,geo):null;
   const zones=prevGeo&&geo?timeZonesCrossed(prevGeo,geo,start):0;
   const international=Boolean(geo?.international);
   const altitude=geo?.altitudeFt??null;
   const flags=[];
   if(shortWeek)flags.push("SHORT_WEEK");
   if(postBye)flags.push("POST_BYE");
   if(threeRoadInFour)flags.push("THREE_ROAD_IN_FOUR");
   if((travelMiles||0)>=1500)flags.push("LONG_TRAVEL");
   if(zones>=2)flags.push("MULTI_TIME_ZONE");
   if(international)flags.push("INTERNATIONAL");
   if((altitude||0)>=4000)flags.push("ALTITUDE");
   const stress=clamp(
     (shortWeek ? .28 : 0)+(threeRoadInFour ? .18 : 0)+((travelMiles||0)>=1500 ? .16 : (travelMiles||0)>=900 ? .08 : 0)+
     (zones>=2 ? .12 : zones===1 ? .05 : 0)+(international ? .18 : 0)+((altitude||0)>=4000 ? .08 : 0)-(postBye ? .18 : 0),
     0,1
   );
   const row={
     id:`nfl:${season}:${teamKey(team)}:${String(e.id||i)}`,
     season,teamKey:teamKey(team),eventId:String(e.id||i),week:eventWeek(e),
     seasonType:clean(e.seasonType?.type??e.season?.type??"REG")||"REG",
     start_time:start,homeTeamKey:teamKey(s.home),awayTeamKey:teamKey(s.away),opponentKey:teamKey(opp),
     site,venueName:clean(s.competition?.venue?.fullName)||null,venueCity:clean(s.competition?.venue?.address?.city)||null,
     neutralSite:Boolean(s.competition?.neutralSite),international,daysRest,shortWeek,postBye,
     roadTripGameNumber:site==="ROAD"?roadStreak:0,roadGamesLast4,threeRoadInFour,
     travelMiles:travelMiles==null?null:round(travelMiles,0),timeZonesCrossed:zones,
     altitudeFeet:altitude,scheduleStressScore:round(stress,3),stressFlags:flags,geo,
     sourceUpdatedAt:new Date(nowMs).toISOString(),raw:e,
   };
   rows.push(row);previous=row;
 }
 return rows;
}

function latestByPlayer(rows=[]){
 const map=new Map();
 for(const r of rows){
  const k=normName(r.player_name||r.playerName);
  if(!k)continue;
  const cur=map.get(k);
  const at=String(r.source_updated_at||r.observed_at||"");
  const curAt=String(cur?.source_updated_at||cur?.observed_at||"");
  if(!cur||at>curAt)map.set(k,r);
 }
 return map;
}
function healthFromOfficial(row){
 if(!row)return null;
 const s=normalizeAvailabilityStatus(row.status);
 if(s==="ACTIVE"||s==="FULL")return "AVAILABLE";
 return s;
}
function isPersistentHealth(s){return ["OUT","IR","PUP","NFI","SUSPENDED"].includes(String(s||"").toUpperCase());}
function unresolvedHealth(s){return ["DOUBTFUL","QUESTIONABLE","DNP_PRACTICE","LIMITED"].includes(String(s||"").toUpperCase());}
function availabilityProbability(s){
 return ({AVAILABLE:1,ACTIVE:1,LIMITED:.88,QUESTIONABLE:.65,DNP_PRACTICE:.58,DOUBTFUL:.18,OUT:0,IR:0,PUP:0,NFI:0,SUSPENDED:0})[String(s||"").toUpperCase()]??.75;
}
function stateConfidence(s,carried=false){
 if(carried)return isPersistentHealth(s)?.78:.62;
 if(["OUT","IR","PUP","NFI","SUSPENDED","AVAILABLE"].includes(s))return .98;
 if(s==="DOUBTFUL")return .94;
 if(s==="QUESTIONABLE")return .90;
 if(s==="DNP_PRACTICE")return .84;
 if(s==="LIMITED")return .82;
 return .65;
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
 if(/concussion/.test(s))return"CONCUSSION";
 if(/illness/.test(s))return"ILLNESS";
 return detail?"OTHER":"NONE";
}
export function injurySeverityClass(status,detail){
 const s=String(status||"").toUpperCase();
 if(["IR","PUP","NFI"].includes(s))return "EXTENDED_ABSENCE";
 if(s==="OUT")return "UNAVAILABLE";
 if(s==="DOUBTFUL")return "HIGH_AVAILABILITY_RISK";
 if(["QUESTIONABLE","DNP_PRACTICE"].includes(s))return "ELEVATED_AVAILABILITY_RISK";
 if(s==="LIMITED")return "MANAGED_PARTICIPATION";
 if(s==="AVAILABLE")return detail?"CLEARED_WITH_REPORTED_ISSUE":"CLEAR";
 return "UNKNOWN";
}
function roleFor(position,usage,depthRank){
 const p=String(position||"").toUpperCase();
 if(depthRank===1)return p+"1";
 if(depthRank===2)return p+"2";
 const snap=finite(usage?.snapShare);
 if(p==="QB")return snap!=null&&snap>.45?"QB1":"QB_DEPTH";
 if(p==="RB")return snap!=null&&snap>.52?"RB1":snap!=null&&snap>.20?"RB2":"RB_DEPTH";
 if(p==="WR")return snap!=null&&snap>.70?"WR1":snap!=null&&snap>.48?"WR2":snap!=null&&snap>.25?"WR3":"WR_DEPTH";
 if(p==="TE")return snap!=null&&snap>.55?"TE1":snap!=null&&snap>.25?"TE2":"TE_DEPTH";
 return p? p+"_ROSTER":"ROSTER";
}
function inferDepth(players){
 const groups=new Map();
 for(const p of players){
  const pos=String(p.position||"UNK").toUpperCase();
  if(!groups.has(pos))groups.set(pos,[]);
  groups.get(pos).push(p);
 }
 for(const arr of groups.values()){
  arr.sort((a,b)=>(finite(b.usage?.snapShare)||0)-(finite(a.usage?.snapShare)||0) || (finite(b.usage?.opportunity)||0)-(finite(a.usage?.opportunity)||0));
  arr.forEach((p,i)=>{p.depthRank=i+1;});
 }
 return players;
}
function matchUsage(rosterPlayer,usageRows=[]){
 const id=String(rosterPlayer.id||"");
 return usageRows.find(x=>id&&String(x.id||"")===id)||usageRows.find(x=>normName(x.name)===normName(rosterPlayer.name))||null;
}
function replacementMap(player,allPlayers){
 const pos=String(player.position||"").toUpperCase();
 return allPlayers.filter(x=>x.playerKey!==player.playerKey&&String(x.position||"").toUpperCase()===pos&&x.healthState!=="OUT")
   .sort((a,b)=>(finite(b.expectedSnapShare)||0)-(finite(a.expectedSnapShare)||0))
   .slice(0,3).map(x=>({playerKey:x.playerKey,name:x.playerName,role:x.roleLabel,expectedSnapShare:x.expectedSnapShare}));
}

async function fetchJson(url,{timeoutMs=9000}={}){
 const c=new AbortController(),t=setTimeout(()=>c.abort("source-timeout"),timeoutMs);
 try{
  const r=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-Personal-Projection-System/1.0"},signal:c.signal});
  if(!r.ok)return{ok:false,status:r.status,url,data:null};
  return{ok:true,status:r.status,url,data:await r.json()};
 }catch(err){return{ok:false,status:null,url,data:null,error:String(err?.message||err)};}
 finally{clearTimeout(t);}
}
async function sourceForTeam(team,season){
 const id=team.espnId;
 const [roster,schedule,info,coaches,depthcharts]=await Promise.all([
  fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`),
  fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/schedule?season=${season}`),
  fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}`),
  fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${id}/coaches`),
  fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/teams/${id}/depthcharts`),
 ]);
 return{roster,schedule,info,coaches,depthcharts};
}
async function queryRows(db,sql,...binds){
 if(!db?.prepare)return[];
 try{return (await db.prepare(sql).bind(...binds).all())?.results||[];}catch{return[];}
}
async function existingPlayers(db,tkey){
 return queryRows(db,"SELECT * FROM nfl_player_profiles WHERE team_key = ?",tkey);
}
async function latestAvailability(db,tkey){
 return queryRows(db,`SELECT * FROM player_availability_observations
   WHERE sport='nfl' AND team_key=? AND observed_at>=?
   ORDER BY observed_at DESC LIMIT 300`,tkey,new Date(Date.now()-75*86400000).toISOString());
}
async function upsertPlayers(db,rows){
 if(!db?.prepare||!rows.length)return{ok:false,rows:0,reason:"db-or-rows-missing"};
 const sql=`INSERT INTO nfl_player_profiles (
  player_key,team_key,player_id,player_name,position,jersey,roster_status,depth_rank,role_label,
  last_known_snap_share,health_state,practice_state,injury_detail,injury_onset_at,injury_type,injury_severity_class,
  expected_return_state,expected_snap_share,state_confidence,state_source,state_source_updated_at,
  last_game_played_at,last_game_snap_share,replacement_json,active_confirmation_at,carried_state,updated_at,raw_json
 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(player_key) DO UPDATE SET
  team_key=excluded.team_key,player_id=excluded.player_id,player_name=excluded.player_name,position=excluded.position,
  jersey=excluded.jersey,roster_status=excluded.roster_status,depth_rank=excluded.depth_rank,role_label=excluded.role_label,
  last_known_snap_share=excluded.last_known_snap_share,health_state=excluded.health_state,practice_state=excluded.practice_state,
  injury_detail=excluded.injury_detail,injury_onset_at=excluded.injury_onset_at,injury_type=excluded.injury_type,injury_severity_class=excluded.injury_severity_class,
  expected_return_state=excluded.expected_return_state,expected_snap_share=excluded.expected_snap_share,
  state_confidence=excluded.state_confidence,state_source=excluded.state_source,state_source_updated_at=excluded.state_source_updated_at,
  last_game_played_at=excluded.last_game_played_at,last_game_snap_share=excluded.last_game_snap_share,
  replacement_json=excluded.replacement_json,active_confirmation_at=excluded.active_confirmation_at,
  carried_state=excluded.carried_state,updated_at=excluded.updated_at,raw_json=excluded.raw_json`;
 const stmts=rows.map(r=>db.prepare(sql).bind(
  r.playerKey,r.teamKey,r.playerId,r.playerName,r.position,r.jersey,r.rosterStatus,r.depthRank,r.roleLabel,
  r.lastKnownSnapShare,r.healthState,r.practiceState,r.injuryDetail,r.injuryOnsetAt,r.injuryType,r.injurySeverityClass,
  r.expectedReturnState,r.expectedSnapShare,r.stateConfidence,r.stateSource,r.stateSourceUpdatedAt,
  r.lastGamePlayedAt,r.lastGameSnapShare,JSON.stringify(r.replacements||[]),r.activeConfirmationAt,r.carriedState?1:0,r.updatedAt,JSON.stringify(r.raw||{})
 ));
 for(let i=0;i<stmts.length;i+=75)await db.batch(stmts.slice(i,i+75));
 return{ok:true,rows:rows.length};
}
async function upsertSchedule(db,rows){
 if(!db?.prepare||!rows.length)return{ok:false,rows:0,reason:"db-or-rows-missing"};
 const sql=`INSERT INTO nfl_team_schedule_profile (
  id,season,team_key,event_id,week,season_type,start_time,home_team_key,away_team_key,opponent_key,site,
  venue_name,venue_city,neutral_site,international,days_rest,short_week,post_bye,road_trip_game_number,
  road_games_last_4,three_road_in_four,travel_miles,time_zones_crossed,altitude_feet,schedule_stress_score,
  stress_flags_json,source_updated_at,raw_json
 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET
  week=excluded.week,season_type=excluded.season_type,start_time=excluded.start_time,home_team_key=excluded.home_team_key,
  away_team_key=excluded.away_team_key,opponent_key=excluded.opponent_key,site=excluded.site,venue_name=excluded.venue_name,
  venue_city=excluded.venue_city,neutral_site=excluded.neutral_site,international=excluded.international,
  days_rest=excluded.days_rest,short_week=excluded.short_week,post_bye=excluded.post_bye,
  road_trip_game_number=excluded.road_trip_game_number,road_games_last_4=excluded.road_games_last_4,
  three_road_in_four=excluded.three_road_in_four,travel_miles=excluded.travel_miles,time_zones_crossed=excluded.time_zones_crossed,
  altitude_feet=excluded.altitude_feet,schedule_stress_score=excluded.schedule_stress_score,
  stress_flags_json=excluded.stress_flags_json,source_updated_at=excluded.source_updated_at,raw_json=excluded.raw_json`;
 const stmts=rows.map(r=>db.prepare(sql).bind(
  r.id,r.season,r.teamKey,r.eventId,r.week,r.seasonType,r.start_time,r.homeTeamKey,r.awayTeamKey,r.opponentKey,r.site,
  r.venueName,r.venueCity,r.neutralSite?1:0,r.international?1:0,r.daysRest,r.shortWeek?1:0,r.postBye?1:0,r.roadTripGameNumber,
  r.roadGamesLast4,r.threeRoadInFour?1:0,r.travelMiles,r.timeZonesCrossed,r.altitudeFeet,r.scheduleStressScore,
  JSON.stringify(r.stressFlags||[]),r.sourceUpdatedAt,JSON.stringify(r.raw||{})
 ));
 for(let i=0;i<stmts.length;i+=75)await db.batch(stmts.slice(i,i+75));
 return{ok:true,rows:rows.length};
}
async function upsertTeam(db,r){
 const sql=`INSERT INTO nfl_team_profiles (
  team_key,team_name,espn_team_id,season,head_coach,offensive_coordinator,defensive_coordinator,coach_source,
  roster_count,injured_count,out_count,questionable_count,doubtful_count,limited_count,practice_dnp_count,
  next_game_id,next_game_start,next_opponent_key,next_site,days_rest,short_week,post_bye,road_trip_game_number,
  road_games_last_4,three_road_in_four,travel_miles,time_zones_crossed,altitude_feet,international,
  schedule_stress_score,schedule_flags_json,identity_json,updated_at,source_updated_at,source_json
 ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(team_key) DO UPDATE SET
  team_name=excluded.team_name,espn_team_id=excluded.espn_team_id,season=excluded.season,head_coach=excluded.head_coach,
  offensive_coordinator=excluded.offensive_coordinator,defensive_coordinator=excluded.defensive_coordinator,
  coach_source=excluded.coach_source,roster_count=excluded.roster_count,injured_count=excluded.injured_count,
  out_count=excluded.out_count,questionable_count=excluded.questionable_count,doubtful_count=excluded.doubtful_count,
  limited_count=excluded.limited_count,practice_dnp_count=excluded.practice_dnp_count,next_game_id=excluded.next_game_id,
  next_game_start=excluded.next_game_start,next_opponent_key=excluded.next_opponent_key,next_site=excluded.next_site,
  days_rest=excluded.days_rest,short_week=excluded.short_week,post_bye=excluded.post_bye,
  road_trip_game_number=excluded.road_trip_game_number,road_games_last_4=excluded.road_games_last_4,
  three_road_in_four=excluded.three_road_in_four,travel_miles=excluded.travel_miles,
  time_zones_crossed=excluded.time_zones_crossed,altitude_feet=excluded.altitude_feet,international=excluded.international,
  schedule_stress_score=excluded.schedule_stress_score,schedule_flags_json=excluded.schedule_flags_json,
  identity_json=excluded.identity_json,updated_at=excluded.updated_at,source_updated_at=excluded.source_updated_at,
  source_json=excluded.source_json`;
 await db.prepare(sql).bind(
  r.teamKey,r.teamName,r.espnTeamId,r.season,r.headCoach,r.offensiveCoordinator,r.defensiveCoordinator,r.coachSource,
  r.rosterCount,r.injuredCount,r.outCount,r.questionableCount,r.doubtfulCount,r.limitedCount,r.practiceDnpCount,
  r.nextGameId,r.nextGameStart,r.nextOpponentKey,r.nextSite,r.daysRest,r.shortWeek?1:0,r.postBye?1:0,r.roadTripGameNumber,
  r.roadGamesLast4,r.threeRoadInFour?1:0,r.travelMiles,r.timeZonesCrossed,r.altitudeFeet,r.international?1:0,
  r.scheduleStressScore,JSON.stringify(r.scheduleFlags||[]),JSON.stringify(r.identity||{}),r.updatedAt,r.sourceUpdatedAt,JSON.stringify(r.source||{})
 ).run();
}
function stateEvidenceRank(source){
 const s=String(source||"").toLowerCase();
 if(s.includes("game-participation"))return 95;
 if(s.includes("nfl-official"))return 90;
 if(s.includes("roster"))return 30;
 if(s.includes("persistent"))return 20;
 return 10;
}
function eventIdForState(p){
 return ["nfl-state",p.playerKey,p.healthState,p.practiceState||"none",p.stateSourceUpdatedAt||p.updatedAt]
   .join(":").toLowerCase().replace(/[^a-z0-9:_-]+/g,"-").slice(0,240);
}
async function persistProfileHistory(db,{profile,states,schedule,prior}){
 if(!db?.prepare)return;
 const now=profile.updatedAt||new Date().toISOString();
 const eventSql=`INSERT OR IGNORE INTO nfl_player_state_events
  (id,player_key,player_name,team_key,event_type,health_state,practice_state,injury_detail,source,source_timestamp,evidence_rank,raw_json,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;
 const changed=[];
 for(const p of states||[]){
  const old=prior?.get?.(normName(p.playerName))||null;
  const stateChanged=!old ||
    String(old.health_state||"")!==String(p.healthState||"") ||
    String(old.practice_state||"")!==String(p.practiceState||"") ||
    String(old.injury_detail||"")!==String(p.injuryDetail||"") ||
    String(old.state_source||"")!==String(p.stateSource||"");
  if(!stateChanged)continue;
  changed.push(db.prepare(eventSql).bind(
    eventIdForState(p),p.playerKey,p.playerName,p.teamKey,
    p.carriedState?"CARRIED_STATE":"STATE_UPDATE",p.healthState,p.practiceState,p.injuryDetail,
    p.stateSource,p.stateSourceUpdatedAt||now,stateEvidenceRank(p.stateSource),JSON.stringify(p.raw||{}),now
  ));
 }
 for(let i=0;i<changed.length;i+=75)await db.batch(changed.slice(i,i+75));

 const coaches=[
  ["HEAD_COACH",profile.headCoach],
  ["OFFENSIVE_COORDINATOR",profile.offensiveCoordinator],
  ["DEFENSIVE_COORDINATOR",profile.defensiveCoordinator],
 ].filter(([,name])=>name);
 if(coaches.length){
  const sql=`INSERT OR IGNORE INTO nfl_team_coach_history
   (id,team_key,season,coach_name,role,observed_at,source,raw_json,created_at)
   VALUES (?,?,?,?,?,?,?,?,?)`;
  await db.batch(coaches.map(([role,name])=>db.prepare(sql).bind(
    ["nfl-coach",profile.season,profile.teamKey,role,normName(name)].join(":"),
    profile.teamKey,profile.season,name,role,now,profile.coachSource||"espn",JSON.stringify(profile.source||{}),now
  )));
 }

 const snapshot={
  ...profile,
  players:(states||[]).map(p=>({
    playerKey:p.playerKey,playerName:p.playerName,position:p.position,depthRank:p.depthRank,roleLabel:p.roleLabel,
    healthState:p.healthState,practiceState:p.practiceState,injuryDetail:p.injuryDetail,injuryType:p.injuryType,
    expectedSnapShare:p.expectedSnapShare,stateConfidence:p.stateConfidence,stateSource:p.stateSource,
    stateSourceUpdatedAt:p.stateSourceUpdatedAt,carriedState:p.carriedState,replacements:p.replacements||[],
  })),
  schedule:(schedule||[]).map(r=>({
    eventId:r.eventId,startTime:r.start_time,opponentKey:r.opponentKey,site:r.site,daysRest:r.daysRest,
    shortWeek:r.shortWeek,postBye:r.postBye,travelMiles:r.travelMiles,timeZonesCrossed:r.timeZonesCrossed,
    international:r.international,scheduleStressScore:r.scheduleStressScore,stressFlags:r.stressFlags||[],
  })),
 };
 const sid=["nfl-profile-snapshot",profile.season,profile.teamKey,now].join(":");
 await db.prepare(`INSERT OR IGNORE INTO nfl_team_profile_snapshots
   (id,team_key,season,as_of,profile_json,created_at) VALUES (?,?,?,?,?,?)`)
   .bind(sid,profile.teamKey,profile.season,now,JSON.stringify(snapshot),now).run();
}

async function recordRun(db,r){
 if(!db?.prepare)return;
 await db.prepare(`INSERT OR REPLACE INTO nfl_profile_sync_runs
 (id,season,team_key,status,source,started_at,completed_at,roster_rows,schedule_rows,injury_rows,player_rows_upserted,schedule_rows_upserted,error,meta_json)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
  r.id,r.season,r.teamKey,r.status,r.source,r.startedAt,r.completedAt,r.rosterRows||0,r.scheduleRows||0,r.injuryRows||0,
  r.playerRowsUpserted||0,r.scheduleRowsUpserted||0,r.error||null,JSON.stringify(r.meta||{})
 ).run();
}

export async function applyNflAvailabilityToProfiles(env={},rows=[]){
 if(!env?.DB?.prepare||!Array.isArray(rows)||!rows.length)return{ok:false,updated:0,reason:"db-or-rows-missing"};
 const teams=[...new Set(rows.map(r=>String(r.teamKey||r.team_key||"").toLowerCase()).filter(Boolean))];
 if(!teams.length)return{ok:false,updated:0,reason:"team-keys-missing"};
 const marks=teams.map(()=>"?").join(",");
 const existing=await queryRows(env.DB,`SELECT * FROM nfl_player_profiles WHERE team_key IN (${marks})`,...teams);
 const byTeamName=new Map(existing.map(r=>[`${r.team_key}|${normName(r.player_name)}`,r]));
 const stmts=[];
 let matched=0;
 for(const row of rows){
  const t=String(row.teamKey||row.team_key||"").toLowerCase(),name=clean(row.playerName||row.player_name);
  const current=byTeamName.get(`${t}|${normName(name)}`);
  if(!current)continue;
  const health=healthFromOfficial({status:row.status});
  if(!health)continue;
  const sourceAt=row.sourceUpdatedAt||row.source_updated_at||row.observedAt||row.observed_at||new Date().toISOString();
  const injury=row.injuryDetail||row.injury_detail||null;
  const practice=row.practiceStatus||row.practice_status||null;
  const snap=finite(current.last_known_snap_share);
  const expected=snap==null?null:round(snap*availabilityProbability(health),3);
  const onset=health==="AVAILABLE"?current.injury_onset_at:(current.injury_onset_at||sourceAt);
  const active=health==="AVAILABLE"?sourceAt:current.active_confirmation_at;
  stmts.push(env.DB.prepare(`UPDATE nfl_player_profiles SET
    health_state=?,practice_state=?,injury_detail=?,injury_onset_at=?,injury_type=?,injury_severity_class=?,
    expected_return_state=?,expected_snap_share=?,state_confidence=?,state_source=?,state_source_updated_at=?,
    active_confirmation_at=?,carried_state=0,updated_at=?
    WHERE player_key=?`).bind(
      health,practice,injury,onset,injuryType(injury),injurySeverityClass(health,injury),
      isPersistentHealth(health)?"RETURN_PENDING":unresolvedHealth(health)?"STATUS_PENDING":"AVAILABLE",
      expected,stateConfidence(health,false),"nfl-official",sourceAt,active,new Date().toISOString(),current.player_key
  ));
  matched++;
 }
 for(let i=0;i<stmts.length;i+=75)await env.DB.batch(stmts.slice(i,i+75));
 return{ok:true,updated:matched,teams:teams.length};
}

export async function syncNflTeamProfile(env={},abbr,{season=seasonYear(),nowMs=Date.now(),nflverse=null}={}){
 const startedAt=new Date(nowMs).toISOString(),team=teamRegistry(abbr),runId=`nfl-profile:${season}:${teamKey(abbr)}:${startedAt}`;
 if(!team)return{ok:false,team:abbr,reason:"unknown-team"};
 if(!env?.DB?.prepare)return{ok:false,team:abbr,reason:"database-unavailable"};
 try{
  const [src,existing,availability,verse]=await Promise.all([
   sourceForTeam(team,season),
   existingPlayers(env.DB,teamKey(team.abbr)),
   latestAvailability(env.DB,teamKey(team.abbr)),
   nflverse||loadNflVerseFeatures(env).catch(()=>({playersByTeam:{},byTeam:{},meta:{}})),
  ]);
  if(!src.roster.ok||!src.schedule.ok){
   const reason=`source-unavailable roster=${src.roster.status||src.roster.error||"error"} schedule=${src.schedule.status||src.schedule.error||"error"}`;
   await recordRun(env.DB,{id:runId,season,teamKey:teamKey(team.abbr),status:"FAILED",source:NFL_PROFILE_SOURCE,startedAt,completedAt:new Date().toISOString(),error:reason});
   return{ok:false,team:team.abbr,reason};
  }

  const roster=parseNflRoster(src.roster.data),events=scheduleEvents(src.schedule.data);
  const schedule=buildScheduleProfile(events,team.abbr,season,nowMs);
  const official=latestByPlayer(availability),prior=new Map(existing.map(x=>[normName(x.player_name),x]));
  const usageRows=verse?.playersByTeam?.[canon(team.abbr)]||[];
  const depthRanks=src.depthcharts.ok?parseDepthRanks(src.depthcharts.data):new Map();
  const players=inferDepth(roster.map(p=>({roster:p,usage:matchUsage(p,usageRows),position:p.position})));
  for(const x of players){
   const officialDepth=depthRanks.get(String(x.roster.id||""));
   if(officialDepth!=null)x.depthRank=officialDepth;
  }
  const currentTeamReportAt=availability.reduce((m,r)=>String(r.observed_at||"")>m?String(r.observed_at||""):m,"");

  const states=players.map(x=>{
   const p=x.roster,u=x.usage,off=official.get(normName(p.name))||null,old=prior.get(normName(p.name))||null;
   const oldState=String(old?.health_state||"UNKNOWN").toUpperCase();
   let health=healthFromOfficial(off),carried=false,source="roster-presence",sourceAt=startedAt,practice=null,injury=null,onset=old?.injury_onset_at||null,activeConfirmed=old?.active_confirmation_at||null;
   if(off){
    source=off.source||"nfl-official";sourceAt=off.source_updated_at||off.observed_at||startedAt;
    practice=off.practice_status||null;injury=off.injury_detail||null;
    if(health&&health!=="AVAILABLE"&&!onset)onset=sourceAt;
    if(health==="AVAILABLE")activeConfirmed=sourceAt;
   }else if(isPersistentHealth(oldState)){
    const oldAt=String(old?.state_source_updated_at||old?.updated_at||"");
    const lastPlayed=String(u?.recentGames?.[0]?.date||"");
    if(lastPlayed && oldAt && Date.parse(lastPlayed)>Date.parse(oldAt)){
      health="AVAILABLE";source="nflverse-game-participation";sourceAt=lastPlayed;activeConfirmed=lastPlayed;practice=null;injury=old?.injury_detail||null;
    }else{
      health=oldState;carried=true;source=old?.state_source||"persistent-profile";sourceAt=oldAt||startedAt;
      practice=old?.practice_state||null;injury=old?.injury_detail||null;
    }
   }else if(unresolvedHealth(oldState) && (!currentTeamReportAt || currentTeamReportAt<=String(old?.state_source_updated_at||old?.updated_at||""))){
    health=oldState;carried=true;source=old?.state_source||"persistent-profile";sourceAt=old?.state_source_updated_at||old?.updated_at||startedAt;
    practice=old?.practice_state||null;injury=old?.injury_detail||null;
   }else{
    health="AVAILABLE";
    if(currentTeamReportAt)activeConfirmed=currentTeamReportAt;
   }
   const snap=finite(u?.snapShare),expected=snap==null?null:round(snap*availabilityProbability(health),3);
   const lastGame=u?.recentGames?.[0]||null;
   return{
    playerKey:playerKey(team.abbr,p),teamKey:teamKey(team.abbr),playerId:p.id||null,playerName:p.name,position:p.position||null,
    jersey:p.jersey,rosterStatus:p.rosterStatus,depthRank:x.depthRank,roleLabel:roleFor(p.position,u,x.depthRank),
    lastKnownSnapShare:snap,healthState:health||"UNKNOWN",practiceState:practice,injuryDetail:injury,injuryOnsetAt:onset,
    injuryType:injuryType(injury),injurySeverityClass:injurySeverityClass(health,injury),expectedReturnState:isPersistentHealth(health)?"RETURN_PENDING":unresolvedHealth(health)?"STATUS_PENDING":"AVAILABLE",
    expectedSnapShare:expected,stateConfidence:stateConfidence(health,carried),stateSource:source,stateSourceUpdatedAt:sourceAt,
    lastGamePlayedAt:lastGame?.date||null,lastGameSnapShare:snap,activeConfirmationAt:activeConfirmed,carriedState:carried,
    updatedAt:startedAt,raw:{roster:p.raw||{},usage:u||null,officialAvailability:off||null},
   };
  });
  for(const p of states)p.replacements=replacementMap(p,states);

  const now=nowMs,next=schedule.find(x=>Date.parse(x.start_time)>now)||null;
  const coaches=parseCoach({
   ...(src.info.data||{}),
   coach:src.roster.data?.coach||null,
   coreCoaches:src.coaches.data||null,
  });
  const counts={};
  for(const p of states)counts[p.healthState]=(counts[p.healthState]||0)+1;
  const identity=verse?.byTeam?.[canon(team.abbr)]||{};
  const profile={
   teamKey:teamKey(team.abbr),teamName:team.displayName,espnTeamId:String(team.espnId),season,
   headCoach:coaches.headCoach,offensiveCoordinator:coaches.offensiveCoordinator,defensiveCoordinator:coaches.defensiveCoordinator,
   coachSource:src.coaches.ok||src.roster.ok?"espn":"unavailable",rosterCount:states.length,
   injuredCount:states.filter(p=>p.healthState!=="AVAILABLE").length,outCount:(counts.OUT||0)+(counts.IR||0)+(counts.PUP||0)+(counts.NFI||0)+(counts.SUSPENDED||0),
   questionableCount:counts.QUESTIONABLE||0,doubtfulCount:counts.DOUBTFUL||0,limitedCount:counts.LIMITED||0,practiceDnpCount:counts.DNP_PRACTICE||0,
   nextGameId:next?.eventId||null,nextGameStart:next?.start_time||null,nextOpponentKey:next?.opponentKey||null,nextSite:next?.site||null,
   daysRest:next?.daysRest??null,shortWeek:Boolean(next?.shortWeek),postBye:Boolean(next?.postBye),roadTripGameNumber:next?.roadTripGameNumber??null,
   roadGamesLast4:next?.roadGamesLast4??null,threeRoadInFour:Boolean(next?.threeRoadInFour),travelMiles:next?.travelMiles??null,
   timeZonesCrossed:next?.timeZonesCrossed??null,altitudeFeet:next?.altitudeFeet??null,international:Boolean(next?.international),
   scheduleStressScore:next?.scheduleStressScore??null,scheduleFlags:next?.stressFlags||[],identity,
   updatedAt:startedAt,sourceUpdatedAt:startedAt,source:{profileVersion:NFL_PROFILE_VERSION,roster:src.roster.url,schedule:src.schedule.url,team:src.info.url,coaches:src.coaches.url,depthcharts:src.depthcharts.url,nflverse:verse?.meta||null},
  };

  const [pWrite,sWrite]=await Promise.all([upsertPlayers(env.DB,states),upsertSchedule(env.DB,schedule)]);
  await upsertTeam(env.DB,profile);
  await persistProfileHistory(env.DB,{profile,states,schedule,prior});
  await recordRun(env.DB,{id:runId,season,teamKey:profile.teamKey,status:"SUCCESS",source:NFL_PROFILE_SOURCE,startedAt,completedAt:new Date().toISOString(),rosterRows:roster.length,scheduleRows:schedule.length,injuryRows:availability.length,playerRowsUpserted:pWrite.rows,scheduleRowsUpserted:sWrite.rows,meta:{nextGame:next?.eventId||null,coachRows:coaches.found.length}});

  return{ok:true,team:team.abbr,season,profile,players:states.length,schedule:schedule.length,injuryObservations:availability.length,coaches:{headCoach:profile.headCoach,offensiveCoordinator:profile.offensiveCoordinator,defensiveCoordinator:profile.defensiveCoordinator}};
 }catch(err){
  const reason=String(err?.message||err);
  await recordRun(env.DB,{id:runId,season,teamKey:teamKey(team.abbr),status:"FAILED",source:NFL_PROFILE_SOURCE,startedAt,completedAt:new Date().toISOString(),error:reason}).catch(()=>{});
  return{ok:false,team:team.abbr,reason};
 }
}

export async function loadNflTeamProfiles(db,teamKeys=[]){
 if(!db?.prepare)return{teams:{},players:{},schedule:{}};
 const keys=[...new Set((teamKeys||[]).map(x=>String(x||"").toLowerCase()).filter(Boolean))];
 if(!keys.length)return{teams:{},players:{},schedule:{}};
 const marks=keys.map(()=>"?").join(",");
 const [tr,pr,sr]=await Promise.all([
  queryRows(db,`SELECT * FROM nfl_team_profiles WHERE team_key IN (${marks})`,...keys),
  queryRows(db,`SELECT * FROM nfl_player_profiles WHERE team_key IN (${marks})`,...keys),
  queryRows(db,`SELECT * FROM nfl_team_schedule_profile WHERE team_key IN (${marks}) ORDER BY start_time ASC`,...keys),
 ]);
 return{
  teams:Object.fromEntries(tr.map(r=>[r.team_key,r])),
  players:Object.fromEntries(keys.map(k=>[k,pr.filter(r=>r.team_key===k)])),
  schedule:Object.fromEntries(keys.map(k=>[k,sr.filter(r=>r.team_key===k)])),
 };
}

function compactScheduleContext(rows=[],nowMs=Date.now()){
 const upcoming=(rows||[]).filter(r=>Date.parse(r.start_time||0)>=nowMs).slice(0,8);
 const weakSpots=upcoming.filter(r=>Number(r.schedule_stress_score||0)>=.2)
   .sort((a,b)=>Number(b.schedule_stress_score||0)-Number(a.schedule_stress_score||0))
   .slice(0,5);
 return {upcoming,weakSpots};
}

export function attachNflPersistentProfiles(games=[],profiles={}){
 return (games||[]).map(game=>{
  const hk=teamKey(game?.home?.abbr),ak=teamKey(game?.away?.abbr);
  const home=profiles?.teams?.[hk]||null,away=profiles?.teams?.[ak]||null;
  const hs=compactScheduleContext(profiles?.schedule?.[hk]||[]);
  const as=compactScheduleContext(profiles?.schedule?.[ak]||[]);
  return{
   ...game,
   nflPersistentProfile:{
    version:NFL_PROFILE_VERSION,
    home:home?{...home,players:profiles?.players?.[hk]||[],schedule:hs}:null,
    away:away?{...away,players:profiles?.players?.[ak]||[],schedule:as}:null,
    configured:Boolean(home&&away),
    researchOnlyScheduleStress:true,
   },
  };
 });
}
