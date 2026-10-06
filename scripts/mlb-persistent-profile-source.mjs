#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import { buildStatcastProfiles } from "../functions/lib/mlbPitchMatchup.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/mlb-profile-shard.json";
const sqlOut=args.sql||"artifacts/mlb-profile-shard.sql";
const shardCount=Math.max(1,Number(args.shardCount||6));
const shardIndex=Math.max(0,Number(args.shardIndex||0));
const concurrency=Math.max(1,Math.min(3,Number(args.concurrency||2)));
const asOf=args.asOf||new Date().toISOString();
const season=Number(args.season||new Date(asOf).getUTCFullYear());
const october=new Date(asOf).getUTCMonth()>=9;
const pitcherDays=Number(args.pitcherDays||(october?60:90));
const hitterDays=Number(args.hitterDays||(october?75:90));
const pitcherHalfLife=Number(args.pitcherHalfLife||(october?21:45));
const hitterHalfLife=Number(args.hitterHalfLife||(october?35:45));
const UA={"user-agent":"FBIS-MLB-Persistent-Profiles/1.0",accept:"application/json"};
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex");
const q=v=>v==null?"NULL":"'"+String(v).replaceAll("'","''")+"'";
const num=v=>{const n=Number(v);return Number.isFinite(n)?String(n):"NULL"};
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const day=v=>new Date(v).toISOString().slice(0,10);
const shift=(d,n)=>{const x=new Date(d+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
let sourceCalls=0;

async function getJson(url){
  sourceCalls++;
  const r=await fetch(url,{headers:UA,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
function csvLine(line){const out=[];let cur="",quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++;}else quoted=!quoted;continue;}if(c===","&&!quoted){out.push(cur);cur="";continue;}cur+=c}out.push(cur);return out}
function parseCsv(text){const lines=String(text||"").replace(/^\uFEFF/,"").trim().split(/\r?\n/);if(lines.length<2)return[];const h=csvLine(lines[0]);return lines.slice(1).filter(Boolean).map(l=>{const c=csvLine(l),o={};h.forEach((k,i)=>o[k]=c[i]??"");return o})}
async function savant(role,ids,start,end){
  const clean=[...new Set(ids.map(Number).filter(Number.isFinite))];if(!clean.length)return[];
  const u=new URL("https://baseballsavant.mlb.com/statcast_search/csv");
  for(const [k,v] of [["all","true"],["type","details"],["player_type",role],["game_date_gt",start],["game_date_lt",end],["hfGT","R|PO|"],["min_pitches","0"],["min_results","0"],["group_by","name"],["sort_col","pitches"],["sort_order","desc"],["min_pas","0"]])u.searchParams.set(k,v);
  for(const id of clean)u.searchParams.append(role==="pitcher"?"pitchers_lookup[]":"batters_lookup[]",String(id));
  sourceCalls++;
  const r=await fetch(u,{headers:{Accept:"text/csv,*/*","User-Agent":"Mozilla/5.0 (compatible; FBIS/1.0)",Referer:"https://baseballsavant.mlb.com/"},signal:AbortSignal.timeout(45000)});
  if(!r.ok)throw new Error(`Statcast ${r.status}`);
  return parseCsv(await r.text());
}
function posType(x){return String(x?.position?.type||x?.position?.name||"").toLowerCase()}
function rosterRows(j){return (j?.roster||[]).map(r=>({id:String(r.person?.id||""),name:r.person?.fullName||null,position:r.position?.abbreviation||r.person?.primaryPosition?.abbreviation||null,positionType:r.position?.type||r.person?.primaryPosition?.type||null,status:r.status?.description||r.status?.code||"ACTIVE",batSide:r.person?.batSide?.code||r.person?.batSide?.description||null,pitchHand:r.person?.pitchHand?.code||r.person?.pitchHand?.description||null})).filter(x=>x.id&&x.name)}
function coachRows(j){return (j?.roster||[]).map(r=>({id:String(r.person?.id||""),name:r.person?.fullName||null,role:r.jobTitle||r.job||r.position?.name||null})).filter(x=>x.id&&x.name)}
function teamOffense(j){const stat=(j?.stats||[]).flatMap(x=>x.splits||[])[0]?.stat||{};const runs=finite(stat.runs),games=finite(stat.gamesPlayed),so=finite(stat.strikeOuts),pa=finite(stat.plateAppearances);return{runs,games,rpg:runs!=null&&games>0?runs/games:null,strikeOuts:so,plateAppearances:pa,kRate:so!=null&&pa>0?so/pa:null,avg:finite(stat.avg),obp:finite(stat.obp),slg:finite(stat.slg),ops:finite(stat.ops)}}
function haversineMiles(a,b){
  if(!a||!b||![a.lat,a.lon,b.lat,b.lon].every(Number.isFinite))return null;
  const rad=x=>x*Math.PI/180,R=3958.7613;
  const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const q=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(q)));
}
function venueState(g){
  const loc=g?.venue?.location||{},coord=loc.defaultCoordinates||{},tz=g?.venue?.timeZone||{};
  return{venueId:g?.venue?.id?String(g.venue.id):null,venueName:g?.venue?.name||null,city:loc.city||null,state:loc.stateAbbrev||loc.state||null,lat:finite(coord.latitude),lon:finite(coord.longitude),timeZoneId:tz.id||null,utcOffset:finite(tz.offset)};
}
function scheduleRows(j,teamId,teamKey){
  const rows=(j?.dates||[]).flatMap(d=>d.games||[]).map(g=>{
    const home=g.teams?.home?.team||{},away=g.teams?.away?.team||{},isHome=String(home.id)===String(teamId),opp=isHome?away:home;
    const self=isHome?g.teams?.home:g.teams?.away;
    return{gameId:String(g.gamePk||""),startTime:g.gameDate||null,opponentId:String(opp.id||""),opponentKey:opp.abbreviation||null,homeAway:isHome?"home":"away",gameType:g.gameType||null,seriesDescription:g.seriesDescription||null,seriesGameNumber:finite(g.seriesGameNumber),gamesInSeries:finite(g.gamesInSeries),doubleHeader:String(g.doubleHeader||"N")!=="N",completed:String(g.status?.abstractGameState||"").toLowerCase()==="final",dayNight:g.dayNight||null,probablePitcherId:self?.probablePitcher?.id?String(self.probablePitcher.id):null,probablePitcherName:self?.probablePitcher?.fullName||null,venue:venueState(g),teamKey};
  }).filter(x=>x.gameId&&x.startTime).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
  let road=0;
  for(let i=0;i<rows.length;i++){
    const cur=rows[i],prev=rows[i-1],rest=prev?Math.max(0,Math.floor((Date.parse(cur.startTime)-Date.parse(prev.startTime))/86400000)-1):3;
    if(cur.homeAway==="away")road++;else road=0;
    cur.restDays=rest;cur.consecutiveRoadGames=cur.homeAway==="away"?road:0;
    cur.dayAfterNight=Boolean(prev&&String(prev.dayNight).toLowerCase()==="night"&&String(cur.dayNight).toLowerCase()==="day"&&rest===0);
    cur.travelMiles=prev?haversineMiles(prev.venue,cur.venue):0;
    const prevOffset=finite(prev?.venue?.utcOffset),curOffset=finite(cur?.venue?.utcOffset);
    cur.timeZoneShiftHours=prevOffset!=null&&curOffset!=null?curOffset-prevOffset:null;
  }
  return rows;
}
function statsMap(j){const m=new Map();for(const s of (j?.stats||[]).flatMap(x=>x.splits||[])){const id=String(s.player?.id||"");if(id)m.set(id,{name:s.player?.fullName||null,stat:s.stat||{}})}return m}
function pitcherSeason(stat={}){
  const ip=finite(stat.inningsPitched),gs=finite(stat.gamesStarted),bf=finite(stat.battersFaced),so=finite(stat.strikeOuts);
  const hits=finite(stat.hits),bb=finite(stat.baseOnBalls),er=finite(stat.earnedRuns),wins=finite(stat.wins),losses=finite(stat.losses);
  return{
    era:finite(stat.era),whip:finite(stat.whip),innings:ip,games:finite(stat.gamesPitched),starts:gs,wins,losses,
    strikeOuts:so,hitsAllowed:hits,walksAllowed:bb,earnedRuns:er,battersFaced:bf,
    k9:finite(stat.strikeoutsPer9Inn)??(ip>0&&so!=null?so*9/ip:null),
    bb9:finite(stat.walksPer9Inn)??(ip>0&&bb!=null?bb*9/ip:null),
    h9:finite(stat.hitsPer9Inn)??(ip>0&&hits!=null?hits*9/ip:null),
    er9:ip>0&&er!=null?er*9/ip:finite(stat.era),
    kRate:bf>0&&so!=null?so/bf:null,
    bbRate:bf>0&&bb!=null?bb/bf:null,
    hitRate:bf>0&&hits!=null?hits/bf:null,
    inningsPerStart:gs>0&&ip!=null?ip/gs:null,
    battersFacedPerInning:ip>0&&bf!=null?bf/ip:null
  };
}
function hitterSeason(stat={}){
  const pa=finite(stat.plateAppearances),ab=finite(stat.atBats),h=finite(stat.hits),bb=finite(stat.baseOnBalls),so=finite(stat.strikeOuts);
  const hr=finite(stat.homeRuns),d2=finite(stat.doubles),d3=finite(stat.triples),runs=finite(stat.runs),rbi=finite(stat.rbi);
  const tb=finite(stat.totalBases)??(h!=null?Math.max(0,h-(d2||0)-(d3||0)-(hr||0))+2*(d2||0)+3*(d3||0)+4*(hr||0):null);
  return{
    games:finite(stat.gamesPlayed),plateAppearances:pa,atBats:ab,hits:h,totalBases:tb,homeRuns:hr,walks:bb,strikeOuts:so,runs,rbi,
    avg:finite(stat.avg),obp:finite(stat.obp),slg:finite(stat.slg),ops:finite(stat.ops),
    hitPerPa:pa>0&&h!=null?h/pa:null,
    totalBasesPerPa:pa>0&&tb!=null?tb/pa:null,
    homeRunPerPa:pa>0&&hr!=null?hr/pa:null,
    runsPerPa:pa>0&&runs!=null?runs/pa:null,
    rbiPerPa:pa>0&&rbi!=null?rbi/pa:null,
    walkRate:pa>0&&bb!=null?bb/pa:null,
    strikeoutRate:pa>0&&so!=null?so/pa:null
  };
}
async function recentUsage(teamId){
  const end=day(asOf),start=shift(end,-3);
  const sch=await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&startDate=${start}&endDate=${shift(end,-1)}`).catch(()=>({dates:[]}));
  const games=(sch.dates||[]).flatMap(d=>d.games||[]).filter(g=>String(g.status?.abstractGameState||"").toLowerCase()==="final").slice(-3);
  const rows=[];
  for(const g of games){
    const box=await getJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`).catch(()=>null);if(!box)continue;
    const t=["home","away"].map(k=>box.teams?.[k]).find(x=>String(x?.team?.id)===String(teamId));if(!t)continue;
    const ids=(t.pitchers||[]).map(String);const starter=ids[0];
    for(const id of ids.slice(1)){const p=t.players?.[`ID${id}`];rows.push({playerId:id,playerName:p?.person?.fullName||null,date:String(g.gameDate||"").slice(0,10),pitches:finite(p?.stats?.pitching?.numberOfPitches)||0,innings:finite(p?.stats?.pitching?.inningsPitched)||0,starter:id===starter});}
  }
  return rows;
}
function fatigue(rows,coreIds){
  const core=new Set(coreIds.map(String)),target=Date.parse(day(asOf)+"T12:00:00Z");let p1=0,p2=0,t2=0;const used=new Set();
  for(const r of rows){const age=Math.round((target-Date.parse(r.date+"T12:00:00Z"))/86400000),p=r.pitches||0;if(age<=2)t2+=p;if(core.has(String(r.playerId))){if(age<=1){p1+=p;used.add(String(r.playerId))}if(age<=2)p2+=p}}
  const score=Math.max(0,Math.min(1.5,(p1/110)*.55+(p2/190)*.30+(t2/260)*.15));
  return{corePitches1d:p1,corePitches2d:p2,totalPitches2d:t2,coreRelieversUsed1d:used.size,fatigueScore:score,bullpenEraMultiplier:Math.max(1,Math.min(1.08,1+Math.max(0,score-.45)*.08))};
}
async function recentStarterWorkload(playerId){
  if(!playerId)return null;
  const j=await getJson(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}`).catch(()=>null);
  if(!j)return null;
  const rows=(j.stats||[]).flatMap(x=>x.splits||[]).filter(x=>(finite(x.stat?.gamesStarted)||0)>0).map(x=>({date:x.date||null,innings:finite(x.stat?.inningsPitched),pitches:finite(x.stat?.numberOfPitches),battersFaced:finite(x.stat?.battersFaced)})).filter(x=>x.innings!=null).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).slice(0,4);
  if(!rows.length)return null;
  const mean=k=>{const a=rows.map(x=>x[k]).filter(Number.isFinite);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null};
  return{starts:rows.length,innings:mean("innings"),pitches:mean("pitches"),battersFaced:mean("battersFaced"),rows};
}
function starterExpectedIp(base,recent,fatigueScore){
  const b=finite(base)??5.35,r=finite(recent?.innings);let ip=r!=null?b*.45+r*.55:b;
  if((finite(fatigueScore)||0)>.85)ip+=.18;else if((finite(fatigueScore)||0)<.25)ip-=.08;
  return Math.max(3.5,Math.min(7,ip));
}
async function one(team){
  const teamId=String(team.id),teamKey=team.abbreviation||team.teamCode||teamId;
  const [active,forty,coaches,schedule,pitching,hitting,playerHitting]=await Promise.all([
    getJson(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=${season}&hydrate=person`),
    getJson(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=40Man&season=${season}&hydrate=person`).catch(()=>({roster:[]})),
    getJson(`https://statsapi.mlb.com/api/v1/teams/${teamId}/coaches?season=${season}`).catch(()=>({roster:[]})),
    getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${teamId}&season=${season}&gameType=R,F,D,L,W&hydrate=probablePitcher,venue`),
    getJson(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&teamId=${teamId}&season=${season}&playerPool=ALL&limit=100`).catch(()=>({stats:[]})),
    getJson(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`).catch(()=>({stats:[]})),
    getJson(`https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&teamId=${teamId}&season=${season}&playerPool=ALL&limit=100`).catch(()=>({stats:[]}))
  ]);
  const roster=rosterRows(active),fortyRows=rosterRows(forty),pitchStats=statsMap(pitching),hitStats=statsMap(playerHitting),offense=teamOffense(hitting);
  const pitchers=roster.filter(x=>/pitcher/i.test(x.positionType)),hitters=roster.filter(x=>!/pitcher/i.test(x.positionType));
  const end=day(asOf);
  const [pitchRows,hitRows,usage]=await Promise.all([
    savant("pitcher",pitchers.map(x=>x.id),shift(end,-pitcherDays),end).catch(()=>[]),
    savant("batter",hitters.map(x=>x.id),shift(end,-hitterDays),end).catch(()=>[]),
    recentUsage(teamId).catch(()=>[])
  ]);
  const pProfiles=buildStatcastProfiles(pitchRows,{role:"pitcher",asOf,halfLifeDays:pitcherHalfLife});
  const hProfiles=buildStatcastProfiles(hitRows,{role:"batter",asOf,halfLifeDays:hitterHalfLife});
  const seasonPitchers=pitchers.map(p=>({...p,...pitcherSeason(pitchStats.get(p.id)?.stat||{})}));
  const core=seasonPitchers.map(p=>({...p,reliefGames:Math.max(0,(p.games||0)-(p.starts||0))})).filter(p=>p.reliefGames>=8&&p.innings>=8&&p.era!=null).sort((a,b)=>b.reliefGames-a.reliefGames||(a.era??99)-(b.era??99)).slice(0,6);
  const weights=core.map((p,i)=>Math.max(1,p.reliefGames*(1-i*.08))),den=weights.reduce((a,b)=>a+b,0);
  const coreEra=den?core.reduce((s,p,i)=>s+(p.era||4.15)*weights[i],0)/den:null,ft=fatigue(usage,core.map(x=>x.id));
  const adjustedEra=coreEra==null?null:Math.max(2.2,Math.min(6.5,coreEra*ft.bullpenEraMultiplier));
  const sched=scheduleRows(schedule,teamId,teamKey),upcoming=sched.filter(x=>Date.parse(x.startTime)>=Date.parse(asOf)).slice(0,12);
  const probableIds=[...new Set(upcoming.slice(0,2).map(x=>x.probablePitcherId).filter(Boolean))];
  const workloadPairs=await Promise.all(probableIds.map(async id=>[String(id),await recentStarterWorkload(id)]));
  const workloads=Object.fromEntries(workloadPairs);
  const enrichedPitchers=seasonPitchers.map(p=>{const recent=workloads[p.id]||null;return{...p,recentStarter:recent,expectedInnings:starterExpectedIp(p.inningsPerStart,recent,ft.fatigueScore),statcastProfile:pProfiles[p.id]||null,asOf}});
  const starterState=Object.fromEntries(enrichedPitchers.filter(p=>probableIds.includes(p.id)).map(p=>[p.id,{expectedInnings:p.expectedInnings,recentStarter:p.recentStarter,inningsPerStart:p.inningsPerStart}]));
  const staff=coachRows(coaches);
  return{teamId,teamKey,teamName:team.name,season,asOf,roster,fortyMan:fortyRows,coaches:staff,offense,schedule:sched,pitchers:enrichedPitchers,hitters:hitters.map(h=>({...h,...hitterSeason(hitStats.get(h.id)?.stat||{}),handedness:h.batSide||null,statcastProfile:hProfiles[h.id]||null,asOf})),bullpen:{coreRelievers:core.map(x=>({id:x.id,name:x.name,era:x.era,reliefGames:x.reliefGames})),coreBullpenEra:coreEra,adjustedBullpenEra:adjustedEra,fatigue:ft,recentUsage:usage},starterState,lineup:{state:"ROSTER_BASELINE",activeHitters:hitters.map(x=>({id:x.id,name:x.name,position:x.position})),activePitchers:pitchers.map(x=>({id:x.id,name:x.name,position:x.position})),officialLineupRequiredForFinalMatchup:true},scheduleState:{nextGames:upcoming,nextGame:upcoming[0]||null},sourceVersion:"mlb-state-v2"};
}
const teamsJson=await getJson(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${season}`);
const allTeams=(teamsJson.teams||[]).filter(t=>t.sport?.id===1||t.sport?.name==="Major League Baseball").sort((a,b)=>String(a.name).localeCompare(String(b.name)));
const selected=allTeams.filter((_,i)=>i%shardCount===shardIndex),queue=[...selected],results=[],errors=[];
async function worker(){while(queue.length){const t=queue.shift();if(!t)break;try{results.push(await one(t))}catch(e){errors.push({teamId:String(t.id),teamName:t.name,error:String(e?.message||e)})}}}
await Promise.all(Array.from({length:concurrency},worker));results.sort((a,b)=>a.teamName.localeCompare(b.teamName));

const sql=[],createdAt=new Date().toISOString();
for(const t of results){
  const profile={teamId:t.teamId,teamKey:t.teamKey,teamName:t.teamName,season:t.season,asOf:t.asOf,coaches:t.coaches,offense:t.offense,bullpen:t.bullpen,starterState:t.starterState,lineup:t.lineup,scheduleState:t.scheduleState,governance:{persistentState:true,marketInformed:false,liveBoardFanout:false,statcastRefreshScheduled:true}};
  sql.push(`INSERT INTO mlb_team_profiles (team_id,team_key,team_name,season,as_of,roster_json,rotation_json,bullpen_json,lineup_json,schedule_json,profile_json,state_confidence,source_version,created_at,updated_at) VALUES (${q(t.teamId)},${q(t.teamKey)},${q(t.teamName)},${season},${q(asOf)},${q(JSON.stringify(t.roster))},${q(JSON.stringify(t.pitchers.map(x=>({id:x.id,name:x.name,starts:x.starts,inningsPerStart:x.inningsPerStart}))))},${q(JSON.stringify(t.bullpen))},${q(JSON.stringify(t.lineup))},${q(JSON.stringify(t.scheduleState))},${q(JSON.stringify(profile))},0.95,'mlb-state-v2',COALESCE((SELECT created_at FROM mlb_team_profiles WHERE team_id=${q(t.teamId)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(team_id) DO UPDATE SET team_key=excluded.team_key,team_name=excluded.team_name,season=excluded.season,as_of=excluded.as_of,roster_json=excluded.roster_json,rotation_json=excluded.rotation_json,bullpen_json=excluded.bullpen_json,lineup_json=excluded.lineup_json,schedule_json=excluded.schedule_json,profile_json=excluded.profile_json,state_confidence=excluded.state_confidence,source_version=excluded.source_version,updated_at=excluded.updated_at;`);
  const snap="mlb-team:"+hash(t.teamId+"|"+asOf).slice(0,32);sql.push(`INSERT OR IGNORE INTO mlb_team_profile_snapshots (id,team_id,team_key,season,as_of,profile_json,created_at) VALUES (${q(snap)},${q(t.teamId)},${q(t.teamKey)},${season},${q(asOf)},${q(JSON.stringify(profile))},${q(createdAt)});`);
  const active=new Map(t.roster.map(x=>[x.id,x])),forty=new Map(t.fortyMan.map(x=>[x.id,x]));
  const current40=[...forty.keys()];
  const notIn40=current40.length?` AND player_id NOT IN (${current40.map(q).join(",")})`:"";
  sql.push(`UPDATE mlb_player_state_profiles SET roster_status='NOT_ON_40_MAN',carried_forward=0,as_of=${q(asOf)},state_source='MLB_STATS_ROSTER_TRANSITION',updated_at=${q(createdAt)} WHERE team_id=${q(t.teamId)}${notIn40};`);
  for(const p of forty.values()){
    const activeRow=active.get(p.id)||null;
    const sourceStatus=activeRow?.status||p.status||null;
    const status=activeRow?"ACTIVE":(/injur|bereave|paternity|suspend|restricted/i.test(String(sourceStatus||""))?String(sourceStatus).toUpperCase().replace(/[^A-Z0-9]+/g,"_"):"40_MAN_NOT_ACTIVE");
    const pp={...p,teamId:t.teamId,teamKey:t.teamKey,rosterStatus:status,sourceStatus,asOf,source:"MLB_STATS_ROSTER"};
    sql.push(`INSERT INTO mlb_player_state_profiles (player_id,player_name,team_id,team_key,position,roster_status,as_of,state_source,carried_forward,profile_json,created_at,updated_at) VALUES (${q(p.id)},${q(p.name)},${q(t.teamId)},${q(t.teamKey)},${q(p.position)},${q(status)},${q(asOf)},'MLB_STATS_ROSTER',0,${q(JSON.stringify(pp))},COALESCE((SELECT created_at FROM mlb_player_state_profiles WHERE player_id=${q(p.id)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(player_id) DO UPDATE SET player_name=excluded.player_name,team_id=excluded.team_id,team_key=excluded.team_key,position=excluded.position,roster_status=excluded.roster_status,as_of=excluded.as_of,state_source=excluded.state_source,carried_forward=0,profile_json=excluded.profile_json,updated_at=excluded.updated_at;`);
  }
  for(const p of t.pitchers){const prof={...p,teamId:t.teamId,teamKey:t.teamKey};sql.push(`INSERT INTO mlb_pitcher_profiles (player_id,player_name,team_id,team_key,as_of,innings_per_start,batters_faced_per_inning,expected_innings,recent_velocity,recent_pitch_mix_json,statcast_profile_json,profile_json,source_version,created_at,updated_at) VALUES (${q(p.id)},${q(p.name)},${q(t.teamId)},${q(t.teamKey)},${q(asOf)},${num(p.inningsPerStart)},${num(p.battersFacedPerInning)},${num(p.expectedInnings)},${num(p.statcastProfile?.global?.velocity)},${q(JSON.stringify(p.statcastProfile?.family||{}))},${q(JSON.stringify(p.statcastProfile||null))},${q(JSON.stringify(prof))},'mlb-state-v2',COALESCE((SELECT created_at FROM mlb_pitcher_profiles WHERE player_id=${q(p.id)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(player_id) DO UPDATE SET player_name=excluded.player_name,team_id=excluded.team_id,team_key=excluded.team_key,as_of=excluded.as_of,innings_per_start=excluded.innings_per_start,batters_faced_per_inning=excluded.batters_faced_per_inning,expected_innings=excluded.expected_innings,recent_velocity=excluded.recent_velocity,recent_pitch_mix_json=excluded.recent_pitch_mix_json,statcast_profile_json=excluded.statcast_profile_json,profile_json=excluded.profile_json,source_version=excluded.source_version,updated_at=excluded.updated_at;`)}
  for(const h of t.hitters){const prof={...h,teamId:t.teamId,teamKey:t.teamKey};sql.push(`INSERT INTO mlb_hitter_profiles (player_id,player_name,team_id,team_key,as_of,handedness,lineup_role,statcast_profile_json,profile_json,source_version,created_at,updated_at) VALUES (${q(h.id)},${q(h.name)},${q(t.teamId)},${q(t.teamKey)},${q(asOf)},${q(h.handedness||h.batSide)},NULL,${q(JSON.stringify(h.statcastProfile||null))},${q(JSON.stringify(prof))},'mlb-state-v2',COALESCE((SELECT created_at FROM mlb_hitter_profiles WHERE player_id=${q(h.id)}),${q(createdAt)}),${q(createdAt)}) ON CONFLICT(player_id) DO UPDATE SET player_name=excluded.player_name,team_id=excluded.team_id,team_key=excluded.team_key,as_of=excluded.as_of,handedness=excluded.handedness,lineup_role=excluded.lineup_role,statcast_profile_json=excluded.statcast_profile_json,profile_json=excluded.profile_json,source_version=excluded.source_version,updated_at=excluded.updated_at;`)}
  for(const g of t.schedule){const id="mlb-schedule:"+hash(t.teamId+"|"+g.gameId).slice(0,32);sql.push(`INSERT OR REPLACE INTO mlb_team_schedule_items (id,team_id,team_key,game_id,start_time,opponent_id,opponent_key,home_away,game_type,series_description,series_game_number,games_in_series,completed,rest_days,day_after_night,doubleheader,consecutive_road_games,source,observed_at,raw_json,created_at) VALUES (${q(id)},${q(t.teamId)},${q(t.teamKey)},${q(g.gameId)},${q(g.startTime)},${q(g.opponentId)},${q(g.opponentKey)},${q(g.homeAway)},${q(g.gameType)},${q(g.seriesDescription)},${num(g.seriesGameNumber)},${num(g.gamesInSeries)},${g.completed?1:0},${num(g.restDays)},${g.dayAfterNight?1:0},${g.doubleHeader?1:0},${Number(g.consecutiveRoadGames||0)},'MLB_STATS_SCHEDULE',${q(asOf)},${q(JSON.stringify(g))},${q(createdAt)});`)}
}
sql.push(`INSERT INTO mlb_profile_refresh_state (shard_key,as_of,status,teams_processed,players_processed,source_calls,error_count,cursor_json,details_json,updated_at) VALUES (${q("shard-"+shardIndex)},${q(asOf)},${q(errors.length?"PARTIAL":"SUCCESS")},${results.length},${results.reduce((s,t)=>s+t.roster.length,0)},${sourceCalls},${errors.length},${q(JSON.stringify({shardIndex,shardCount}))},${q(JSON.stringify({errors}))},${q(createdAt)}) ON CONFLICT(shard_key) DO UPDATE SET as_of=excluded.as_of,status=excluded.status,teams_processed=excluded.teams_processed,players_processed=excluded.players_processed,source_calls=excluded.source_calls,error_count=excluded.error_count,cursor_json=excluded.cursor_json,details_json=excluded.details_json,updated_at=excluded.updated_at;`);

const payload={generatedAt:createdAt,asOf,season,shard:{index:shardIndex,count:shardCount},sourceVersion:"mlb-state-v2",teams:results,errors,quality:{teams:results.length,players:results.reduce((s,t)=>s+t.roster.length,0),pitchers:results.reduce((s,t)=>s+t.pitchers.length,0),hitters:results.reduce((s,t)=>s+t.hitters.length,0),pitcherStatcast:results.reduce((s,t)=>s+t.pitchers.filter(x=>x.statcastProfile).length,0),hitterStatcast:results.reduce((s,t)=>s+t.hitters.filter(x=>x.statcastProfile).length,0),sourceCalls,errors:errors.length}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
const sqlChunkSize=100,baseSql=sqlOut.replace(/\.sql$/,"");
for(let i=0;i<sql.length;i+=sqlChunkSize){
  const part=sql.slice(i,i+sqlChunkSize);
  const file=i===0?sqlOut:`${baseSql}-part-${String(i/sqlChunkSize).padStart(3,"0")}.sql`;
  fs.writeFileSync(file,part.join("\n")+"\n");
}
payload.quality.sqlFiles=Math.ceil(sql.length/sqlChunkSize);
fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");
console.log(JSON.stringify(payload.quality,null,2));
