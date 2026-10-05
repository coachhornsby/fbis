#!/usr/bin/env node
import fs from "node:fs";
import teams from "../data/teams/nhl.js";
import { nhlSeasonId,normalizeNhlTeamKey,buildShiftDeployment,inferNhlRoles } from "../functions/lib/nhlPersistentProfile.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/nhl-profile-source.json";
const seasonId=String(args.season||nhlSeasonId());
const shardCount=Math.max(1,Number(args.shardCount||8)),shardIndex=Math.max(0,Number(args.shardIndex||0));
const concurrency=Math.max(1,Math.min(4,Number(args.concurrency||2)));
const WEB="https://api-web.nhle.com/v1",STATS="https://api.nhle.com/stats/rest/en",ESPN="https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";
const OFFICIAL=Object.freeze({LA:"LAK",NJ:"NJD",SJ:"SJS",TB:"TBL"});
const headers={accept:"application/json","user-agent":"FBIS-NHL-Persistent/1.0"};

async function get(url,ms=8000){
  const r=await fetch(url,{headers,signal:AbortSignal.timeout(ms)});
  if(!r.ok)throw new Error(`HTTP_${r.status} ${url}`);
  return r.json();
}
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clock=v=>{if(v==null)return null;const n=Number(v);if(Number.isFinite(n))return n;const m=String(v).match(/^(?:(\d+):)?(\d+):(\d+)$/);return m?Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]):null};
function nm(p){return p?.firstName?.default&&p?.lastName?.default?`${p.firstName.default} ${p.lastName.default}`:p?.name?.default||p?.name||null}
function rosterRows(j){
  const out=[];
  for(const [group,pos] of [["forwards",null],["defensemen","D"],["goalies","G"]])for(const p of j?.[group]||[])out.push({
    id:String(p.id||p.playerId||""),name:nm(p),position:pos||String(p.positionCode||p.position||"").toUpperCase(),
    sweaterNumber:p.sweaterNumber??null
  });
  return out.filter(x=>x.id&&x.name);
}
function scheduleRows(j,team){
  const games=Array.isArray(j?.games)?j.games:(j?.gameWeek||[]).flatMap(x=>x.games||[]);
  return games.map(g=>{
    const home=normalizeNhlTeamKey(g?.homeTeam?.abbrev?.default??g?.homeTeam?.abbrev),away=normalizeNhlTeamKey(g?.awayTeam?.abbrev?.default??g?.awayTeam?.abbrev);
    return {gameId:String(g.id||""),startTime:g.startTimeUTC||null,homeTeamKey:home,venueTeamKey:home,opponentKey:home===team?away:home,homeAway:home===team?"home":"away",completed:["OFF","FINAL"].includes(String(g.gameState||g.gameScheduleState||"").toUpperCase()),gameState:g.gameState||null,gameType:finite(g.gameType),source:"NHL_OFFICIAL_CLUB_SCHEDULE"};
  }).filter(x=>x.gameId&&x.startTime);
}
function scratches(box={}){
  const out=new Set();const scan=v=>{if(!v)return;if(Array.isArray(v)){v.forEach(scan);return}if(typeof v!=="object")return;const id=v.playerId??v.id;if(id!=null)out.add(String(id));for(const x of Object.values(v))if(x&&typeof x==="object")scan(x)};
  scan(box?.scratches??box?.boxscore?.scratches);return [...out];
}
function activeRoster(pbp={}){return new Set((pbp?.rosterSpots||[]).map(x=>String(x.playerId||"")).filter(Boolean))}
function statRows(sk={},go={}){
  const by={};
  for(const r of sk?.data||[]){
    const id=String(r.playerId||"");if(!id)continue;const gp=finite(r.gamesPlayed)||0;
    by[id]={playerId:id,team:String(r.teamAbbrevs||r.teamAbbrev||"").split(",").at(-1)?.trim()?.toUpperCase(),games:gp,
      shotsPerGame:gp?(finite(r.shots)||0)/gp:null,pointsPerGame:gp?(finite(r.points)||0)/gp:null,
      toiPerGame:clock(r.timeOnIcePerGame),ppToiPerGame:clock(r.powerPlayTimeOnIcePerGame),position:String(r.positionCode||"").toUpperCase()};
  }
  for(const r of go?.data||[]){
    const id=String(r.playerId||"");if(!id)continue;by[id]={...(by[id]||{}),playerId:id,team:String(r.teamAbbrevs||"").split(",").at(-1)?.trim()?.toUpperCase(),position:"G",
      games:finite(r.gamesPlayed)||0,starts:finite(r.gamesStarted)||0,savePct:finite(r.savePct),gaa:finite(r.goalsAgainstAverage)};
  }
  return by;
}
async function espnCatalog(){
  const j=await get(`${ESPN}/teams?limit=100`).catch(()=>({sports:[]}));
  const out={};
  for(const x of j?.sports?.[0]?.leagues?.[0]?.teams||[]){
    const t=x?.team||x,abbr=normalizeNhlTeamKey(t?.abbreviation||"");
    if(abbr)out[abbr]=String(t?.id||"");
  }
  return out;
}
function coachRows(j){
  const a=Array.isArray(j?.coach)?j.coach:Array.isArray(j?.coaches)?j.coaches:[];
  return a.map((c,i)=>({id:String(c.id||""),name:c.displayName||[c.firstName,c.lastName].filter(Boolean).join(" "),role:c.position?.displayName||c.position?.name||c.type?.text||c.type||(i===0?"Head Coach":"Coach")})).filter(x=>x.name);
}
async function globalStats(){
  const exp=encodeURIComponent(`seasonId=${seasonId}`);
  const [s,g]=await Promise.all([
    get(`${STATS}/skater/summary?isAggregate=false&isGame=false&sort=[{"property":"points","direction":"DESC"}]&start=0&limit=-1&cayenneExp=${exp}`).catch(()=>({data:[]})),
    get(`${STATS}/goalie/summary?isAggregate=false&isGame=false&sort=[{"property":"gamesPlayed","direction":"DESC"}]&start=0&limit=-1&cayenneExp=${exp}`).catch(()=>({data:[]}))
  ]);
  return statRows(s,g);
}
const [allStats,espnIds]=await Promise.all([globalStats(),espnCatalog()]);
async function one(t){
  const team=normalizeNhlTeamKey(t.abbr),official=OFFICIAL[team]||team,state={roster:"ERROR",schedule:"ERROR",lastGame:"NONE",shifts:"NONE"},errors=[];
  const espnId=espnIds[team]||null,seasonYear=Number(seasonId.slice(4));
  const [rr,sr,er]=await Promise.allSettled([get(`${WEB}/roster/${official}/current`),get(`${WEB}/club-schedule-season/${official}/${seasonId}`),espnId?get(`${ESPN}/teams/${espnId}/roster?season=${seasonYear}`):Promise.resolve(null)]);
  const roster=rr.status==="fulfilled"?rosterRows(rr.value):[];
  if(rr.status==="fulfilled")state.roster="OK";else errors.push(String(rr.reason));
  let schedule=sr.status==="fulfilled"?scheduleRows(sr.value,team):[];
  if(sr.status==="fulfilled")state.schedule="OK";else errors.push(String(sr.reason));
  schedule=[...new Map(schedule.map(x=>[x.gameId,x])).values()].sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
  const completed=schedule.filter(x=>x.completed&&Date.parse(x.startTime)<Date.now()).at(-1)||null;
  let scratchIds=[],activeIds=[],shifts=[],lastGame=null;
  if(completed){
    lastGame=completed;
    const [br,pr,tr]=await Promise.allSettled([
      get(`${WEB}/gamecenter/${completed.gameId}/boxscore`,6000),
      get(`${WEB}/gamecenter/${completed.gameId}/play-by-play`,6000),
      get(`${STATS}/shiftcharts?cayenneExp=${encodeURIComponent(`gameId=${completed.gameId}`)}`,6000)
    ]);
    if(br.status==="fulfilled")scratchIds=scratches(br.value);
    if(pr.status==="fulfilled")activeIds=[...activeRoster(pr.value)];
    if(tr.status==="fulfilled"){shifts=tr.value?.data||[];state.shifts="OK";}
    state.lastGame=(br.status==="fulfilled"||pr.status==="fulfilled")?"OK":"ERROR";
  }
  const statsById={};for(const p of roster){const s=allStats[p.id]||{};statsById[p.id]={...s,toiPerGame:finite(s.toiPerGame),ppToiPerGame:finite(s.ppToiPerGame)}}
  const dep=buildShiftDeployment(shifts,roster),roles=inferNhlRoles(roster,statsById,dep);
  const coaches=er.status==="fulfilled"&&er.value?coachRows(er.value):[];
  return {teamKey:team,teamName:t.displayName,seasonId,roster,coaches,schedule,lastGame,scratchIds,activeIds,statsById,deployment:{...dep,roles},sourceState:state,errors};
}
const selected=teams.filter((_,i)=>i%shardCount===shardIndex),queue=[...selected],rows=[];
async function worker(){while(queue.length){const t=queue.shift();if(!t)break;try{rows.push(await one(t))}catch(e){rows.push({teamKey:t.abbr,teamName:t.displayName,seasonId,roster:[],schedule:[],errors:[String(e)],sourceState:{roster:"ERROR",schedule:"ERROR"}})}}}
await Promise.all(Array.from({length:concurrency},worker));rows.sort((a,b)=>a.teamKey.localeCompare(b.teamKey));
const payload={generatedAt:new Date().toISOString(),seasonId,shard:{index:shardIndex,count:shardCount,selected:selected.length},teams:rows,quality:{teams:rows.length,rostersOk:rows.filter(x=>x.sourceState?.roster==="OK").length,schedulesOk:rows.filter(x=>x.sourceState?.schedule==="OK").length,shiftTeams:rows.filter(x=>x.sourceState?.shifts==="OK").length,players:rows.reduce((s,x)=>s+(x.roster?.length||0),0),coaches:rows.reduce((s,x)=>s+(x.coaches?.length||0),0),scheduleItems:rows.reduce((s,x)=>s+(x.schedule?.length||0),0),errors:rows.reduce((s,x)=>s+(x.errors?.length||0),0)}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n");console.log(JSON.stringify(payload.quality,null,2));
