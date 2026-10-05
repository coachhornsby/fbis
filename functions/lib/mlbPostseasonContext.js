/**
 * MLB postseason context layer.
 *
 * Market-free operational adjustments for October:
 * - identify postseason game type/series state
 * - concentrate bullpen quality on the active pitching roster
 * - measure bullpen fatigue from recent actual usage
 * - estimate starter workload from recent starts + bullpen state
 *
 * No sportsbook or ACTION inputs. Fail-soft to regular-season context.
 */

import { readCache, writeCache } from "./cache.js";
import { loadMlbPersistentState } from "./mlbPersistentProfiles.js";

export const MLB_POSTSEASON_CONTEXT_VERSION = "research-v1-october-usage";
const POSTSEASON_TYPES = new Set(["F","D","L","W"]);
const TTL_MS = 30 * 60 * 1000;
const ERR_TTL_MS = 10 * 60 * 1000;

function finite(v){ if(v==null||v==="")return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function ymd(v){ const d=new Date(v||Date.now()); return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):new Date().toISOString().slice(0,10); }
function shiftDay(day,n){ const d=new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
async function getJson(url,fetchFn=fetch){
  const res=await fetchFn(url,{headers:{Accept:"application/json","User-Agent":"Mozilla/5.0 (compatible; FBIS/1.0)"}});
  if(!res.ok)throw new Error(`MLB postseason ${res.status}`);
  return res.json();
}

export function isMlbPostseasonGame(game={}){
  const type=String(game.gameType||game.mlbGameType||"").toUpperCase();
  if(POSTSEASON_TYPES.has(type))return true;
  return /wild card|division series|championship series|world series|postseason/i.test(String(game.seriesDescription||game.notes?.join(" ")||""));
}

export function postseasonRound(game={}){
  const type=String(game.gameType||game.mlbGameType||"").toUpperCase();
  if(type==="F")return "WILD_CARD";
  if(type==="D")return "DIVISION_SERIES";
  if(type==="L")return "LEAGUE_CHAMPIONSHIP";
  if(type==="W")return "WORLD_SERIES";
  return isMlbPostseasonGame(game)?"POSTSEASON":null;
}

async function activePitcherIds(teamId,date,fetchFn){
  const u=new URL(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster`);
  u.searchParams.set("rosterType","active");
  u.searchParams.set("date",date);
  u.searchParams.set("hydrate","person");
  const j=await getJson(u,fetchFn);
  return (j.roster||[])
    .filter(r=>String(r.position?.type||"").toLowerCase()==="pitcher")
    .map(r=>Number(r.person?.id))
    .filter(Number.isFinite);
}

async function activePitchingStats(teamId,season,fetchFn){
  const u=new URL("https://statsapi.mlb.com/api/v1/stats");
  u.searchParams.set("stats","season");
  u.searchParams.set("group","pitching");
  u.searchParams.set("teamId",String(teamId));
  u.searchParams.set("season",String(season));
  u.searchParams.set("playerPool","ALL");
  u.searchParams.set("limit","100");
  const j=await getJson(u,fetchFn);
  const splits=(j.stats||[]).flatMap(s=>s.splits||[]);
  return splits.map(s=>({
    id:Number(s.player?.id),
    name:s.player?.fullName||null,
    era:finite(s.stat?.era),
    innings:finite(s.stat?.inningsPitched),
    games:finite(s.stat?.gamesPitched),
    starts:finite(s.stat?.gamesStarted),
    whip:finite(s.stat?.whip),
    k9:finite(s.stat?.strikeoutsPer9Inn),
  })).filter(x=>Number.isFinite(x.id));
}

function coreBullpen(activeIds,stats,probableStarterId){
  const active=new Set((activeIds||[]).map(Number));
  const rows=(stats||[])
    .filter(p=>active.has(Number(p.id))&&Number(p.id)!==Number(probableStarterId))
    .map(p=>({...p,reliefGames:Math.max(0,(p.games||0)-(p.starts||0))}))
    .filter(p=>p.reliefGames>=8&&p.innings>=8&&p.era!=null)
    .sort((a,b)=>b.reliefGames-a.reliefGames || (a.era??99)-(b.era??99))
    .slice(0,6);
  const weights=rows.map((p,i)=>Math.max(1,(p.reliefGames||1)*(1-i*0.08)));
  const denom=weights.reduce((a,b)=>a+b,0);
  const era=denom?rows.reduce((s,p,i)=>s+(p.era||4.15)*weights[i],0)/denom:null;
  return {era,relievers:rows,ids:rows.map(x=>x.id),count:rows.length};
}

async function recentTeamGames(teamId,date,fetchFn){
  const u=new URL("https://statsapi.mlb.com/api/v1/schedule");
  u.searchParams.set("sportId","1");
  u.searchParams.set("teamId",String(teamId));
  u.searchParams.set("startDate",shiftDay(date,-3));
  u.searchParams.set("endDate",shiftDay(date,-1));
  const j=await getJson(u,fetchFn);
  return (j.dates||[]).flatMap(d=>d.games||[])
    .filter(g=>String(g.status?.abstractGameState||"").toLowerCase()==="final")
    .map(g=>({gamePk:Number(g.gamePk),date:String(g.gameDate||"").slice(0,10)}))
    .filter(g=>Number.isFinite(g.gamePk));
}

async function gamePitchUsage(gamePk,teamId,fetchFn){
  const j=await getJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,fetchFn);
  const teams=j.liveData?.boxscore?.teams||{};
  for(const side of ["home","away"]){
    const t=teams[side];
    if(Number(t?.team?.id)!==Number(teamId))continue;
    const ids=(t.pitchers||[]).map(Number).filter(Number.isFinite);
    const starter=ids[0]??null;
    return ids.slice(1).map(id=>{
      const p=t.players?.[`ID${id}`]||{};
      return {
        id,
        pitches:finite(p.stats?.pitching?.numberOfPitches)??0,
        innings:finite(p.stats?.pitching?.inningsPitched)??0,
        starter:id===starter,
      };
    });
  }
  return [];
}

async function bullpenUsage(teamId,date,coreIds,fetchFn){
  const games=await recentTeamGames(teamId,date,fetchFn);
  const usage=[];
  for(const g of games){
    const rows=await gamePitchUsage(g.gamePk,teamId,fetchFn).catch(()=>[]);
    for(const row of rows)usage.push({...row,date:g.date});
  }
  const core=new Set((coreIds||[]).map(Number));
  const todayMs=Date.parse(`${date}T12:00:00Z`);
  let corePitches1d=0,corePitches2d=0,totalPitches2d=0,coreRelieversUsed1d=0;
  const usedYesterday=new Set();
  for(const u of usage){
    const age=Math.round((todayMs-Date.parse(`${u.date}T12:00:00Z`))/86400000);
    if(age<=2) totalPitches2d+=u.pitches||0;
    if(core.has(Number(u.id))){
      if(age<=1){corePitches1d+=u.pitches||0;usedYesterday.add(Number(u.id));}
      if(age<=2)corePitches2d+=u.pitches||0;
    }
  }
  coreRelieversUsed1d=usedYesterday.size;
  const fatigueScore=clamp(
    (corePitches1d/110)*0.55 + (corePitches2d/190)*0.30 + (totalPitches2d/260)*0.15,
    0,
    1.5
  );
  // Conservative bounded ERA multiplier. Rested = no bonus; fatigue can hurt.
  const bullpenEraMultiplier=clamp(1+Math.max(0,fatigueScore-0.45)*0.08,1,1.08);
  return {games:games.length,corePitches1d,corePitches2d,totalPitches2d,coreRelieversUsed1d,fatigueScore, bullpenEraMultiplier};
}

async function recentStarterWorkload(pitcherId,season,fetchFn){
  const id=Number(pitcherId);
  if(!Number.isFinite(id))return null;
  const u=new URL(`https://statsapi.mlb.com/api/v1/people/${id}/stats`);
  u.searchParams.set("stats","gameLog");
  u.searchParams.set("group","pitching");
  u.searchParams.set("season",String(season));
  const j=await getJson(u,fetchFn);
  const splits=(j.stats||[]).flatMap(s=>s.splits||[])
    .filter(s=>(finite(s.stat?.gamesStarted)??0)>0)
    .map(s=>({date:s.date||null,innings:finite(s.stat?.inningsPitched),pitches:finite(s.stat?.numberOfPitches),battersFaced:finite(s.stat?.battersFaced)}))
    .filter(x=>x.innings!=null)
    .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")))
    .slice(0,4);
  if(!splits.length)return null;
  const mean=(key)=>{const xs=splits.map(x=>x[key]).filter(Number.isFinite);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;};
  return {starts:splits.length,innings:mean("innings"),pitches:mean("pitches"),battersFaced:mean("battersFaced")};
}

function expectedStarterIp(base,recent,bullpen){
  const b=finite(base)??5.35;
  const r=finite(recent?.innings);
  let ip=r!=null?b*0.45+r*0.55:b;
  const fatigue=finite(bullpen?.fatigueScore)??0;
  if(fatigue>0.85)ip+=0.18;
  else if(fatigue<0.25)ip-=0.08;
  // No blanket postseason innings haircut. Recent starter usage and current
  // bullpen fatigue drive the bounded workload adjustment.
  return clamp(ip,3.5,7.0);
}

async function teamPacket({teamId,date,season,probableStarterId,baseBullpenEra,baseStarterIp,fetchFn}){
  const [activeIds,stats,recentStarter]=await Promise.all([
    activePitcherIds(teamId,date,fetchFn).catch(()=>[]),
    activePitchingStats(teamId,season,fetchFn).catch(()=>[]),
    recentStarterWorkload(probableStarterId,season,fetchFn).catch(()=>null),
  ]);
  const core=coreBullpen(activeIds,stats,probableStarterId);
  const usage=await bullpenUsage(teamId,date,core.ids,fetchFn).catch(()=>({games:0,corePitches1d:0,corePitches2d:0,totalPitches2d:0,coreRelieversUsed1d:0,fatigueScore:0,bullpenEraMultiplier:1}));
  const concentratedEra=finite(core.era)??finite(baseBullpenEra);
  const adjustedBullpenEra=concentratedEra!=null?clamp(concentratedEra*usage.bullpenEraMultiplier,2.2,6.5):null;
  return {
    activePitchers:activeIds.length,
    coreRelieverCount:core.count,
    coreRelieverIds:core.ids,
    coreBullpenEra:core.era,
    baseBullpenEra:finite(baseBullpenEra),
    bullpenEra:adjustedBullpenEra,
    bullpenFatigue:usage,
    recentStarter,
    expectedStarterInnings:expectedStarterIp(baseStarterIp,recentStarter,usage),
  };
}

export async function loadMlbPostseasonContext(games=[],env={},options={}){
  const fetchFn=options.fetchFn||fetch;
  const byGameId={};
  const postseason=(games||[]).filter(isMlbPostseasonGame);
  const persistent=options.persistentState || await loadMlbPersistentState(postseason,env,{maxAgeHours:options.maxPersistentAgeHours??10}).catch(()=>({byGameId:{},meta:{configured:false}}));
  // Production D1 is authoritative for operational state. Do not fan out to
  // active-roster/game-log/live-feed endpoints from customer board requests.
  const allowLiveFallback=options.allowLiveFallback===true || !env?.DB?.prepare;
  for(const game of postseason){
    const persistentState=persistent.byGameId?.[String(game.id)]||null;
    if(persistentState?.fresh){
      const homeTeam=persistentState.homeTeam||{},awayTeam=persistentState.awayTeam||{};
      const homeStarter=persistentState.homeStarter||{},awayStarter=persistentState.awayStarter||{};
      const packet={
        version:MLB_POSTSEASON_CONTEXT_VERSION,
        postseason:true,
        round:postseasonRound(game),
        gameType:game.gameType||null,
        seriesDescription:game.seriesDescription||null,
        seriesGameNumber:finite(game.seriesGameNumber),
        gamesInSeries:finite(game.gamesInSeries),
        home:{
          activePitchers:homeTeam?.lineup?.activePitchers?.length??null,
          coreRelieverCount:homeTeam?.bullpen?.coreRelievers?.length??0,
          coreRelieverIds:(homeTeam?.bullpen?.coreRelievers||[]).map(x=>x.id),
          coreBullpenEra:finite(homeTeam?.bullpen?.coreBullpenEra),
          bullpenEra:finite(homeTeam?.bullpen?.adjustedBullpenEra),
          bullpenFatigue:homeTeam?.bullpen?.fatigue||null,
          recentStarter:homeStarter?.recentStarter||null,
          expectedStarterInnings:finite(homeStarter?.expectedInnings)??finite(homeStarter?.inningsPerStart),
        },
        away:{
          activePitchers:awayTeam?.lineup?.activePitchers?.length??null,
          coreRelieverCount:awayTeam?.bullpen?.coreRelievers?.length??0,
          coreRelieverIds:(awayTeam?.bullpen?.coreRelievers||[]).map(x=>x.id),
          coreBullpenEra:finite(awayTeam?.bullpen?.coreBullpenEra),
          bullpenEra:finite(awayTeam?.bullpen?.adjustedBullpenEra),
          bullpenFatigue:awayTeam?.bullpen?.fatigue||null,
          recentStarter:awayStarter?.recentStarter||null,
          expectedStarterInnings:finite(awayStarter?.expectedInnings)??finite(awayStarter?.inningsPerStart),
        },
        persistent:true,
        persistentAsOf:persistentState.asOf,
        marketInformed:false,
        canQualify:false,
        asOf:persistentState.asOf,
      };
      byGameId[String(game.id)]=packet;
      continue;
    }
    if(!allowLiveFallback){
      byGameId[String(game.id)]={
        version:MLB_POSTSEASON_CONTEXT_VERSION,
        postseason:true,
        round:postseasonRound(game),
        persistent:true,
        unavailable:true,
        reason:"PERSISTENT_PROFILE_MISSING_OR_STALE",
        marketInformed:false,
        canQualify:false,
      };
      continue;
    }
    const date=ymd(game.start||game.date);
    const season=Number(date.slice(0,4));
    const key=`mlb-postseason-v1:${date}:${game.id}`;
    const cached=await readCache(key,env.caches,TTL_MS);
    if(cached){byGameId[String(game.id)]=cached;continue;}
    try{
      const [home,away]=await Promise.all([
        teamPacket({
          teamId:Number(game.home?.mlbId),date,season,probableStarterId:Number(game.homeSp?.id),
          baseBullpenEra:game.mlbContext?.homeBullpenEra,
          baseStarterIp:game.savant?.homeSpInningsPerStart ?? game.mlbContext?.homePalStarterExpectedInnings,
          fetchFn,
        }),
        teamPacket({
          teamId:Number(game.away?.mlbId),date,season,probableStarterId:Number(game.awaySp?.id),
          baseBullpenEra:game.mlbContext?.awayBullpenEra,
          baseStarterIp:game.savant?.awaySpInningsPerStart ?? game.mlbContext?.awayPalStarterExpectedInnings,
          fetchFn,
        }),
      ]);
      const packet={
        version:MLB_POSTSEASON_CONTEXT_VERSION,
        postseason:true,
        round:postseasonRound(game),
        gameType:game.gameType||null,
        seriesDescription:game.seriesDescription||null,
        seriesGameNumber:finite(game.seriesGameNumber),
        gamesInSeries:finite(game.gamesInSeries),
        home,
        away,
        marketInformed:false,
        canQualify:false,
        asOf:new Date().toISOString(),
      };
      await writeCache(key,packet,env.caches,TTL_MS);
      byGameId[String(game.id)]=packet;
    }catch(err){
      const packet={version:MLB_POSTSEASON_CONTEXT_VERSION,postseason:true,round:postseasonRound(game),error:String(err?.message||err),marketInformed:false,canQualify:false};
      await writeCache(key,packet,env.caches,ERR_TTL_MS);
      byGameId[String(game.id)]=packet;
    }
  }
  return {
    byGameId,
    meta:{
      version:MLB_POSTSEASON_CONTEXT_VERSION,
      postseasonGames:postseason.length,
      available:Object.values(byGameId).filter(x=>x?.home||x?.away).length,
      persistentAvailable:Object.values(byGameId).filter(x=>x?.persistent&&x?.home&&x?.away).length,
      persistentConfigured:Boolean(persistent.meta?.configured),
      liveFanoutDisabled:Boolean(env?.DB?.prepare&&!allowLiveFallback),
      marketInformed:false,
      canQualify:false,
    },
  };
}

export function attachMlbPostseasonContext(games=[],feed={}){
  return (games||[]).map(game=>{
    if(!isMlbPostseasonGame(game))return game;
    const p=feed.byGameId?.[String(game.id)]||null;
    if(!p)return {...game,mlbPostseason:{postseason:true,unavailable:true}};
    return {
      ...game,
      mlbPostseason:p,
      mlbContext:{
        ...(game.mlbContext||{}),
        postseason:true,
        postseasonRound:p.round||null,
        postseasonContextVersion:p.version||null,
        homeBullpenEra:p.home?.bullpenEra ?? game.mlbContext?.homeBullpenEra ?? null,
        awayBullpenEra:p.away?.bullpenEra ?? game.mlbContext?.awayBullpenEra ?? null,
        homeStarterExpectedInnings:p.home?.expectedStarterInnings ?? game.mlbContext?.homeStarterExpectedInnings ?? null,
        awayStarterExpectedInnings:p.away?.expectedStarterInnings ?? game.mlbContext?.awayStarterExpectedInnings ?? null,
        homeBullpenFatigueScore:p.home?.bullpenFatigue?.fatigueScore ?? null,
        awayBullpenFatigueScore:p.away?.bullpenFatigue?.fatigueScore ?? null,
        homePostseasonCoreBullpenEra:p.home?.coreBullpenEra ?? null,
        awayPostseasonCoreBullpenEra:p.away?.coreBullpenEra ?? null,
      },
    };
  });
}
