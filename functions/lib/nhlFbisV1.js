/**
 * NHL-FBIS-v1 — five-layer independent hockey research model.
 *
 * Layers:
 *  1) historical 5v5 xG team strength
 *  2) goalie value / expected starter uncertainty
 *  3) special teams
 *  4) rest / travel / home ice
 *  5) probabilistic score distribution
 *
 * No sportsbook input enters the projection. Market lines are consumed only
 * after projection for research comparison/probability display and never for
 * qualification while this model is RESEARCH.
 */

import { NHL_FBIS_V1_ARTIFACT } from "../../data/models/nhl-fbis-v1.js";

export const NHL_FBIS_V1_ID = "NHL-FBIS-v1";
export const NHL_FBIS_V1_VERSION = "research-v1-five-layer";

const STATS = "https://api.nhle.com/stats/rest/en";
const WEB = "https://api-web.nhle.com/v1";
const HOME_ICE_GOALS = 0.12;
const CURRENT_BLEND_GAMES = 25;

const TEAM_GEO = Object.freeze({
  ANA:[33.8078,-117.8765],BOS:[42.3662,-71.0621],BUF:[42.8750,-78.8766],CGY:[51.0374,-114.0519],
  CAR:[35.8033,-78.7218],CHI:[41.8807,-87.6742],COL:[39.7487,-105.0077],CBJ:[39.9693,-83.0061],
  DAL:[32.7905,-96.8103],DET:[42.3411,-83.0550],EDM:[53.5469,-113.4977],FLA:[26.1584,-80.3256],
  LAK:[34.0430,-118.2673],MIN:[44.9448,-93.1011],MTL:[45.4961,-73.5693],NSH:[36.1592,-86.7785],
  NJD:[40.7335,-74.1710],NYI:[40.7229,-73.5907],NYR:[40.7505,-73.9934],OTT:[45.2969,-75.9272],
  PHI:[39.9012,-75.1720],PIT:[40.4396,-79.9892],SEA:[47.6221,-122.3540],SJS:[37.3328,-121.9012],
  STL:[38.6268,-90.2026],TBL:[27.9427,-82.4518],TOR:[43.6435,-79.3791],UTA:[40.7683,-111.9011],
  VAN:[49.2778,-123.1089],VGK:[36.1029,-115.1784],WSH:[38.8981,-77.0209],WPG:[49.8927,-97.1437]
});

function finite(v){
  if(v==null||v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function round(v,n=3){ const p=10**n; return Math.round(Number(v)*p)/p; }
function pct(v){
  const n=finite(v);
  if(n==null) return null;
  return n>1?n/100:n;
}
function dateOnly(v){
  const ms=Date.parse(String(v||""));
  return Number.isFinite(ms)?new Date(ms).toISOString().slice(0,10):null;
}
function seasonIds(date){
  const d=new Date(String(date||"")+"T12:00:00Z");
  const y=Number.isFinite(d.getTime())?d.getUTCFullYear():new Date().getUTCFullYear();
  const m=Number.isFinite(d.getTime())?d.getUTCMonth()+1:new Date().getUTCMonth()+1;
  const start=m>=7?y:y-1;
  return {current:Number(`${start}${start+1}`),prior:Number(`${start-1}${start}`)};
}
function statUrl(report,seasonId){
  const exp=encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2`);
  return `${STATS}/${report}?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=${exp}`;
}
async function fetchJson(url,fetcher=fetch){
  const res=await fetcher(url,{headers:{accept:"application/json","user-agent":"FBIS/1.0"}});
  if(!res.ok) throw new Error(`NHL_V1_HTTP_${res.status}`);
  return res.json();
}
function teamAbbr(row={}){
  return String(row.teamAbbrev||row.teamAbbreviation||row.rawTricode||row.triCode||"").trim().toUpperCase();
}
function normalizeSummary(row={}){
  const gp=finite(row.gamesPlayed)||0;
  const gf=finite(row.goalsFor);
  const ga=finite(row.goalsAgainst);
  return {
    abbr:teamAbbr(row),
    games:gp,
    gfpg:finite(row.goalsForPerGame)??(gp&&gf!=null?gf/gp:null),
    gapg:finite(row.goalsAgainstPerGame)??(gp&&ga!=null?ga/gp:null),
    pp:pct(row.powerPlayPct ?? row.ppPct ?? row.powerPlayPctg),
    pk:pct(row.penaltyKillPct ?? row.pkPct ?? row.penaltyKillPctg),
    shotsFor:finite(row.shotsForPerGame),
    shotsAgainst:finite(row.shotsAgainstPerGame)
  };
}
function specialTeamsMap(rows=[],kind){
  const out={};
  for(const row of rows||[]){
    const abbr=teamAbbr(row);
    if(!abbr) continue;
    const value=kind==="pp"
      ? pct(row.powerPlayPct ?? row.ppPct ?? row.powerPlayPctg)
      : pct(row.penaltyKillPct ?? row.pkPct ?? row.penaltyKillPctg);
    if(value!=null) out[abbr]=value;
  }
  return out;
}
function blendSummary(prior,current){
  if(!prior&&!current) return null;
  if(!current||!current.games) return prior;
  if(!prior) return current;
  const w=clamp(current.games/CURRENT_BLEND_GAMES,0,0.82);
  const mix=(a,b)=>{
    if(a==null) return b;
    if(b==null) return a;
    return (1-w)*a+w*b;
  };
  return {
    abbr:current.abbr||prior.abbr,
    games:current.games,
    gfpg:mix(prior.gfpg,current.gfpg),
    gapg:mix(prior.gapg,current.gapg),
    pp:mix(prior.pp,current.pp),
    pk:mix(prior.pk,current.pk),
    shotsFor:mix(prior.shotsFor,current.shotsFor),
    shotsAgainst:mix(prior.shotsAgainst,current.shotsAgainst),
    currentWeight:w
  };
}
function goalieRows(rows=[]){
  return rows.map(r=>({
    id:String(r.playerId||""),
    name:r.goalieFullName||null,
    teams:String(r.teamAbbrevs||"").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean),
    games:finite(r.gamesPlayed)||0,
    starts:finite(r.gamesStarted)||0,
    savePct:finite(r.savePct),
    gaa:finite(r.goalsAgainstAverage)
  })).filter(r=>r.id);
}
function scheduleGames(json){
  const out=[];
  for(const block of json?.gameWeek||[]){
    for(const g of block?.games||[]){
      out.push({
        id:String(g.id||""),
        start:g.startTimeUTC||null,
        home:String(g.homeTeam?.abbrev||"").toUpperCase(),
        away:String(g.awayTeam?.abbrev||"").toUpperCase(),
        state:String(g.gameState||"")
      });
    }
  }
  return out;
}
function haversine(a,b){
  if(!a||!b) return 0;
  const R=3958.8,toRad=Math.PI/180;
  const dLat=(b[0]-a[0])*toRad,dLon=(b[1]-a[1])*toRad;
  const la1=a[0]*toRad,la2=b[0]*toRad;
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function previousGameContext(team,targetStart,games,currentHome){
  const target=Date.parse(targetStart||"");
  if(!Number.isFinite(target)) return {restDays:null,backToBack:false,travelMiles:0};
  const prior=games
    .filter(g=>g.home===team||g.away===team)
    .filter(g=>Number.isFinite(Date.parse(g.start))&&Date.parse(g.start)<target)
    .sort((a,b)=>Date.parse(b.start)-Date.parse(a.start))[0];
  if(!prior) return {restDays:7,backToBack:false,travelMiles:0,previousGame:null};
  const days=Math.max(0,Math.floor((target-Date.parse(prior.start))/86400000));
  const priorVenue=TEAM_GEO[prior.home]||null;
  const currentVenue=TEAM_GEO[currentHome]||null;
  return {
    restDays:Math.max(0,days-1),
    backToBack:days<=1,
    travelMiles:round(haversine(priorVenue,currentVenue),0),
    previousGame:prior.id
  };
}
function situationalAdjustment(ctx,oppCtx,isHome){
  let adj=isHome?HOME_ICE_GOALS:0;
  if(ctx?.backToBack) adj-=0.12;
  if(oppCtx?.backToBack) adj+=0.06;
  const restDiff=(finite(ctx?.restDays)??3)-(finite(oppCtx?.restDays)??3);
  adj+=clamp(restDiff*0.025,-0.10,0.10);
  const miles=finite(ctx?.travelMiles)||0;
  if(miles>3000) adj-=0.10;
  else if(miles>2000) adj-=0.07;
  else if(miles>1000) adj-=0.04;
  return clamp(adj,-0.25,0.25);
}
function selectGoalie(team,currentGoalies,priorGoalies,artifact){
  const candidates=[];
  for(const g of currentGoalies||[]) if(g.teams.includes(team)&&g.starts>0) candidates.push({...g,source:"CURRENT",score:g.starts*10+g.games});
  for(const g of priorGoalies||[]) if(g.teams.includes(team)) candidates.push({...g,source:"PRIOR",score:g.starts});
  candidates.sort((a,b)=>b.score-a.score);
  const g=candidates[0]||null;
  if(!g){
    const fallback=artifact?.expectedGoalieByTeam?.[team];
    if(!fallback) return {goalieId:null,status:"UNKNOWN",impactGoals:0,reliability:0};
    return {
      goalieId:String(fallback.goalieId),
      status:"EXPECTED_STARTER_PRIOR",
      impactGoals:finite(fallback.impactGoalsPerGame)||0,
      reliability:0.50,
      source:"HISTORICAL_PBP"
    };
  }
  const learned=artifact?.goalies?.[g.id];
  const impact=finite(learned?.regressedImpactGoalsPerGame)||0;
  return {
    goalieId:g.id,
    name:g.name,
    status:g.source==="CURRENT"?"EXPECTED_STARTER_CURRENT":"EXPECTED_STARTER_PRIOR",
    impactGoals:impact,
    reliability:g.source==="CURRENT"?0.72:0.55,
    savePct:g.savePct,
    games:g.games,
    starts:g.starts,
    source:g.source
  };
}
function poissonPmf(lambda,k){
  let p=Math.exp(-lambda);
  for(let i=1;i<=k;i++) p*=lambda/i;
  return p;
}
function distribution(home,away,totalLine=null,homeSpread=null){
  const max=12;
  let homeReg=0,awayReg=0,tie=0,over=0,under=0,push=0,homeCover=0;
  for(let h=0;h<=max;h++){
    const ph=poissonPmf(home,h);
    for(let a=0;a<=max;a++){
      const p=ph*poissonPmf(away,a);
      if(h>a) homeReg+=p; else if(a>h) awayReg+=p; else tie+=p;
      if(totalLine!=null){
        const t=h+a;
        if(t>totalLine) over+=p; else if(t<totalLine) under+=p; else push+=p;
      }
      if(homeSpread!=null && h+homeSpread>a) homeCover+=p;
    }
  }
  const otHome=1/(1+Math.exp(-(home-away)/0.7));
  const homeWin=homeReg+tie*otHome;
  return {
    homeRegWin:round(homeReg,4),
    awayRegWin:round(awayReg,4),
    regulationTie:round(tie,4),
    homeWinIncludingOt:round(homeWin,4),
    awayWinIncludingOt:round(1-homeWin,4),
    over:totalLine==null?null:round(over,4),
    under:totalLine==null?null:round(under,4),
    push:totalLine==null?null:round(push,4),
    homeCover:homeSpread==null?null:round(homeCover,4)
  };
}

export async function loadNhlV1Context(date,games=[],{fetcher=fetch}={}){
  const ids=seasonIds(date);
  const [priorTeams,currentTeams,priorGoalies,currentGoalies,priorPp,currentPp,priorPk,currentPk,s1,s2]=await Promise.all([
    fetchJson(statUrl("team/summary",ids.prior),fetcher),
    fetchJson(statUrl("team/summary",ids.current),fetcher).catch(()=>({data:[]})),
    fetchJson(statUrl("goalie/summary",ids.prior),fetcher),
    fetchJson(statUrl("goalie/summary",ids.current),fetcher).catch(()=>({data:[]})),
    fetchJson(statUrl("team/powerplay",ids.prior),fetcher).catch(()=>({data:[]})),
    fetchJson(statUrl("team/powerplay",ids.current),fetcher).catch(()=>({data:[]})),
    fetchJson(statUrl("team/penaltykill",ids.prior),fetcher).catch(()=>({data:[]})),
    fetchJson(statUrl("team/penaltykill",ids.current),fetcher).catch(()=>({data:[]})),
    fetchJson(`${WEB}/schedule/${date}`,fetcher).catch(()=>({gameWeek:[]})),
    fetchJson(`${WEB}/schedule/${new Date(Date.parse(date+"T12:00:00Z")-7*86400000).toISOString().slice(0,10)}`,fetcher).catch(()=>({gameWeek:[]}))
  ]);
  const priorMap=Object.fromEntries((priorTeams.data||[]).map(normalizeSummary).filter(r=>r.abbr).map(r=>[r.abbr,r]));
  const currentMap=Object.fromEntries((currentTeams.data||[]).map(normalizeSummary).filter(r=>r.abbr).map(r=>[r.abbr,r]));
  const priorPpMap=specialTeamsMap(priorPp.data||[],"pp");
  const currentPpMap=specialTeamsMap(currentPp.data||[],"pp");
  const priorPkMap=specialTeamsMap(priorPk.data||[],"pk");
  const currentPkMap=specialTeamsMap(currentPk.data||[],"pk");
  for(const [abbr,row] of Object.entries(priorMap)){
    if(row.pp==null && priorPpMap[abbr]!=null) row.pp=priorPpMap[abbr];
    if(row.pk==null && priorPkMap[abbr]!=null) row.pk=priorPkMap[abbr];
  }
  for(const [abbr,row] of Object.entries(currentMap)){
    if(row.pp==null && currentPpMap[abbr]!=null) row.pp=currentPpMap[abbr];
    if(row.pk==null && currentPkMap[abbr]!=null) row.pk=currentPkMap[abbr];
  }
  const teams={};
  for(const abbr of new Set([...Object.keys(priorMap),...Object.keys(currentMap)])) teams[abbr]=blendSummary(priorMap[abbr],currentMap[abbr]);
  const schedule=[...new Map([...scheduleGames(s2),...scheduleGames(s1)].map(g=>[g.id,g])).values()];
  return {
    ok:Object.keys(teams).length>=20,
    ids,
    teams,
    priorGoalies:goalieRows(priorGoalies.data||[]),
    currentGoalies:goalieRows(currentGoalies.data||[]),
    schedule,
    artifact:NHL_FBIS_V1_ARTIFACT,
    marketInformed:false,
    canQualify:false,
    canAuthorize:false
  };
}

export function projectNhlV1Game(game,ctx){
  const home=String(game?.home?.abbr||"").toUpperCase();
  const away=String(game?.away?.abbr||"").toUpperCase();
  const hs=ctx?.teams?.[home],as=ctx?.teams?.[away];
  if(!ctx?.ok||!hs||!as) return {ok:false,reason:"nhl-v1-team-context-missing",home,away};

  const artifact=ctx.artifact||NHL_FBIS_V1_ARTIFACT;
  const league=artifact.league||{};
  const hx=artifact.teams?.[home]||null,ax=artifact.teams?.[away]||null;
  const leagueGoals=finite(league.goalsPerTeamGame)||3.05;
  const league5=finite(league.fiveVFiveXgPerTeamGame)||2.35;
  const non5=Math.max(0.35,leagueGoals-league5);

  const baselineHome=((finite(hs.gfpg)??leagueGoals)+(finite(as.gapg)??leagueGoals))/2;
  const baselineAway=((finite(as.gfpg)??leagueGoals)+(finite(hs.gapg)??leagueGoals))/2;
  const xg5Home=hx&&ax?((finite(hx.xGF5v5PerGame)??league5)+(finite(ax.xGA5v5PerGame)??league5))/2:null;
  const xg5Away=hx&&ax?((finite(ax.xGF5v5PerGame)??league5)+(finite(hx.xGA5v5PerGame)??league5))/2:null;
  const xgFullHome=xg5Home==null?baselineHome:xg5Home+non5;
  const xgFullAway=xg5Away==null?baselineAway:xg5Away+non5;
  let homeGoals=0.55*baselineHome+0.45*xgFullHome;
  let awayGoals=0.55*baselineAway+0.45*xgFullAway;

  const leaguePp=finite(league.ppPct)||0.21;
  const ppo=finite(league.ppOpportunitiesPerTeamGame)||3.0;
  const hp=finite(hs.pp)??leaguePp,ap=finite(as.pp)??leaguePp;
  const hpk=finite(hs.pk)??(1-leaguePp),apk=finite(as.pk)??(1-leaguePp);
  const hPpGoals=ppo*((hp+(1-apk))/2);
  const aPpGoals=ppo*((ap+(1-hpk))/2);
  const leaguePpGoals=ppo*leaguePp;
  const stHome=clamp(hPpGoals-leaguePpGoals,-0.28,0.28);
  const stAway=clamp(aPpGoals-leaguePpGoals,-0.28,0.28);
  homeGoals+=stHome;
  awayGoals+=stAway;

  const homeGoalie=selectGoalie(home,ctx.currentGoalies,ctx.priorGoalies,artifact);
  const awayGoalie=selectGoalie(away,ctx.currentGoalies,ctx.priorGoalies,artifact);
  const homeGoalieAdj=-awayGoalie.impactGoals*awayGoalie.reliability;
  const awayGoalieAdj=-homeGoalie.impactGoals*homeGoalie.reliability;
  homeGoals+=homeGoalieAdj;
  awayGoals+=awayGoalieAdj;

  const hc=previousGameContext(home,game.start,ctx.schedule,home);
  const ac=previousGameContext(away,game.start,ctx.schedule,home);
  const sitHome=situationalAdjustment(hc,ac,true);
  const sitAway=situationalAdjustment(ac,hc,false);
  homeGoals+=sitHome;
  awayGoals+=sitAway;

  homeGoals=clamp(homeGoals,1.3,5.5);
  awayGoals=clamp(awayGoals,1.3,5.5);
  const dist=distribution(homeGoals,awayGoals,finite(game?.odds?.total),finite(game?.odds?.spread));

  return {
    ok:true,
    modelId:NHL_FBIS_V1_ID,
    modelVersion:NHL_FBIS_V1_VERSION,
    maturity:"RESEARCH",
    independent:true,
    marketInformed:false,
    canQualify:false,
    canAuthorize:false,
    home:round(homeGoals,2),
    away:round(awayGoals,2),
    margin:round(homeGoals-awayGoals,2),
    total:round(homeGoals+awayGoals,2),
    probability:dist,
    layers:{
      fiveVFiveXg:{
        home:round(xg5Home??baselineHome,3),
        away:round(xg5Away??baselineAway,3),
        artifactTrained:Boolean(artifact.trained),
        artifactVersion:artifact.artifactVersion||null
      },
      specialTeams:{
        homeAdjustment:round(stHome,3),
        awayAdjustment:round(stAway,3),
        homePp:round(hp,4),awayPp:round(ap,4),
        homePk:round(hpk,4),awayPk:round(apk,4)
      },
      goalie:{
        home:homeGoalie,
        away:awayGoalie,
        homeScoreAdjustment:round(homeGoalieAdj,3),
        awayScoreAdjustment:round(awayGoalieAdj,3)
      },
      situational:{
        home:{...hc,adjustment:round(sitHome,3)},
        away:{...ac,adjustment:round(sitAway,3)}
      },
      baseline:{
        home:round(baselineHome,3),
        away:round(baselineAway,3),
        homeCurrentWeight:round(hs.currentWeight||0,3),
        awayCurrentWeight:round(as.currentWeight||0,3)
      }
    },
    validation:artifact.xg?{
      validationSeason:artifact.xg.validationSeason||null,
      shots:artifact.xg.validationShots||0,
      brier:artifact.xg.validationBrier??null,
      logLoss:artifact.xg.validationLogLoss??null
    }:null,
    note:"NHL-FBIS-v1 five-layer research model: historical 5v5 xG, regressed goalie value, special teams, situational context and independent Poisson score distribution. No market inputs."
  };
}

export function attachNhlV1(games=[],ctx=null){
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const proj=projectNhlV1Game(game,ctx);
    if(proj.ok) projected++; else missing++;
    return {
      ...game,
      nhlV1:proj,
      challengers:{...(game.challengers||{}),[NHL_FBIS_V1_ID]:proj}
    };
  });
  return {
    games:next,
    meta:{
      modelId:NHL_FBIS_V1_ID,
      modelVersion:NHL_FBIS_V1_VERSION,
      projected,missing,
      artifactVersion:ctx?.artifact?.artifactVersion||null,
      artifactTrained:Boolean(ctx?.artifact?.trained),
      canQualify:false,
      canAuthorize:false,
      independent:true,
      marketInformed:false,
      maturity:"RESEARCH"
    }
  };
}
