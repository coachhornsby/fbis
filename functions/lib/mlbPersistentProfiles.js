/**
 * Persistent MLB team/player state helpers.
 *
 * Scheduled collectors own expensive upstream fanout. Live board requests read
 * these compact D1 profiles and fail-soft if they are stale/missing.
 */
import { buildLineupMatchup } from "./mlbPitchMatchup.js";

export const MLB_PERSISTENT_PROFILE_VERSION="mlb-state-v2";
const HOUR=3600000;

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const safeJson=v=>{try{return typeof v==="string"?JSON.parse(v):v}catch{return null}};
export function normalizeMlbName(v){return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
export function profileAgeHours(asOf,now=Date.now()){const t=Date.parse(asOf||"");return Number.isFinite(t)?round(Math.max(0,(now-t)/HOUR),2):null}
export function profileFresh(asOf,{maxAgeHours=12,now=Date.now()}={}){const age=profileAgeHours(asOf,now);return age!=null&&age<=maxAgeHours}

export function bullpenFatigueFromUsage(rows=[]){
  let p1=0,p2=0,total2=0;const yesterday=new Set();
  const nowDay=rows.reduce((m,r)=>Math.max(m,Date.parse((r.asOf||r.date||"1970-01-01").slice(0,10)+"T12:00:00Z")||0),0);
  for(const r of rows||[]){
    const t=Date.parse(String(r.date||"").slice(0,10)+"T12:00:00Z");
    const age=nowDay&&Number.isFinite(t)?Math.round((nowDay-t)/86400000):9;
    const pitches=finite(r.pitches)||0;
    if(age<=2)total2+=pitches;
    if(r.core){
      if(age<=1){p1+=pitches;yesterday.add(String(r.playerId||""))}
      if(age<=2)p2+=pitches;
    }
  }
  const score=Math.max(0,Math.min(1.5,(p1/110)*.55+(p2/190)*.30+(total2/260)*.15));
  return {corePitches1d:p1,corePitches2d:p2,totalPitches2d:total2,coreRelieversUsed1d:yesterday.size,fatigueScore:round(score),bullpenEraMultiplier:round(Math.max(1,Math.min(1.08,1+Math.max(0,score-.45)*.08)))};
}

export function expectedStarterInnings({seasonIpPerStart,recentIp,bullpenFatigue}={}){
  const base=finite(seasonIpPerStart)??5.35,recent=finite(recentIp),fatigue=finite(bullpenFatigue)??0;
  let ip=recent!=null?base*.45+recent*.55:base;
  if(fatigue>.85)ip+=.18;else if(fatigue<.25)ip-=.08;
  return round(Math.max(3.5,Math.min(7,ip)),2);
}

async function all(db,sql,bind=[]){
  if(!db?.prepare)return[];
  try{const s=db.prepare(sql);const q=bind.length?s.bind(...bind):s;const r=await q.all();return r?.results||[]}catch{return[]}
}

export async function loadMlbPersistentState(games=[],env={},opts={}){
  const db=env?.DB;if(!db?.prepare)return{byGameId:{},meta:{configured:false,reason:"d1-unbound"}};
  const teamIds=[...new Set((games||[]).flatMap(g=>[g.home?.mlbId,g.away?.mlbId]).map(Number).filter(Number.isFinite))];
  const playerIds=[...new Set((games||[]).flatMap(g=>[
    g.homeSp?.id,g.awaySp?.id,
    ...(g.bpp?.batterMatchups||[]).map(x=>x?.batterId)
  ]).map(Number).filter(Number.isFinite))];
  if(!teamIds.length)return{byGameId:{},meta:{configured:true,teams:0,players:0}};
  const tq=teamIds.map(()=>"?").join(",");
  const pq=playerIds.length?playerIds.map(()=>"?").join(","):"NULL";
  const [teams,pitchers,hitters]=await Promise.all([
    all(db,`SELECT team_id,team_key,as_of,profile_json,bullpen_json,lineup_json,schedule_json FROM mlb_team_profiles WHERE team_id IN (${tq})`,teamIds.map(String)),
    playerIds.length?all(db,`SELECT player_id,team_id,as_of,profile_json FROM mlb_pitcher_profiles WHERE player_id IN (${pq})`,playerIds.map(String)):[],
    all(db,`SELECT player_id,team_id,as_of,profile_json FROM mlb_hitter_profiles WHERE team_id IN (${tq})`,teamIds.map(String)),
  ]);
  const tMap=new Map(teams.map(x=>[String(x.team_id),x]));
  const pMap=new Map(pitchers.map(x=>[String(x.player_id),{...x,profile:safeJson(x.profile_json)}]));
  const hMap=new Map(hitters.map(x=>[String(x.player_id),{...x,profile:safeJson(x.profile_json)}]));
  const hittersByTeam=new Map();
  for(const row of hitters){
    const key=String(row.team_id||"");
    if(!hittersByTeam.has(key))hittersByTeam.set(key,{});
    hittersByTeam.get(key)[String(row.player_id)]={...row,profile:safeJson(row.profile_json)};
  }
  const byGameId={};
  for(const game of games||[]){
    const home=tMap.get(String(game.home?.mlbId)),away=tMap.get(String(game.away?.mlbId));
    const homeSp=pMap.get(String(game.homeSp?.id)),awaySp=pMap.get(String(game.awaySp?.id));
    const batterIds=[...new Set((game.bpp?.batterMatchups||[]).map(x=>Number(x?.batterId)).filter(Number.isFinite))];
    const batterProfiles=Object.fromEntries(batterIds.map(id=>[String(id),hMap.get(String(id))?.profile]).filter(([,v])=>v));
    const teamHitterProfiles={
      home:Object.fromEntries(Object.entries(hittersByTeam.get(String(game.home?.mlbId))||{}).map(([id,row])=>[id,row.profile]).filter(([,v])=>v)),
      away:Object.fromEntries(Object.entries(hittersByTeam.get(String(game.away?.mlbId))||{}).map(([id,row])=>[id,row.profile]).filter(([,v])=>v)),
    };
    const asOf=[home?.as_of,away?.as_of,homeSp?.as_of,awaySp?.as_of].filter(Boolean).sort().at(0)||null;
    byGameId[String(game.id||game.bpp?.gamePk||"")]={
      version:MLB_PERSISTENT_PROFILE_VERSION,
      asOf,
      ageHours:profileAgeHours(asOf),
      fresh:profileFresh(asOf,{maxAgeHours:opts.maxAgeHours??12}),
      homeTeam:home?{...safeJson(home.profile_json),bullpen:safeJson(home.bullpen_json),lineup:safeJson(home.lineup_json),schedule:safeJson(home.schedule_json)}:null,
      awayTeam:away?{...safeJson(away.profile_json),bullpen:safeJson(away.bullpen_json),lineup:safeJson(away.lineup_json),schedule:safeJson(away.schedule_json)}:null,
      homeStarter:homeSp?.profile||null,
      awayStarter:awaySp?.profile||null,
      hitters:{...teamHitterProfiles.home,...teamHitterProfiles.away,...batterProfiles},
      teamHitters:teamHitterProfiles,
      marketInformed:false,
    };
  }
  return{byGameId,meta:{configured:true,version:MLB_PERSISTENT_PROFILE_VERSION,teams:teams.length,pitchers:pitchers.length,hitters:hitters.length,games:(games||[]).length,propStateLoaded:true}};
}

function lineupIds(game,pitcherId){return [...new Set((game?.bpp?.batterMatchups||[]).filter(r=>Number(r?.pitcherId)===Number(pitcherId)).map(r=>Number(r?.batterId)).filter(Number.isFinite))]}
function persistentSide(game,side,state){
  const pid=Number(game?.[side==="home"?"homeSp":"awaySp"]?.id);if(!Number.isFinite(pid))return null;
  const pitcher=side==="home"?state?.homeStarter:state?.awayStarter;
  if(!pitcher?.statcastProfile)return null;
  const ids=lineupIds(game,pid);if(ids.length<5)return null;
  const batters=ids.map(id=>state?.hitters?.[String(id)]?.statcastProfile).filter(Boolean);
  if(batters.length<5)return null;
  const team=side==="home"?state?.homeTeam:state?.awayTeam;
  const ip=finite(team?.starterState?.[String(pid)]?.expectedInnings)??finite(pitcher.expectedInnings)??finite(pitcher.inningsPerStart)??5.35;
  const bfpi=finite(pitcher.battersFacedPerInning)??4.25;
  const m=buildLineupMatchup({pitcherProfile:pitcher.statcastProfile,batterProfiles:batters,expectedInnings:ip,battersFacedPerInning:bfpi});
  return m?{...m,pitcherId:pid,batterIds:ids,batterProfiles:batters.length,source:"MLB_PERSISTENT_STATCAST_PROFILE",profileAsOf:pitcher.asOf||state.asOf,marketInformed:false}:null;
}
export function buildPersistentPitchMatchup(game,state){
  if(!state?.fresh)return null;
  const homeStarter=persistentSide(game,"home",state),awayStarter=persistentSide(game,"away",state);
  return {
    version:MLB_PERSISTENT_PROFILE_VERSION,
    homeOffense:awayStarter,
    awayOffense:homeStarter,
    asOf:state.asOf,
    persistent:true,
    marketInformed:false,
    canQualify:false,
  };
}


export function buildPersistentBullpenFeed(games=[],persistent={}){
  const byTeamId={};
  let available=0;
  for(const game of games||[]){
    const key=String(game.id||game.bpp?.gamePk||"");
    const state=persistent?.byGameId?.[key]||null;
    for(const [side,teamState] of [["home",state?.homeTeam],["away",state?.awayTeam]]){
      const teamId=String(game?.[side]?.mlbId??"");
      if(!teamId||byTeamId[teamId])continue;
      const bullpen=teamState?.bullpen||null;
      const era=finite(bullpen?.adjustedBullpenEra)??finite(bullpen?.coreBullpenEra);
      if(era!=null)available+=1;
      byTeamId[teamId]={
        teamId:Number(teamId),
        era,
        coreBullpenEra:finite(bullpen?.coreBullpenEra),
        adjustedBullpenEra:finite(bullpen?.adjustedBullpenEra),
        fatigue:bullpen?.fatigue||null,
        coreRelievers:Array.isArray(bullpen?.coreRelievers)?bullpen.coreRelievers:[],
        source:"MLB persistent D1 profile",
        asOf:state?.asOf||null,
        persistent:true,
        unavailable:era==null,
      };
    }
  }
  return {
    byTeamId,
    meta:{
      source:"MLB persistent D1 profile",
      teams:Object.keys(byTeamId).length,
      available,
      persistent:true,
      liveFanout:false,
      marketInformed:false,
    },
  };
}

export function attachMlbPersistentState(games=[],persistent={}){
  return (games||[]).map(game=>{
    const key=String(game.id||game.bpp?.gamePk||"");
    const state=persistent?.byGameId?.[key]||null;
    if(!state)return game;
    return {
      ...game,
      mlbPersistentState:{
        version:state.version,
        asOf:state.asOf,
        ageHours:state.ageHours,
        fresh:state.fresh,
        homeTeam:state.homeTeam?{
          teamId:game.home?.mlbId??null,
          bullpen:state.homeTeam.bullpen||null,
          lineup:state.homeTeam.lineup||null,
          schedule:state.homeTeam.schedule||null,
          starterState:state.homeTeam.starterState||null,
        }:null,
        awayTeam:state.awayTeam?{
          teamId:game.away?.mlbId??null,
          bullpen:state.awayTeam.bullpen||null,
          lineup:state.awayTeam.lineup||null,
          schedule:state.awayTeam.schedule||null,
          starterState:state.awayTeam.starterState||null,
        }:null,
        homeStarter:state.homeStarter||null,
        awayStarter:state.awayStarter||null,
        hitterProfileCount:Object.keys(state.hitters||{}).length,
        marketInformed:false,
      },
    };
  });
}


export function attachMlbPersistentFeatureContext(games=[],persistent={}){
  return (games||[]).map(game=>{
    const key=String(game.id||game.bpp?.gamePk||"");
    const state=persistent?.byGameId?.[key]||null;
    if(!state?.fresh)return game;
    const homeOff=state.homeTeam?.offense||null;
    const awayOff=state.awayTeam?.offense||null;
    const homeSp=state.homeStarter||null;
    const awaySp=state.awayStarter||null;
    const existing=game.savant||{};
    const packet={
      homeRpg:finite(homeOff?.rpg)??finite(existing.homeRpg),
      awayRpg:finite(awayOff?.rpg)??finite(existing.awayRpg),
      homeSpEra:finite(homeSp?.era)??finite(existing.homeSpEra),
      awaySpEra:finite(awaySp?.era)??finite(existing.awaySpEra),
      homeSpKPer9:finite(homeSp?.k9)??finite(existing.homeSpKPer9),
      awaySpKPer9:finite(awaySp?.k9)??finite(existing.awaySpKPer9),
      homeSpKRate:finite(homeSp?.kRate)??finite(existing.homeSpKRate),
      awaySpKRate:finite(awaySp?.kRate)??finite(existing.awaySpKRate),
      homeSpInningsPerStart:finite(homeSp?.inningsPerStart)??finite(existing.homeSpInningsPerStart),
      awaySpInningsPerStart:finite(awaySp?.inningsPerStart)??finite(existing.awaySpInningsPerStart),
      homeSpBattersFacedPerInning:finite(homeSp?.battersFacedPerInning)??finite(existing.homeSpBattersFacedPerInning),
      awaySpBattersFacedPerInning:finite(awaySp?.battersFacedPerInning)??finite(existing.awaySpBattersFacedPerInning),
      homeSpGamesStarted:finite(homeSp?.starts)??finite(existing.homeSpGamesStarted),
      awaySpGamesStarted:finite(awaySp?.starts)??finite(existing.awaySpGamesStarted),
      homeOpponentKRate:finite(awayOff?.kRate)??finite(existing.homeOpponentKRate),
      awayOpponentKRate:finite(homeOff?.kRate)??finite(existing.awayOpponentKRate),
      leagueKRate:finite(existing.leagueKRate)??0.225,
      weatherRunFactor:finite(existing.weatherRunFactor)??1,
      source:"MLB persistent D1 state",
      persistent:true,
      asOf:state.asOf,
    };
    return {...game,savant:packet};
  });
}
