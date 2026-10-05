/**
 * NHL persistent team/player operating profiles.
 *
 * Expensive official-source refresh runs out of band and persists to D1.
 * Projection requests only read compact persisted state. No sportsbook data is
 * used here and no profile can authorize a wager.
 */
import nhlTeams from "../../data/teams/nhl.js";

export const NHL_PERSISTENT_PROFILE_ID="NHL-PERSISTENT-PROFILE-v1";
export const NHL_PERSISTENT_PROFILE_VERSION="v1.0-official-roster-shifts-deployment";
export const NHL_PERSISTENT_PROFILE_SOURCE="NHL_OFFICIAL_API+ESPN_COACH_METADATA";

const WEB="https://api-web.nhle.com/v1";
const STATS="https://api.nhle.com/stats/rest/en";
const PROFILE_CACHE=new Map();
const PROFILE_CACHE_MS=60*1000;
const SOURCE_TIMEOUT_MS=6500;
const SOURCE_TOTAL_BUDGET_MS=13500;

const TO_OFFICIAL=Object.freeze({LA:"LAK",NJ:"NJD",SJ:"SJS",TB:"TBL"});
const FROM_OFFICIAL=Object.freeze({LAK:"LA",NJD:"NJ",SJS:"SJ",TBL:"TB"});
const ESPN_ABBR=Object.freeze({LA:"la",NJ:"nj",SJ:"sj",TB:"tb",UTA:"utah"});

const TEAM_GEO=Object.freeze({
 ANA:{lat:33.8078,lon:-117.8765,tz:"America/Los_Angeles"},BOS:{lat:42.3662,lon:-71.0621,tz:"America/New_York"},
 BUF:{lat:42.8750,lon:-78.8766,tz:"America/New_York"},CGY:{lat:51.0374,lon:-114.0519,tz:"America/Edmonton"},
 CAR:{lat:35.8033,lon:-78.7218,tz:"America/New_York"},CHI:{lat:41.8807,lon:-87.6742,tz:"America/Chicago"},
 COL:{lat:39.7487,lon:-105.0077,tz:"America/Denver"},CBJ:{lat:39.9693,lon:-83.0061,tz:"America/New_York"},
 DAL:{lat:32.7905,lon:-96.8103,tz:"America/Chicago"},DET:{lat:42.3411,lon:-83.0550,tz:"America/New_York"},
 EDM:{lat:53.5469,lon:-113.4977,tz:"America/Edmonton"},FLA:{lat:26.1584,lon:-80.3256,tz:"America/New_York"},
 LA:{lat:34.0430,lon:-118.2673,tz:"America/Los_Angeles"},MIN:{lat:44.9448,lon:-93.1011,tz:"America/Chicago"},
 MTL:{lat:45.4961,lon:-73.5693,tz:"America/Toronto"},NSH:{lat:36.1592,lon:-86.7785,tz:"America/Chicago"},
 NJ:{lat:40.7335,lon:-74.1710,tz:"America/New_York"},NYI:{lat:40.7229,lon:-73.5907,tz:"America/New_York"},
 NYR:{lat:40.7505,lon:-73.9934,tz:"America/New_York"},OTT:{lat:45.2969,lon:-75.9272,tz:"America/Toronto"},
 PHI:{lat:39.9012,lon:-75.1720,tz:"America/New_York"},PIT:{lat:40.4396,lon:-79.9892,tz:"America/New_York"},
 SEA:{lat:47.6221,lon:-122.3540,tz:"America/Los_Angeles"},SJ:{lat:37.3328,lon:-121.9012,tz:"America/Los_Angeles"},
 STL:{lat:38.6268,lon:-90.2026,tz:"America/Chicago"},TB:{lat:27.9427,lon:-82.4518,tz:"America/New_York"},
 TOR:{lat:43.6435,lon:-79.3791,tz:"America/Toronto"},UTA:{lat:40.7683,lon:-111.9011,tz:"America/Denver"},
 VAN:{lat:49.2778,lon:-123.1089,tz:"America/Vancouver"},VGK:{lat:36.1029,lon:-115.1784,tz:"America/Los_Angeles"},
 WSH:{lat:38.8981,lon:-77.0209,tz:"America/New_York"},WPG:{lat:49.8927,lon:-97.1437,tz:"America/Winnipeg"}
});

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function round(v,d=3){const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p;}
function clean(v){return String(v??"").replace(/\s+/g," ").trim();}
function safeName(v){if(typeof v==="string")return clean(v);return clean(v?.default||v?.en||"");}
function playerName(p={}){return clean(p.fullName||p.name?.default||[safeName(p.firstName),safeName(p.lastName)].filter(Boolean).join(" "));}
function productAbbr(v){const s=clean(v).toUpperCase();return FROM_OFFICIAL[s]||s;}
function officialAbbr(v){const s=clean(v).toUpperCase();return TO_OFFICIAL[s]||s;}
function teamKey(v){return productAbbr(v).toLowerCase();}
function seasonIdFor(date=new Date()){
 const d=date instanceof Date?date:new Date(date),y=d.getUTCFullYear(),m=d.getUTCMonth()+1,start=m>=7?y:y-1;
 return Number(`${start}${start+1}`);
}
function teamRecord(abbr){return nhlTeams.find(t=>String(t.abbr).toUpperCase()===productAbbr(abbr))||null;}
function playerKey(team,id,name){return `nhl:${teamKey(team)}:${String(id||clean(name).toLowerCase().replace(/[^a-z0-9]+/g,"-"))}`;}
function radians(v){return Number(v)*Math.PI/180;}
export function haversineMiles(a,b){
 if(!a||!b)return null;const R=3958.7613,dLat=radians(b.lat-a.lat),dLon=radians(b.lon-a.lon);
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
function zonesCrossed(a,b,iso){
 const x=a?.tz?tzOffsetMinutes(a.tz,iso):null,y=b?.tz?tzOffsetMinutes(b.tz,iso):null;
 return x==null||y==null?0:Math.round(Math.abs(y-x)/60);
}
function durationSeconds(v){
 if(v==null||v==="")return null;
 const n=Number(v);if(Number.isFinite(n))return n;
 const m=String(v).match(/^(?:(\d+):)?(\d+):(\d+)$/);
 if(m)return Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]);
 return null;
}
function clockInPeriod(v){
 const m=String(v||"").match(/^(\d+):(\d+)$/);return m?Number(m[1])*60+Number(m[2]):null;
}
function sourceUrl(path){return path.startsWith("http")?path:`${WEB}/${path.replace(/^\//,"")}`;}
async function fetchJson(url,{timeoutMs=SOURCE_TIMEOUT_MS}={}){
 const c=new AbortController(),t=setTimeout(()=>c.abort("nhl-profile-source-timeout"),timeoutMs);
 try{
  const r=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-PERSISTENT-PROFILE-v1/1.0"},signal:c.signal});
  if(!r.ok)return{ok:false,status:r.status,url,data:null,error:`HTTP_${r.status}`};
  return{ok:true,status:r.status,url,data:await r.json()};
 }catch(err){return{ok:false,status:null,url,data:null,error:String(err?.message||err)};}
 finally{clearTimeout(t);}
}
async function budget(promise,ms=SOURCE_TOTAL_BUDGET_MS){
 return Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve({__timeout:true}),ms))]);
}

function parseRoster(payload={}){
 const out=[];
 for(const [group,posHint] of [["forwards","F"],["defensemen","D"],["goalies","G"]]){
  for(const p of payload?.[group]||[]){
   const id=String(p.id||p.playerId||"");if(!id)continue;
   out.push({id,name:playerName(p),position:String(p.positionCode||posHint).toUpperCase(),sweater:String(p.sweaterNumber??"")||null,raw:p});
  }
 }
 return out;
}
function parseTeamDirectory(payload={}){
 const map=new Map();
 for(const r of payload?.data||[]){
  const abbr=productAbbr(r.rawTricode||r.triCode||r.teamAbbrev||r.teamAbbreviation);
  if(abbr)map.set(abbr,{id:String(r.id??r.teamId??""),name:r.fullName||r.teamFullName||null,raw:r});
 }
 return map;
}
function scheduleGames(payload={}){
 const rows=Array.isArray(payload?.games)?payload.games:[];
 return rows.map(g=>({
  id:String(g.id||""),season:finite(g.season),gameType:finite(g.gameType),state:String(g.gameState||""),
  start:g.startTimeUTC||null,home:productAbbr(g.homeTeam?.abbrev?.default??g.homeTeam?.abbrev),
  away:productAbbr(g.awayTeam?.abbrev?.default??g.awayTeam?.abbrev),
  venue:safeName(g.venue)||null,neutral:Boolean(g.neutralSite),raw:g,
 })).filter(g=>g.id&&g.home&&g.away&&g.start);
}
export function buildNhlScheduleProfile(games,abbr,seasonId,nowMs=Date.now()){
 const team=productAbbr(abbr),sorted=(games||[]).filter(g=>g.home===team||g.away===team).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 const rows=[];let roadStreak=0;
 for(let i=0;i<sorted.length;i++){
  const g=sorted[i],site=g.home===team?"HOME":"ROAD",opp=g.home===team?g.away:g.home;
  if(site==="ROAD")roadStreak++;else roadStreak=0;
  const prev=rows[i-1]||null,startMs=Date.parse(g.start),prevMs=prev?Date.parse(prev.startTime):null;
  const gapHours=Number.isFinite(prevMs)?(startMs-prevMs)/3600000:null;
  const rest=gapHours==null?null:Math.max(0,round(gapHours/24-1,1));
  const b2b=gapHours!=null&&gapHours<42;
  const recent3=rows.filter(r=>startMs-Date.parse(r.startTime)<=4*86400000).length+1;
  const recent4=rows.filter(r=>startMs-Date.parse(r.startTime)<=6*86400000).length+1;
  const threeInFour=recent3>=3,fourInSix=recent4>=4;
  const previousVenue=prev?TEAM_GEO[prev.homeTeam]:TEAM_GEO[team];
  const venue=TEAM_GEO[g.home]||TEAM_GEO[team];
  const miles=previousVenue&&venue?haversineMiles(previousVenue,venue):null;
  const zones=previousVenue&&venue?zonesCrossed(previousVenue,venue,g.start):0;
  const flags=[];
  if(b2b)flags.push("BACK_TO_BACK");if(threeInFour)flags.push("THREE_IN_FOUR");if(fourInSix)flags.push("FOUR_IN_SIX");
  if((miles||0)>=1500)flags.push("LONG_TRAVEL");if(zones>=2)flags.push("MULTI_TIME_ZONE");if(site==="ROAD"&&roadStreak>=4)flags.push("LONG_ROAD_TRIP");
  const stress=clamp((b2b ? .30 : 0)+(threeInFour ? .18 : 0)+(fourInSix ? .16 : 0)+((miles||0)>=1500 ? .14 : (miles||0)>=900 ? .07 : 0)+(zones>=2 ? .10 : zones===1 ? .04 : 0)+(roadStreak>=4 ? .10 : 0),0,1);
  rows.push({
   id:`nhl:${seasonId}:${teamKey(team)}:${g.id}`,seasonId,teamKey:teamKey(team),gameId:g.id,gameType:g.gameType,
   startTime:g.start,gameState:g.state,homeTeam: g.home,awayTeam:g.away,opponentKey:teamKey(opp),site,venueName:g.venue,
   neutralSite:g.neutral,daysRest:rest,backToBack:b2b,threeInFour,fourInSix,roadTripGameNumber:site==="ROAD"?roadStreak:0,
   travelMiles:round(miles,0),timeZonesCrossed:zones,scheduleStressScore:round(stress),stressFlags:flags,sourceUpdatedAt:new Date(nowMs).toISOString(),raw:g.raw
  });
 }
 return rows;
}
function statRows(payload){return Array.isArray(payload?.data)?payload.data:[];}
function statByPlayer(payload){
 const m=new Map();for(const r of statRows(payload)){const id=String(r.playerId||"");if(id)m.set(id,r);}return m;
}
function scratchIds(box={}){
 const out=new Set(),root=box?.boxscore?.scratches??box?.scratches??{};
 const scan=v=>{if(!v)return;if(Array.isArray(v)){for(const x of v)scan(x);return;}if(typeof v!=="object")return;const id=v.playerId??v.id;if(id!=null)out.add(String(id));for(const x of Object.values(v))if(x&&typeof x==="object")scan(x);};
 scan(root);return out;
}
function goalieStarterIds(box={}){
 const out=new Set();
 for(const side of ["homeTeam","awayTeam"]){
  const rows=box?.playerByGameStats?.[side]?.goalies||[];
  const sorted=rows.slice().sort((a,b)=>(durationSeconds(b.toi)||0)-(durationSeconds(a.toi)||0));
  if(sorted[0]?.playerId!=null)out.add(String(sorted[0].playerId));
 }
 return out;
}
function parseShiftRows(payload={},team){
 const want=officialAbbr(team),out=[];
 for(const r of payload?.data||[]){
  const abbr=String(r.teamAbbrev||r.teamAbbreviation||r.teamAbbrevCode||"").toUpperCase();
  if(abbr&&abbr!==want)continue;
  const id=String(r.playerId||"");if(!id)continue;
  const period=finite(r.period)||1,start=clockInPeriod(r.startTime),end=clockInPeriod(r.endTime),dur=durationSeconds(r.duration);
  let a=start,b=end;
  if(a!=null&&b!=null&&b<a)b+=20*60;
  const offset=(period-1)*20*60;
  if(a!=null)a+=offset;if(b!=null)b+=offset;
  if((a==null||b==null)&&dur!=null&&start!=null){a=offset+start;b=a+dur;}
  if(a==null||b==null||b<=a)continue;
  out.push({playerId:id,start:a,end:b,duration:b-a,period,raw:r});
 }
 return out;
}
function overlap(a,b){return Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start));}
function deploymentFromShifts(roster,shiftSets=[]){
 const intervals=new Map(),gamesByPlayer=new Map();
 for(const set of shiftSets){
  const seen=new Set();
  for(const s of set.rows||[]){
   if(!intervals.has(s.playerId))intervals.set(s.playerId,[]);
   intervals.get(s.playerId).push({...s,gameId:set.gameId});
   seen.add(s.playerId);
  }
  for(const id of seen)gamesByPlayer.set(id,(gamesByPlayer.get(id)||0)+1);
 }
 const toi=new Map();
 for(const [id,arr] of intervals)toi.set(id,arr.reduce((n,x)=>n+x.duration,0));
 const pairs=new Map(),ids=[...intervals.keys()];
 for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
  const a=ids[i],b=ids[j],aa=intervals.get(a),bb=intervals.get(b);let sec=0,lastGame=null;
  for(const x of aa)for(const y of bb)if(x.gameId===y.gameId){const z=overlap(x,y);if(z){sec+=z;lastGame=x.gameId;}}
  if(sec>0)pairs.set(a+"|"+b,{a,b,seconds:sec,lastGame});
 }
 const pairSec=(a,b)=>pairs.get([a,b].sort().join("|"))?.seconds||0;
 const rosterById=new Map(roster.map(p=>[p.id,p]));
 const forwards=[...toi.keys()].filter(id=>rosterById.get(id)?.position!=="D"&&rosterById.get(id)?.position!=="G").sort((a,b)=>(toi.get(b)||0)-(toi.get(a)||0)).slice(0,12);
 const defense=[...toi.keys()].filter(id=>rosterById.get(id)?.position==="D").sort((a,b)=>(toi.get(b)||0)-(toi.get(a)||0)).slice(0,6);
 const lines=new Map(),pairsOut=new Map();
 let remain=[...forwards],line=1;
 while(remain.length&&line<=4){
  const seed=remain.shift();if(!seed)break;
  const cand=remain.map(id=>({id,score:pairSec(seed,id)})).sort((a,b)=>b.score-a.score);
  const b=cand[0]?.id||remain[0],c=remain.filter(x=>x!==b).map(id=>({id,score:pairSec(seed,id)+pairSec(b,id)})).sort((a,b)=>b.score-a.score)[0]?.id||remain.find(x=>x!==b);
  for(const id of [seed,b,c].filter(Boolean)){lines.set(id,{evLine:line,dPair:null});remain=remain.filter(x=>x!==id);}
  line++;
 }
 remain=[...defense];let dp=1;
 while(remain.length&&dp<=3){
  const seed=remain.shift();if(!seed)break;
  const mate=remain.map(id=>({id,score:pairSec(seed,id)})).sort((a,b)=>b.score-a.score)[0]?.id||remain[0];
  lines.set(seed,{evLine:null,dPair:dp});if(mate){lines.set(mate,{evLine:null,dPair:dp});remain=remain.filter(x=>x!==mate);}dp++;
 }
 for(const [k,p] of pairs){
  const ta=toi.get(p.a)||1,tb=toi.get(p.b)||1;
  pairsOut.set(k,{...p,gamesSample:Math.max(gamesByPlayer.get(p.a)||0,gamesByPlayer.get(p.b)||0),overlapShare:clamp(p.seconds/Math.max(1,Math.min(ta,tb)),0,1)});
 }
 return {lines,toi,pairs:pairsOut,gamesByPlayer};
}
function ppPkUnits(roster,timeById){
 const pp=roster.filter(p=>p.position!=="G").map(p=>({id:p.id,v:finite(timeById.get(p.id)?.powerPlayTimeOnIcePerGame)||0})).sort((a,b)=>b.v-a.v);
 const pk=roster.filter(p=>p.position!=="G").map(p=>({id:p.id,v:finite(timeById.get(p.id)?.shortHandedTimeOnIcePerGame)||0})).sort((a,b)=>b.v-a.v);
 const out=new Map();
 for(const p of roster)out.set(p.id,{ppUnit:null,pkUnit:null});
 pp.filter(x=>x.v>0).slice(0,10).forEach((x,i)=>out.get(x.id).ppUnit=i<5?1:2);
 pk.filter(x=>x.v>0).slice(0,8).forEach((x,i)=>out.get(x.id).pkUnit=i<4?1:2);
 return out;
}
function parseCoach(payload={}){
 const found=[];
 function walk(v,depth=0){
  if(v==null||depth>7)return;if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}if(typeof v!=="object")return;
  const title=clean(v.title||v.role||v.position||v.type?.text||v.type?.name),name=clean(v.fullName||v.displayName||v.name);
  if(name&&title&&/coach/i.test(title))found.push({title,name});
  for(const [k,x] of Object.entries(v)){if(["links","logos","images"].includes(k))continue;walk(x,depth+1);}
 }
 walk(payload);return {headCoach:found.find(x=>/head coach/i.test(x.title))?.name||null,staff:found};
}
async function queryRows(db,sql,...binds){if(!db?.prepare)return[];try{return (await db.prepare(sql).bind(...binds).all())?.results||[];}catch{return[];}}
async function existingPlayers(db,tkey){return queryRows(db,"SELECT * FROM nhl_player_profiles WHERE team_key=?",tkey);}
async function availabilityRows(db,tkey){
 return queryRows(db,`SELECT * FROM player_availability_observations WHERE sport='nhl' AND team_key=? AND observed_at>=? ORDER BY observed_at DESC LIMIT 150`,tkey,new Date(Date.now()-21*86400000).toISOString());
}
function latestAvailability(rows){
 const m=new Map();for(const r of rows){const id=String(r.player_id||""),name=clean(r.player_name).toLowerCase(),k=id||name;if(k&&!m.has(k))m.set(k,r);}return m;
}
function normalizedAvailability(row){
 const s=String(row?.status||row?.availability_status||"").toUpperCase();
 if(/IR|INJURED_RESERVE/.test(s))return"IR";if(/OUT/.test(s))return"OUT";if(/DOUBTFUL/.test(s))return"DOUBTFUL";
 if(/QUESTIONABLE|DAY_TO_DAY/.test(s))return"QUESTIONABLE";if(/ACTIVE|AVAILABLE|PROBABLE/.test(s))return"AVAILABLE";return null;
}
function stateConfidence(state,sourceFresh=true){
 const s=String(state||"").toUpperCase();if(!sourceFresh)return.65;
 if(["IR","OUT","CONFIRMED_SCRATCH","AVAILABLE"].includes(s))return.98;if(["DOUBTFUL","QUESTIONABLE"].includes(s))return.88;return.74;
}
function nextGame(rows,now=Date.now()){return rows.find(r=>Date.parse(r.startTime)>now&&Number(r.gameType)===2)||rows.find(r=>Date.parse(r.startTime)>now)||null;}
function replacementMap(player,players){
 const same=players.filter(x=>x.playerId!==player.playerId&&x.position===player.position&&x.availabilityState!=="OUT"&&x.availabilityState!=="IR"&&x.gameState!=="CONFIRMED_SCRATCH");
 return same.sort((a,b)=>(finite(b.rollingToiSeconds)||0)-(finite(a.rollingToiSeconds)||0)).slice(0,3).map(x=>({
  playerId:x.playerId,name:x.playerName,evLine:x.evLine,dPair:x.dPair,ppUnit:x.ppUnit,rollingToiSeconds:x.rollingToiSeconds
 }));
}
async function upsertRows(db,sql,rows,binder,batchSize=50){
 if(!rows.length)return 0;const stmts=rows.map(r=>db.prepare(sql).bind(...binder(r)));
 for(let i=0;i<stmts.length;i+=batchSize)await db.batch(stmts.slice(i,i+batchSize));return rows.length;
}

export async function syncNhlTeamProfile(env,abbr,{now=new Date()}={}){
 const DB=env?.DB;if(!DB?.prepare)return{ok:false,error:"database-unavailable"};
 const team=productAbbr(abbr),official=officialAbbr(team),record=teamRecord(team),seasonId=seasonIdFor(now),tkey=teamKey(team);
 if(!record)return{ok:false,error:"unknown-team",team};
 const runId=`nhl-profile:${tkey}:${now.toISOString()}:${Math.random().toString(36).slice(2,8)}`,started=now.toISOString();
 await DB.prepare(`INSERT INTO nhl_profile_sync_runs(id,season_id,team_key,status,source,started_at) VALUES(?,?,?,?,?,?)`)
  .bind(runId,seasonId,tkey,"RUNNING",NHL_PERSISTENT_PROFILE_SOURCE,started).run();

 try{
  const sources=await budget((async()=>{
   const directory=await fetchJson(`${STATS}/team?limit=-1`);
   const directoryMap=parseTeamDirectory(directory.data||{}),teamInfo=directoryMap.get(team),teamId=teamInfo?.id||null;
   const exp=teamId?encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2 and teamId=${teamId}`):null;
   const espn=ESPN_ABBR[team]||team.toLowerCase();
   const [roster,schedule,summary,timeonice,goalies,coach]=await Promise.all([
    fetchJson(sourceUrl(`roster/${official}/current`)),
    fetchJson(sourceUrl(`club-schedule-season/${official}/${seasonId}`)),
    exp?fetchJson(`${STATS}/skater/summary?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${exp}`):Promise.resolve({ok:false,data:{}}),
    exp?fetchJson(`${STATS}/skater/timeonice?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${exp}`):Promise.resolve({ok:false,data:{}}),
    exp?fetchJson(`${STATS}/goalie/summary?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${exp}`):Promise.resolve({ok:false,data:{}}),
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${espn}/roster`,{timeoutMs:4000}),
   ]);
   const games=scheduleGames(schedule.data||{});
   const completedReg=games.filter(g=>Number(g.gameType)===2&&["OFF","FINAL"].includes(g.state)).sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
   const completedAny=games.filter(g=>["OFF","FINAL"].includes(g.state)).sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
   const completed=(completedReg.length?completedReg:completedAny).slice(0,2);
   const upcoming=games.filter(g=>Date.parse(g.start)>Date.now()).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0]||null;
   const pregameEligible=upcoming&&Date.parse(upcoming.start)-Date.now()<=18*3600000;
   const detail=await Promise.all(completed.map(async g=>{
    const [shifts,box]=await Promise.all([
     fetchJson(`${STATS}/shiftcharts?limit=-1&cayenneExp=${encodeURIComponent(`gameId=${g.id}`)}`,{timeoutMs:5000}),
     fetchJson(sourceUrl(`gamecenter/${g.id}/boxscore`),{timeoutMs:5000}),
    ]);
    return{game:g,shifts,box};
   }));
   const pregameBox=pregameEligible
    ? await fetchJson(sourceUrl(`gamecenter/${upcoming.id}/boxscore`),{timeoutMs:4000})
    : {ok:false,data:null};
   return{directory,teamInfo,roster,schedule,summary,timeonice,goalies,coach,games,detail,upcoming,pregameBox};
  })());
  if(sources?.__timeout)throw new Error("PROFILE_SOURCE_TOTAL_BUDGET_EXCEEDED");
  const roster=parseRoster(sources.roster?.data||{});
  if(!roster.length)throw new Error("OFFICIAL_ROSTER_EMPTY");
  const scheduleRows=buildNhlScheduleProfile(sources.games,team,seasonId,now.getTime());
  const summaryById=statByPlayer(sources.summary?.data||{}),timeById=statByPlayer(sources.timeonice?.data||{});
  const latest=sources.detail?.[0]||null,lastGameScratches=scratchIds(latest?.box?.data||{}),currentScratches=scratchIds(sources.pregameBox?.data||{}),starterIds=goalieStarterIds(latest?.box?.data||{});
  const shiftSets=(sources.detail||[]).map(d=>({gameId:d.game.id,rows:parseShiftRows(d.shifts?.data||{},team)}));
  const deploy=deploymentFromShifts(roster,shiftSets),units=ppPkUnits(roster,timeById);
  const [existing,availRows]=await Promise.all([existingPlayers(DB,tkey),availabilityRows(DB,tkey)]);
  const priorById=new Map(existing.map(x=>[String(x.player_id),x])),availability=latestAvailability(availRows);
  const players=roster.map(p=>{
   const stat=summaryById.get(p.id)||{},toi=timeById.get(p.id)||{},role=deploy.lines.get(p.id)||{},unit=units.get(p.id)||{},prior=priorById.get(p.id)||null;
   const av=availability.get(p.id)||availability.get(p.name.toLowerCase())||null,officialState=normalizedAvailability(av);
   const currentScratch=currentScratches.has(p.id),lastGameScratch=lastGameScratches.has(p.id);
   const availabilityState=currentScratch?"CONFIRMED_SCRATCH":officialState||(lastGameScratch?"SCRATCHED_LAST_GAME":"AVAILABLE");
   const gameState=currentScratch?"CONFIRMED_SCRATCH":["OUT","IR"].includes(availabilityState)?"OUT":lastGameScratch?"RETURN_PENDING":"EXPECTED_ACTIVE";
   const games=Math.max(1,finite(stat.gamesPlayed)||1),lastToi=(deploy.toi.get(p.id)||0)/Math.max(1,deploy.gamesByPlayer.get(p.id)||1);
   const rollToi=lastToi||durationSeconds(toi.timeOnIcePerGame)||finite(prior?.rolling_toi_seconds)||null;
   return{
    playerKey:playerKey(team,p.id,p.name),playerId:p.id,teamKey:tkey,playerName:p.name,position:p.position,sweater:p.sweater,
    rosterStatus:"CURRENT_ROSTER",availabilityState,gameState,injuryDetail:av?.detail||av?.injury_detail||null,
    evLine:role.evLine??null,dPair:role.dPair??null,ppUnit:unit.ppUnit??null,pkUnit:unit.pkUnit??null,
    lastGameId:latest?.game?.id||prior?.last_game_id||null,lastGameAt:latest?.game?.start||prior?.last_game_at||null,lastToiSeconds:round(lastToi,1),
    rollingToiSeconds:round(rollToi,1),rollingPpToiSeconds:durationSeconds(toi.powerPlayTimeOnIcePerGame),
    shotsPerGame:finite(stat.shotsPerGame)??((finite(stat.shots)||0)/games),pointsPerGame:finite(stat.pointsPerGame)??((finite(stat.points)||0)/games),
    roleConfidence:shiftSets.some(x=>x.rows.length)?clamp(.62+.08*shiftSets.length,0,.82):.48,
    stateConfidence:lastGameScratch&&!currentScratch&&!officialState?.72:stateConfidence(availabilityState,true),
    source:currentScratch?"NHL_GAMECENTER_CURRENT_SCRATCH":officialState?"PLAYER_AVAILABILITY_OBSERVATION":lastGameScratch?"NHL_GAMECENTER_LAST_GAME_SCRATCH":"NHL_CURRENT_ROSTER",
    sourceUpdatedAt:av?.observed_at||now.toISOString(),carriedState:false,replacements:[],linemates:[],raw:{roster:p.raw,summary:stat,timeonice:toi,currentScratch,lastGameScratch}
   };
  });
  for(const p of players)p.replacements=replacementMap(p,players);
  for(const p of players){
   const mates=[...deploy.pairs.values()].filter(x=>x.a===p.playerId||x.b===p.playerId).sort((a,b)=>b.seconds-a.seconds).slice(0,5);
   p.linemates=mates.map(x=>({playerId:x.a===p.playerId?x.b:x.a,sharedSeconds:round(x.seconds,1),overlapShare:round(x.overlapShare)}));
  }
  const currentIds=new Set(players.map(p=>p.playerId));
  const carried=existing.filter(x=>!currentIds.has(String(x.player_id))&&["OUT","IR","QUESTIONABLE","DOUBTFUL"].includes(String(x.availability_state||"").toUpperCase()))
   .map(x=>({
    playerKey:x.player_key,playerId:String(x.player_id),teamKey:tkey,playerName:x.player_name,position:x.position,sweater:x.sweater_number,
    rosterStatus:x.roster_status||"CARRIED",availabilityState:x.availability_state,gameState:x.game_state,injuryDetail:x.injury_detail,
    evLine:x.ev_line,dPair:x.d_pair,ppUnit:x.pp_unit,pkUnit:x.pk_unit,lastGameId:x.last_game_id,lastGameAt:x.last_game_at,
    lastToiSeconds:x.last_toi_seconds,rollingToiSeconds:x.rolling_toi_seconds,rollingPpToiSeconds:x.rolling_pp_toi_seconds,
    shotsPerGame:x.shots_per_game,pointsPerGame:x.points_per_game,roleConfidence:Math.min(.55,finite(x.role_confidence)||.5),
    stateConfidence:.62,source:"PERSISTED_UNRESOLVED_STATE",sourceUpdatedAt:x.source_updated_at,carriedState:true,
    replacements:JSON.parse(x.replacement_json||"[]"),linemates:JSON.parse(x.linemate_json||"[]"),raw:JSON.parse(x.raw_json||"{}")
   }));
  players.push(...carried);

  const goalieStats=statRows(sources.goalies?.data||{}).sort((a,b)=>(finite(b.gamesStarted)||0)-(finite(a.gamesStarted)||0));
  const goalies=goalieStats.map((g,i)=>({
   playerId:String(g.playerId||""),playerName:g.goalieFullName||g.playerName||roster.find(p=>String(p.id)===String(g.playerId))?.name||null,teamKey:tkey,
   hierarchyRank:i+1,goalieState:starterIds.has(String(g.playerId))?"LAST_CONFIRMED_STARTER":i===0?"EXPECTED_G1":"DEPTH",
   expectedStartProbability:i===0?.68:i===1?.27:.05,games:finite(g.gamesPlayed),starts:finite(g.gamesStarted),savePct:finite(g.savePct),gaa:finite(g.goalsAgainstAverage),
   lastGameId:starterIds.has(String(g.playerId))?latest?.game?.id:null,lastGameAt:starterIds.has(String(g.playerId))?latest?.game?.start:null,
   rollingShotsFaced:finite(g.shotsAgainstPerGame),rollingSaves:finite(g.savesPerGame),restDays:null,stateConfidence:i<2?.82:.68,raw:g
  })).filter(g=>g.playerId);

  const linemates=[...deploy.pairs.values()].flatMap(x=>[
   {id:`nhl:mate:${tkey}:${x.a}:${x.b}`,teamKey:tkey,playerId:x.a,teammateId:x.b,...x},
   {id:`nhl:mate:${tkey}:${x.b}:${x.a}`,teamKey:tkey,playerId:x.b,teammateId:x.a,...x},
  ]);
  const deploymentRows=players.filter(p=>!p.carriedState).map(p=>({
   id:`nhl:deploy:${latest?.game?.id||"current"}:${tkey}:${p.playerId}`,gameId:latest?.game?.id||"current",gameStart:latest?.game?.start||null,teamKey:tkey,
   playerId:p.playerId,playerName:p.playerName,position:p.position,evLine:p.evLine,dPair:p.dPair,ppUnit:p.ppUnit,pkUnit:p.pkUnit,
   toiSeconds:p.lastToiSeconds,scratch:Boolean(p.raw?.lastGameScratch),observedAt:now.toISOString(),raw:{source:p.source,currentGameState:p.gameState}
  }));
  const coach=parseCoach(sources.coach?.data||{});
  const next=nextGame(scheduleRows,now.getTime()),counts={
   roster:players.filter(p=>!p.carriedState).length,active:players.filter(p=>!p.carriedState&&p.gameState!=="CONFIRMED_SCRATCH"&&p.gameState!=="OUT").length,
   scratches:players.filter(p=>p.gameState==="CONFIRMED_SCRATCH").length,unavailable:players.filter(p=>["OUT","IR","CONFIRMED_SCRATCH"].includes(p.availabilityState)).length
  };
  const teamProfile={
   teamKey:tkey,teamAbbr:team,officialAbbr:official,teamName:record.displayName,seasonId,profileVersion:NHL_PERSISTENT_PROFILE_VERSION,
   ...counts,nextGameId:next?.gameId||null,nextGameStart:next?.startTime||null,nextOpponentKey:next?.opponentKey||null,nextSite:next?.site||null,
   restDays:next?.daysRest??null,backToBack:Boolean(next?.backToBack),threeInFour:Boolean(next?.threeInFour),fourInSix:Boolean(next?.fourInSix),
   roadTripGameNumber:next?.roadTripGameNumber||0,travelMiles:next?.travelMiles??null,timeZonesCrossed:next?.timeZonesCrossed??0,
   scheduleStressScore:next?.scheduleStressScore??0,scheduleFlags:next?.stressFlags||[],
   deployment:{latestGameId:latest?.game?.id||null,shiftGames:shiftSets.filter(x=>x.rows.length).length,linesObserved:[...deploy.lines.entries()].map(([playerId,v])=>({playerId,...v}))},
   goalie:{hierarchy:goalies.slice(0,3).map(g=>({playerId:g.playerId,name:g.playerName,rank:g.hierarchyRank,state:g.goalieState,expectedStartProbability:g.expectedStartProbability}))},
   coach,style:{source:"NHL_PRO_V2_EXISTING_TEAM_IDENTITY",researchOnly:true},
   stateConfidence:round(clamp((roster.length?0.45:0)+(scheduleRows.length?0.20:0)+(shiftSets.some(x=>x.rows.length)?0.20:0)+(goalies.length?0.10:0)+(coach.headCoach?0.05:0),0,1)),
   sourceUpdatedAt:now.toISOString(),updatedAt:now.toISOString()
  };
  teamProfile.profile={...teamProfile,players:players.map(p=>({playerId:p.playerId,name:p.playerName,position:p.position,availabilityState:p.availabilityState,gameState:p.gameState,evLine:p.evLine,dPair:p.dPair,ppUnit:p.ppUnit,pkUnit:p.pkUnit,rollingToiSeconds:p.rollingToiSeconds,roleConfidence:p.roleConfidence,stateConfidence:p.stateConfidence}))};

  await upsertRows(DB,`INSERT INTO nhl_player_profiles (
   player_key,player_id,team_key,player_name,position,sweater_number,roster_status,availability_state,game_state,injury_detail,
   ev_line,d_pair,pp_unit,pk_unit,last_game_id,last_game_at,last_toi_seconds,rolling_toi_seconds,rolling_pp_toi_seconds,
   shots_per_game,points_per_game,role_confidence,state_confidence,source,source_updated_at,carried_state,replacement_json,linemate_json,raw_json,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(player_key) DO UPDATE SET
   team_key=excluded.team_key,player_name=excluded.player_name,position=excluded.position,sweater_number=excluded.sweater_number,roster_status=excluded.roster_status,
   availability_state=excluded.availability_state,game_state=excluded.game_state,injury_detail=excluded.injury_detail,ev_line=excluded.ev_line,d_pair=excluded.d_pair,
   pp_unit=excluded.pp_unit,pk_unit=excluded.pk_unit,last_game_id=excluded.last_game_id,last_game_at=excluded.last_game_at,last_toi_seconds=excluded.last_toi_seconds,
   rolling_toi_seconds=excluded.rolling_toi_seconds,rolling_pp_toi_seconds=excluded.rolling_pp_toi_seconds,shots_per_game=excluded.shots_per_game,
   points_per_game=excluded.points_per_game,role_confidence=excluded.role_confidence,state_confidence=excluded.state_confidence,source=excluded.source,
   source_updated_at=excluded.source_updated_at,carried_state=excluded.carried_state,replacement_json=excluded.replacement_json,linemate_json=excluded.linemate_json,
   raw_json=excluded.raw_json,updated_at=excluded.updated_at`,players,p=>[
    p.playerKey,p.playerId,p.teamKey,p.playerName,p.position,p.sweater,p.rosterStatus,p.availabilityState,p.gameState,p.injuryDetail,
    p.evLine,p.dPair,p.ppUnit,p.pkUnit,p.lastGameId,p.lastGameAt,p.lastToiSeconds,p.rollingToiSeconds,p.rollingPpToiSeconds,
    p.shotsPerGame,p.pointsPerGame,p.roleConfidence,p.stateConfidence,p.source,p.sourceUpdatedAt,p.carriedState?1:0,JSON.stringify(p.replacements),JSON.stringify(p.linemates),JSON.stringify(p.raw),now.toISOString()
  ]);

  await upsertRows(DB,`INSERT INTO nhl_goalie_profiles (
   player_id,player_name,team_key,hierarchy_rank,goalie_state,expected_start_probability,games,starts,save_pct,gaa,last_game_id,last_game_at,
   rolling_shots_faced,rolling_saves,rest_days,state_confidence,source_updated_at,raw_json,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(player_id) DO UPDATE SET player_name=excluded.player_name,team_key=excluded.team_key,hierarchy_rank=excluded.hierarchy_rank,
   goalie_state=excluded.goalie_state,expected_start_probability=excluded.expected_start_probability,games=excluded.games,starts=excluded.starts,
   save_pct=excluded.save_pct,gaa=excluded.gaa,last_game_id=excluded.last_game_id,last_game_at=excluded.last_game_at,
   rolling_shots_faced=excluded.rolling_shots_faced,rolling_saves=excluded.rolling_saves,rest_days=excluded.rest_days,state_confidence=excluded.state_confidence,
   source_updated_at=excluded.source_updated_at,raw_json=excluded.raw_json,updated_at=excluded.updated_at`,goalies,g=>[
    g.playerId,g.playerName||"Unknown",g.teamKey,g.hierarchyRank,g.goalieState,g.expectedStartProbability,g.games,g.starts,g.savePct,g.gaa,g.lastGameId,g.lastGameAt,
    g.rollingShotsFaced,g.rollingSaves,g.restDays,g.stateConfidence,now.toISOString(),JSON.stringify(g.raw),now.toISOString()
  ]);

  await upsertRows(DB,`INSERT INTO nhl_linemate_profiles (
   id,team_key,player_id,teammate_id,games_sample,shared_seconds,shared_seconds_per_game,overlap_share,strength_state,last_game_id,last_observed_at,confidence,raw_json,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET games_sample=excluded.games_sample,shared_seconds=excluded.shared_seconds,shared_seconds_per_game=excluded.shared_seconds_per_game,
   overlap_share=excluded.overlap_share,last_game_id=excluded.last_game_id,last_observed_at=excluded.last_observed_at,confidence=excluded.confidence,raw_json=excluded.raw_json,updated_at=excluded.updated_at`,
   linemates,l=>[l.id,l.teamKey,l.playerId,l.teammateId,l.gamesSample,l.seconds,round(l.seconds/Math.max(1,l.gamesSample),1),round(l.overlapShare),"ALL_SITUATIONS",l.lastGame,now.toISOString(),round(clamp(.45+.12*l.gamesSample,0,.78)),JSON.stringify(l),now.toISOString()]);

  await upsertRows(DB,`INSERT OR REPLACE INTO nhl_deployment_observations (
   id,game_id,game_start,team_key,player_id,player_name,position,ev_line,d_pair,pp_unit,pk_unit,toi_seconds,scratch,source,observed_at,raw_json,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,deploymentRows,d=>[
   d.id,d.gameId,d.gameStart,d.teamKey,d.playerId,d.playerName,d.position,d.evLine,d.dPair,d.ppUnit,d.pkUnit,d.toiSeconds,d.scratch?1:0,
   "NHL_OFFICIAL_SHIFTS+GAMECENTER",d.observedAt,JSON.stringify(d.raw),now.toISOString()
  ]);

  await upsertRows(DB,`INSERT INTO nhl_team_schedule_profile (
   id,season_id,team_key,game_id,game_type,start_time,game_state,home_team_key,away_team_key,opponent_key,site,venue_name,neutral_site,
   days_rest,back_to_back,three_in_four,four_in_six,road_trip_game_number,travel_miles,time_zones_crossed,schedule_stress_score,stress_flags_json,source_updated_at,raw_json
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET game_type=excluded.game_type,start_time=excluded.start_time,game_state=excluded.game_state,home_team_key=excluded.home_team_key,
   away_team_key=excluded.away_team_key,opponent_key=excluded.opponent_key,site=excluded.site,venue_name=excluded.venue_name,neutral_site=excluded.neutral_site,
   days_rest=excluded.days_rest,back_to_back=excluded.back_to_back,three_in_four=excluded.three_in_four,four_in_six=excluded.four_in_six,
   road_trip_game_number=excluded.road_trip_game_number,travel_miles=excluded.travel_miles,time_zones_crossed=excluded.time_zones_crossed,
   schedule_stress_score=excluded.schedule_stress_score,stress_flags_json=excluded.stress_flags_json,source_updated_at=excluded.source_updated_at,raw_json=excluded.raw_json`,
   scheduleRows,s=>[s.id,s.seasonId,s.teamKey,s.gameId,s.gameType,s.startTime,s.gameState,teamKey(s.homeTeam),teamKey(s.awayTeam),s.opponentKey,s.site,s.venueName,s.neutralSite?1:0,
    s.daysRest,s.backToBack?1:0,s.threeInFour?1:0,s.fourInSix?1:0,s.roadTripGameNumber,s.travelMiles,s.timeZonesCrossed,s.scheduleStressScore,JSON.stringify(s.stressFlags),s.sourceUpdatedAt,JSON.stringify(s.raw)]);

  await DB.prepare(`INSERT INTO nhl_team_profiles (
   team_key,team_abbr,official_abbr,team_name,season_id,profile_version,roster_count,active_count,scratch_count,unavailable_count,
   next_game_id,next_game_start,next_opponent_key,next_site,rest_days,back_to_back,three_in_four,four_in_six,road_trip_game_number,travel_miles,
   time_zones_crossed,schedule_stress_score,schedule_flags_json,deployment_json,goalie_json,coach_json,style_json,state_confidence,source_updated_at,updated_at,profile_json
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(team_key) DO UPDATE SET team_abbr=excluded.team_abbr,official_abbr=excluded.official_abbr,team_name=excluded.team_name,season_id=excluded.season_id,
   profile_version=excluded.profile_version,roster_count=excluded.roster_count,active_count=excluded.active_count,scratch_count=excluded.scratch_count,
   unavailable_count=excluded.unavailable_count,next_game_id=excluded.next_game_id,next_game_start=excluded.next_game_start,next_opponent_key=excluded.next_opponent_key,
   next_site=excluded.next_site,rest_days=excluded.rest_days,back_to_back=excluded.back_to_back,three_in_four=excluded.three_in_four,four_in_six=excluded.four_in_six,
   road_trip_game_number=excluded.road_trip_game_number,travel_miles=excluded.travel_miles,time_zones_crossed=excluded.time_zones_crossed,
   schedule_stress_score=excluded.schedule_stress_score,schedule_flags_json=excluded.schedule_flags_json,deployment_json=excluded.deployment_json,
   goalie_json=excluded.goalie_json,coach_json=excluded.coach_json,style_json=excluded.style_json,state_confidence=excluded.state_confidence,
   source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at,profile_json=excluded.profile_json`).bind(
    tkey,team,official,record.displayName,seasonId,NHL_PERSISTENT_PROFILE_VERSION,counts.roster,counts.active,counts.scratches,counts.unavailable,
    teamProfile.nextGameId,teamProfile.nextGameStart,teamProfile.nextOpponentKey,teamProfile.nextSite,teamProfile.restDays,teamProfile.backToBack?1:0,
    teamProfile.threeInFour?1:0,teamProfile.fourInSix?1:0,teamProfile.roadTripGameNumber,teamProfile.travelMiles,teamProfile.timeZonesCrossed,
    teamProfile.scheduleStressScore,JSON.stringify(teamProfile.scheduleFlags),JSON.stringify(teamProfile.deployment),JSON.stringify(teamProfile.goalie),
    JSON.stringify(teamProfile.coach),JSON.stringify(teamProfile.style),teamProfile.stateConfidence,teamProfile.sourceUpdatedAt,teamProfile.updatedAt,JSON.stringify(teamProfile.profile)
  ).run();

  const snapId=`nhl-profile-snapshot:${tkey}:${now.toISOString()}`;
  await DB.prepare(`INSERT OR REPLACE INTO nhl_team_profile_snapshots(id,team_key,season_id,as_of,profile_json,created_at) VALUES(?,?,?,?,?,?)`)
   .bind(snapId,tkey,seasonId,now.toISOString(),JSON.stringify(teamProfile.profile),now.toISOString()).run();
  if(coach.headCoach){
   const cid=`nhl-coach:${tkey}:${seasonId}:${coach.headCoach.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`;
   await DB.prepare(`INSERT OR IGNORE INTO nhl_team_coach_history(id,team_key,season_id,coach_name,role,source,observed_at,raw_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(cid,tkey,seasonId,coach.headCoach,"HEAD_COACH","ESPN_METADATA",now.toISOString(),JSON.stringify(coach),now.toISOString()).run();
  }
  await DB.prepare(`UPDATE nhl_profile_sync_runs SET status='SUCCESS',completed_at=?,source_calls=?,roster_rows=?,schedule_rows=?,player_rows_upserted=?,goalie_rows_upserted=?,linemate_rows_upserted=?,deployment_rows_upserted=?,meta_json=? WHERE id=?`)
   .bind(now.toISOString(),6+(sources.detail?.length||0)*2,roster.length,scheduleRows.length,players.length,goalies.length,linemates.length,deploymentRows.length,
    JSON.stringify({team,official,latestGameId:latest?.game?.id||null,stateConfidence:teamProfile.stateConfidence}),runId).run();
  PROFILE_CACHE.clear();
  return{ok:true,team,teamKey:tkey,seasonId,players:players.length,goalies:goalies.length,scheduleRows:scheduleRows.length,linemates:linemates.length,
   shiftGames:shiftSets.filter(x=>x.rows.length).length,scratches:counts.scratches,stateConfidence:teamProfile.stateConfidence,latestGameId:latest?.game?.id||null,nextGameId:next?.gameId||null,
   bounded:true,requestTimeProjectionFetches:0};
 }catch(err){
  await DB.prepare(`UPDATE nhl_profile_sync_runs SET status='FAILED',completed_at=?,error=? WHERE id=?`).bind(new Date().toISOString(),String(err?.message||err),runId).run().catch(()=>null);
  return{ok:false,team,error:String(err?.message||err),bounded:true};
 }
}

function parseJson(v,fallback){try{return v?JSON.parse(v):fallback;}catch{return fallback;}}
export async function loadNhlPersistentProfiles(db,teams=[]){
 const keys=[...new Set((teams||[]).map(teamKey).filter(Boolean))].sort();if(!db?.prepare||!keys.length)return{ok:false,teams:{},players:{},goalies:{},linemates:{},schedule:{}};
 const cacheKey=keys.join(","),cached=PROFILE_CACHE.get(cacheKey);if(cached&&Date.now()-cached.at<PROFILE_CACHE_MS)return{...cached.value,cacheHit:true};
 const q=keys.map(()=>"?").join(",");
 const [teamRows,playerRows,goalieRows,lineRows,scheduleRows]=await Promise.all([
  queryRows(db,`SELECT * FROM nhl_team_profiles WHERE team_key IN (${q})`,...keys),
  queryRows(db,`SELECT * FROM nhl_player_profiles WHERE team_key IN (${q})`,...keys),
  queryRows(db,`SELECT * FROM nhl_goalie_profiles WHERE team_key IN (${q})`,...keys),
  queryRows(db,`SELECT * FROM nhl_linemate_profiles WHERE team_key IN (${q}) ORDER BY shared_seconds DESC`,...keys),
  queryRows(db,`SELECT * FROM nhl_team_schedule_profile WHERE team_key IN (${q}) AND start_time>=? ORDER BY start_time LIMIT 40`,...keys,new Date(Date.now()-2*86400000).toISOString()),
 ]);
 const out={ok:teamRows.length>0,teams:{},players:{},goalies:{},linemates:{},schedule:{},cacheHit:false,marketInformed:false,researchOnly:true};
 for(const r of teamRows){out.teams[r.team_key]={...r,scheduleFlags:parseJson(r.schedule_flags_json,[]),deployment:parseJson(r.deployment_json,{}),goalie:parseJson(r.goalie_json,{}),coach:parseJson(r.coach_json,{}),style:parseJson(r.style_json,{}),profile:parseJson(r.profile_json,{})};}
 for(const k of keys){out.players[k]=[];out.goalies[k]=[];out.linemates[k]=[];out.schedule[k]=[];}
 for(const r of playerRows){out.players[r.team_key]?.push({...r,replacements:parseJson(r.replacement_json,[]),linemates:parseJson(r.linemate_json,[])});}
 for(const r of goalieRows){out.goalies[r.team_key]?.push(r);}
 for(const r of lineRows){out.linemates[r.team_key]?.push(r);}
 for(const r of scheduleRows){out.schedule[r.team_key]?.push({...r,stressFlags:parseJson(r.stress_flags_json,[])});}
 PROFILE_CACHE.set(cacheKey,{at:Date.now(),value:out});return out;
}
export function persistentPlayerFor(ctx,team,id){
 const t=teamKey(team);return (ctx?.persistentProfiles?.players?.[t]||[]).find(p=>String(p.player_id)===String(id))||null;
}
export function persistentTeamFor(ctx,team){return ctx?.persistentProfiles?.teams?.[teamKey(team)]||null;}
export function attachNhlPersistentProfiles(games=[],profiles={}){
 return (games||[]).map(game=>{
  const home=productAbbr(game?.home?.abbr),away=productAbbr(game?.away?.abbr),h=teamKey(home),a=teamKey(away);
  return{...game,nhlPersistentProfile:{
   modelId:NHL_PERSISTENT_PROFILE_ID,version:NHL_PERSISTENT_PROFILE_VERSION,configured:Boolean(profiles?.teams?.[h]||profiles?.teams?.[a]),
   home:{team:profiles?.teams?.[h]||null,players:profiles?.players?.[h]||[],goalies:profiles?.goalies?.[h]||[],linemates:profiles?.linemates?.[h]||[]},
   away:{team:profiles?.teams?.[a]||null,players:profiles?.players?.[a]||[],goalies:profiles?.goalies?.[a]||[],linemates:profiles?.linemates?.[a]||[]},
   marketInformed:false,researchOnlyScheduleStress:true,canQualify:false,canAuthorizeWager:false
  }};
 });
}
