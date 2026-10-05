/**
 * Live Statcast feed for MLB pitch-shape x hitter-zone matchup research.
 *
 * Uses Ballpark Pal's matched batter/starter identities to define the expected
 * lineup, then pulls independent Baseball Savant pitch-level data. No odds.
 */

import { readCache, writeCache } from "./cache.js";
import { buildLineupMatchup, buildStatcastProfiles, MLB_PITCH_MATCHUP_VERSION } from "./mlbPitchMatchup.js";

const TTL_MS = 4 * 60 * 60 * 1000;
const ERR_TTL_MS = 20 * 60 * 1000;
const LOOKBACK_DAYS = 90;
const POSTSEASON_PITCHER_LOOKBACK_DAYS = 60;
const POSTSEASON_BATTER_LOOKBACK_DAYS = 75;
const POSTSEASON_PITCHER_HALF_LIFE_DAYS = 21;
const POSTSEASON_BATTER_HALF_LIFE_DAYS = 35;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function finite(v){ if(v==null||v==="")return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function dateOnly(v){
  const d=new Date(v||Date.now());
  if(!Number.isFinite(d.getTime()))return new Date().toISOString().slice(0,10);
  return d.toISOString().slice(0,10);
}
function addDays(date,days){ const d=new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }

function splitCsvLine(line){
  const out=[];let cur="";let q=false;
  for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;continue;}if(c===","&&!q){out.push(cur);cur="";continue;}cur+=c;}
  out.push(cur);return out;
}
export function parseStatcastCsv(text){
  const lines=String(text||"").replace(/^\uFEFF/,"").trim().split(/\r?\n/);
  if(lines.length<2)return[];
  const headers=splitCsvLine(lines[0]).map(x=>x.trim().replace(/^"|"$/g,""));
  return lines.slice(1).filter(Boolean).map(line=>{const cells=splitCsvLine(line);const row={};headers.forEach((h,i)=>row[h]=cells[i]??"");return row;});
}

function statcastUrl({role, ids, start, end}){
  const u=new URL("https://baseballsavant.mlb.com/statcast_search/csv");
  u.searchParams.set("all","true");
  u.searchParams.set("type","details");
  u.searchParams.set("player_type",role);
  u.searchParams.set("game_date_gt",start);
  u.searchParams.set("game_date_lt",end);
  u.searchParams.set("hfGT","R|PO|");
  u.searchParams.set("min_pitches","0");
  u.searchParams.set("min_results","0");
  u.searchParams.set("group_by","name");
  u.searchParams.set("sort_col","pitches");
  u.searchParams.set("sort_order","desc");
  u.searchParams.set("min_pas","0");
  for(const id of ids||[])u.searchParams.append(role==="pitcher"?"pitchers_lookup[]":"batters_lookup[]",String(id));
  return u.toString();
}
async function fetchRows(args,fetchFn=fetch){
  const res=await fetchFn(statcastUrl(args),{headers:{Accept:"text/csv,*/*","User-Agent":UA,Referer:"https://baseballsavant.mlb.com/"}});
  if(!res.ok)throw new Error(`Statcast ${res.status}`);
  return parseStatcastCsv(await res.text());
}
async function loadProfiles({role,ids,asOf,env={},fetchFn=fetch,lookbackDays=LOOKBACK_DAYS,halfLifeDays=45}){
  const clean=[...new Set((ids||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
  if(!clean.length)return{};
  const end=dateOnly(asOf);
  const start=addDays(end,-lookbackDays);
  const cacheKey=`mlb-pitch-matchup-v2:${role}:${start}:${end}:hl${halfLifeDays}:${clean.join("-")}`;
  const cached=await readCache(cacheKey,env.caches,TTL_MS);
  if(cached?.profiles)return cached.profiles;
  try{
    const rows=await fetchRows({role,ids:clean,start,end},fetchFn);
    const profiles=buildStatcastProfiles(rows,{role,asOf:`${end}T23:59:59Z`,halfLifeDays});
    await writeCache(cacheKey,{profiles,rows:rows.length,asOf:new Date().toISOString()},env.caches,TTL_MS);
    return profiles;
  }catch(err){
    await writeCache(cacheKey,{profiles:{},error:String(err?.message||err)},env.caches,ERR_TTL_MS);
    return{};
  }
}
function starterId(game,side){ return Number(game?.[side==="home"?"homeSp":"awaySp"]?.id); }
function lineupIdsVsStarter(game,pitcherId){
  const rows=game?.bpp?.batterMatchups||[];
  return [...new Set(rows.filter(r=>Number(r?.pitcherId)===Number(pitcherId)).map(r=>Number(r?.batterId)).filter(Number.isFinite))];
}
function expectedIp(game,side){
  const ctx=game?.mlbContext||{};
  const key=side==="home"?"homeStarterExpectedInnings":"awayStarterExpectedInnings";
  const palKey=side==="home"?"homePalStarterExpectedInnings":"awayPalStarterExpectedInnings";
  const sav=side==="home"?game?.savant?.homeSpInningsPerStart:game?.savant?.awaySpInningsPerStart;
  return finite(ctx[key])??finite(sav)??finite(ctx[palKey])??5.35;
}
function bfPerIp(game,side){
  const sav=game?.savant||{};
  const bf=finite(side==="home"?sav.homeSpBattersFacedPerInning:sav.awaySpBattersFacedPerInning);
  return bf??4.25;
}

async function buildSide(game,pitcherSide,env,fetchFn){
  const pid=starterId(game,pitcherSide);
  if(!Number.isFinite(pid))return null;
  const batterIds=lineupIdsVsStarter(game,pid);
  if(batterIds.length<5)return null;
  const postseason=game?.mlbPostseason?.postseason===true || game?.mlbContext?.postseason===true;
  const [pitchers,batters]=await Promise.all([
    loadProfiles({
      role:"pitcher",
      ids:[pid],
      asOf:game?.start||game?.date||Date.now(),
      env,
      fetchFn,
      lookbackDays:postseason?POSTSEASON_PITCHER_LOOKBACK_DAYS:LOOKBACK_DAYS,
      halfLifeDays:postseason?POSTSEASON_PITCHER_HALF_LIFE_DAYS:45,
    }),
    loadProfiles({
      role:"batter",
      ids:batterIds,
      asOf:game?.start||game?.date||Date.now(),
      env,
      fetchFn,
      lookbackDays:postseason?POSTSEASON_BATTER_LOOKBACK_DAYS:LOOKBACK_DAYS,
      halfLifeDays:postseason?POSTSEASON_BATTER_HALF_LIFE_DAYS:45,
    }),
  ]);
  const pitcher=pitchers[String(pid)];
  if(!pitcher)return null;
  const hitterProfiles=batterIds.map(id=>batters[String(id)]).filter(Boolean);
  const matchup=buildLineupMatchup({
    pitcherProfile:pitcher,
    batterProfiles:hitterProfiles,
    expectedInnings:expectedIp(game,pitcherSide),
    battersFacedPerInning:bfPerIp(game,pitcherSide),
  });
  return matchup?{
    ...matchup,
    pitcherId:pid,
    batterIds,
    batterProfiles:hitterProfiles.length,
    lookbackDays:postseason?(pitcherSide?POSTSEASON_PITCHER_LOOKBACK_DAYS:LOOKBACK_DAYS):LOOKBACK_DAYS,
    profileHalfLifeDays:postseason?POSTSEASON_PITCHER_HALF_LIFE_DAYS:45,
    postseason,
    source:"BASEBALL_SAVANT_STATCAST_PITCH_LEVEL",
  }:null;
}

export async function loadMlbPitchMatchupContext(games=[],env={},options={}){
  const fetchFn=options.fetchFn||fetch;
  const byGameId={};
  let available=0;
  for(const game of games||[]){
    if(game?.sport&&game.sport!=="mlb")continue;
    const [homeStarter,awayStarter]=await Promise.all([
      buildSide(game,"home",env,fetchFn).catch(()=>null),
      buildSide(game,"away",env,fetchFn).catch(()=>null),
    ]);
    // home offense faces away starter; away offense faces home starter.
    const packet={
      version:MLB_PITCH_MATCHUP_VERSION,
      homeOffense:awayStarter,
      awayOffense:homeStarter,
      asOf:new Date().toISOString(),
      marketInformed:false,
      canQualify:false,
    };
    if(homeStarter||awayStarter)available+=1;
    byGameId[String(game.id||game.bpp?.gamePk||"")]=packet;
  }
  return{
    byGameId,
    meta:{
      version:MLB_PITCH_MATCHUP_VERSION,
      source:"Baseball Savant Statcast pitch-level",
      games:(games||[]).length,
      available,
      lookbackDays:LOOKBACK_DAYS,
      postseasonPitcherLookbackDays:POSTSEASON_PITCHER_LOOKBACK_DAYS,
      postseasonPitcherHalfLifeDays:POSTSEASON_PITCHER_HALF_LIFE_DAYS,
      postseasonBatterHalfLifeDays:POSTSEASON_BATTER_HALF_LIFE_DAYS,
      marketInformed:false,
      canQualify:false,
    },
  };
}
