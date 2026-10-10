/**
 * NHL-PRO-v2 — event-chain / personnel / goalie / tracking challenger.
 *
 * The live projection is independent of market pricing. NHL EDGE is an
 * optional public tracking overlay. Failure of EDGE never blocks the core
 * projection and never grants qualification/wager authority.
 */
import { NHL_PRO_V2_ARTIFACT } from "../../data/models/nhl-pro-v2.js";
import { loadNhlV1Context } from "./nhlFbisV1.js";
import { buildNhlSourceLineage } from "./nhlDataSources.js";
import { projectNhlWinnerV1 } from "./nhlWinV1.js";
import { loadNhlPlayerEdgeSnapshot, aggregateNhlTrackingMatchup } from "./nhlPlayerTrackingV3.js";
import { loadNhlOpportunitySnapshot, opportunityForGame } from "./nhlOpportunityV4.js";
import { loadNhlPersistentProfiles, persistentTeamFor } from "./nhlPersistentProfiles.js";

export const NHL_PRO_V2_ID = "NHL-PRO-v2";
export const NHL_PRO_V2_VERSION = "research-v2.0-event-chain-gbdt";

const WEB="https://api-web.nhle.com/v1";
const STATS="https://api.nhle.com/stats/rest/en";
const EDGE_CACHE=new Map();
const CONTEXT_CACHE=new Map();
const CONTEXT_INFLIGHT=new Map();
const EDGE_CACHE_MS=15*60*1000;
const CONTEXT_CACHE_MS=5*60*1000;
const LIVE_FETCH_TIMEOUT_MS=4500;
const EDGE_FETCH_TIMEOUT_MS=1800;
const EDGE_TOTAL_BUDGET_MS=4000;
const PLAYER_EDGE_TOTAL_BUDGET_MS=1800;
const OPPORTUNITY_TOTAL_BUDGET_MS=3200;

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=3){const p=10**n;return Math.round(Number(v)*p)/p;}
function sigmoid(z){return z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));}
function timeoutFetcher(fetcher=fetch,timeoutMs=LIVE_FETCH_TIMEOUT_MS){
  return async (url,options={})=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort("nhl-pro-v2-timeout"),timeoutMs);
    const upstream=options?.signal;
    const onAbort=()=>controller.abort(upstream?.reason||"upstream-abort");
    if(upstream?.addEventListener) upstream.addEventListener("abort",onAbort,{once:true});
    try{
      return await fetcher(url,{...options,signal:controller.signal});
    } finally {
      clearTimeout(timer);
      if(upstream?.removeEventListener) upstream.removeEventListener("abort",onAbort);
    }
  };
}
async function fetchJson(url,fetcher=fetch){
  const res=await fetcher(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-PRO-v2/1.0"}});
  if(!res.ok)throw new Error(`NHL_PRO_V2_HTTP_${res.status}`);
  return res.json();
}
function withBudget(promise,ms,fallback){
  return Promise.race([
    promise,
    new Promise(resolve=>setTimeout(()=>resolve(fallback),ms)),
  ]);
}
function flattenEdge(raw){
  if(!raw)return [];
  if(Array.isArray(raw))return raw;
  const out=[];
  for(const v of Object.values(raw||{})){
    if(Array.isArray(v))out.push(...v.filter(x=>x&&typeof x==="object"));
    else if(v&&typeof v==="object"&&!Array.isArray(v))out.push(v);
  }
  if(!out.length&&raw&&typeof raw==="object")out.push(raw);
  return out;
}
function edgeZone(raw){
  const rows=flattenEdge(raw);
  const preferred=rows.find(r=>/5v5|even/i.test(String(r.strengthCode??r.strength_code??"")))||rows[0]||{};
  const off=finite(preferred.offensiveZonePctg??preferred.offensive_zone_pctg);
  const def=finite(preferred.defensiveZonePctg??preferred.defensive_zone_pctg);
  const avg=finite(preferred.offensiveZoneLeagueAvg??preferred.offensive_zone_league_avg);
  return {offensiveZonePct:off,defensiveZonePct:def,leagueAvg:avg,available:off!=null||def!=null};
}

function numericEdgeFields(raw,patterns=[]){
  const out={};
  const seen=new Set();
  function walk(v,path="",depth=0){
    if(v==null||depth>5)return;
    if(Array.isArray(v)){for(let i=0;i<Math.min(v.length,12);i++)walk(v[i],path,depth+1);return;}
    if(typeof v!=="object")return;
    for(const [k,val] of Object.entries(v)){
      const key=String(k),full=path?path+"."+key:key;
      if(val&&typeof val==="object"){walk(val,full,depth+1);continue;}
      const n=finite(val);
      if(n==null)continue;
      const hit=patterns.find(p=>p.re.test(key)||p.re.test(full));
      if(hit&&!seen.has(hit.name)){out[hit.name]=n;seen.add(hit.name);}
    }
  }
  walk(raw);
  return out;
}
function edgeExpandedSummary(kind,raw){
  const patterns={
    skatingSpeed:[
      {name:"maxSpeed",re:/max.*speed|speed.*max/i},
      {name:"bursts22Plus",re:/22.*burst|burst.*22/i},
      {name:"bursts20Plus",re:/20.*burst|burst.*20/i},
    ],
    skatingDistance:[
      {name:"totalDistance",re:/distance.*total|total.*distance/i},
      {name:"distancePer60",re:/distance.*per.?60|per.?60.*distance/i},
      {name:"maxGameDistance",re:/distance.*max.*game|max.*game.*distance/i},
    ],
    shotSpeed:[
      {name:"maxShotSpeed",re:/max.*shot.*speed|shot.*speed.*max/i},
      {name:"avgShotSpeed",re:/avg.*shot.*speed|average.*shot.*speed/i},
      {name:"shots90Plus",re:/90.*shot|shot.*90/i},
    ],
    shotLocation:[
      {name:"highDangerShots",re:/high.*danger.*shot|shot.*high.*danger/i},
      {name:"slotShots",re:/slot.*shot|shot.*slot/i},
      {name:"innerSlotShots",re:/inner.*slot.*shot|shot.*inner.*slot/i},
    ],
    detail:[
      {name:"gamesPlayed",re:/games.*played|game.*count/i},
      {name:"rank",re:/overall.*rank|league.*rank|rank$/i},
    ],
  };
  return {available:Boolean(raw),metrics:numericEdgeFields(raw,patterns[kind]||[])};
}
async function optionalEdge(url,fetcher){
  try{return {ok:true,data:await fetchJson(url,fetcher)};}
  catch(err){return {ok:false,error:String(err?.message||err)};}
}
async function teamCatalog(fetcher){
  const j=await fetchJson(`${STATS}/team?limit=-1`,fetcher);
  const out={};
  for(const r of j?.data||[]){
    const abbr=String(r.rawTricode||r.triCode||"").toUpperCase();
    if(abbr&&r.id!=null)out[abbr]=Number(r.id);
  }
  return out;
}
async function loadEdgeForSlate(games,fetcher){
  const ids=await teamCatalog(fetcher).catch(()=>({}));
  const teams=[...new Set((games||[]).flatMap(g=>[String(g?.home?.abbr||"").toUpperCase(),String(g?.away?.abbr||"").toUpperCase()]).filter(Boolean))];
  const now=Date.now();
  const entries=await Promise.all(teams.map(async abbr=>{
    const cached=EDGE_CACHE.get(abbr);
    if(cached&&now-cached.at<EDGE_CACHE_MS)return [abbr,cached.value];
    const id=ids[abbr];if(!id)return [abbr,{available:false,error:"team-id-missing"}];
    let value;
    try{
      const [zoneR,detailR,speedR,distanceR,shotSpeedR,shotLocationR]=await Promise.all([
        optionalEdge(`${WEB}/edge/team-zone-time-details/${id}/now`,fetcher),
        optionalEdge(`${WEB}/edge/team-detail/${id}/now`,fetcher),
        optionalEdge(`${WEB}/edge/team-skating-speed-detail/${id}/now`,fetcher),
        optionalEdge(`${WEB}/edge/team-skating-distance-detail/${id}/now`,fetcher),
        optionalEdge(`${WEB}/edge/team-shot-speed-detail/${id}/now`,fetcher),
        optionalEdge(`${WEB}/edge/team-shot-location-detail/${id}/now`,fetcher),
      ]);
      const zone=edgeZone(zoneR.ok?zoneR.data:null);
      const expanded={
        detail:edgeExpandedSummary("detail",detailR.ok?detailR.data:null),
        skatingSpeed:edgeExpandedSummary("skatingSpeed",speedR.ok?speedR.data:null),
        skatingDistance:edgeExpandedSummary("skatingDistance",distanceR.ok?distanceR.data:null),
        shotSpeed:edgeExpandedSummary("shotSpeed",shotSpeedR.ok?shotSpeedR.data:null),
        shotLocation:edgeExpandedSummary("shotLocation",shotLocationR.ok?shotLocationR.data:null),
      };
      const availableFamilies=["detail","skatingSpeed","skatingDistance","shotSpeed","shotLocation"].filter(k=>expanded[k]?.available);
      value={...zone,available:Boolean(zone.available||availableFamilies.length),teamId:id,source:"NHL_EDGE",expanded:{...expanded,availableFamilies,coverage:availableFamilies.length/5,researchOnly:true}};
    }catch(err){value={available:false,teamId:id,error:String(err?.message||err),source:"NHL_EDGE",expanded:{availableFamilies:[],coverage:0,researchOnly:true}};}
    EDGE_CACHE.set(abbr,{at:now,value});
    return [abbr,value];
  }));
  return Object.fromEntries(entries);
}
function shooterFactor(team,base,artifact){
  const rows=base?.skatersByTeam?.[team]||[];
  if(!rows.length)return {factor:1,coverage:0,players:0};
  let sum=0,w=0,covered=0;
  for(const r of rows.slice(0,12)){
    const prior=artifact?.shooters?.[String(r.id)]||null;
    const weight=Math.max(0.2,(finite(r.shotsPerGame)||0)*0.7+(finite(r.pointsPerGame)||0)*1.2);
    sum+=(finite(prior?.factor)||1)*weight;w+=weight;if(prior)covered++;
  }
  return {factor:w?clamp(sum/w,0.88,1.14):1,coverage:rows.length?covered/Math.min(rows.length,12):0,players:Math.min(rows.length,12)};
}
function goalieImpact(team,base,artifact,profiles=null,cutoff=null,gameStart=null){
  const candidates=(base?.currentGoalies||[]).filter(g=>g.teams?.includes(team)).sort((a,b)=>(b.starts||0)-(a.starts||0));
  const prior=(base?.priorGoalies||[]).filter(g=>g.teams?.includes(team)).sort((a,b)=>(b.starts||0)-(a.starts||0));
  const key=({LAK:"la",NJD:"nj",SJS:"sj",TBL:"tb"})[team]||team.toLowerCase();
  const goalies=profiles?.goalies?.[key]||[];
  const cutoffMs=Date.parse(cutoff||""),startMs=Date.parse(gameStart||"");
  // An explicit pregame confirmation takes priority; updated-at timestamps
  // that are missing, post-cutoff or post-start cannot change goal projections.
  const confirmed=goalies.filter(row=>{
    const observed=Date.parse(row.source_updated_at||"");
    return String(row.goalie_state||"").toUpperCase()==="CONFIRMED_STARTER" &&
      row.player_id!=null && Number.isFinite(observed) &&
      Number.isFinite(cutoffMs) && observed<=cutoffMs &&
      Number.isFinite(startMs) && observed<startMs;
  }).sort((a,b)=>Date.parse(b.source_updated_at)-Date.parse(a.source_updated_at))[0]||null;
  const g=confirmed
    ? [...candidates,...prior].find(row=>String(row.id)===String(confirmed.player_id))||
      {id:confirmed.player_id,name:confirmed.player_name,starts:confirmed.starts}
    : candidates[0]||prior[0]||null;
  if(!g)return {goalieId:null,impactPerShot:0,reliability:0,selectionState:"UNKNOWN",evidenceAt:null};
  const learned=artifact?.goalies?.[String(g.id)]||null;
  const starts=finite(g.starts)||0;
  return {goalieId:String(g.id),name:g.name||null,impactPerShot:finite(learned?.impactPerShot)||0,
    reliability:clamp(starts/(starts+5),0.45,0.9),
    source:learned?"NHL_PRO_V2_GSAX":"NO_V2_PRIOR",
    selectionState:confirmed?"PIT_CONFIRMED_STARTER":"HISTORICAL_STARTS_PROXY",
    evidenceAt:confirmed?.source_updated_at||null,
    expectedStartProbability:confirmed?1:null};
}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function bivariateDistribution(home,away,totalLine=null,homeSpread=null){
  const shared=Math.min(0.32,0.10*Math.min(home,away)),lh=Math.max(0.05,home-shared),la=Math.max(0.05,away-shared);
  let homeReg=0,awayReg=0,tie=0,over=0,under=0,push=0,homeCover=0,totalMass=0;
  const scoreMass=new Map();
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),h=x+z,a=y+z;totalMass+=p;
    scoreMass.set(`${h}-${a}`,(scoreMass.get(`${h}-${a}`)||0)+p);
    if(h>a)homeReg+=p;else if(a>h)awayReg+=p;else tie+=p;
    if(totalLine!=null){const t=h+a;if(t>totalLine)over+=p;else if(t<totalLine)under+=p;else push+=p;}
    if(homeSpread!=null&&h+homeSpread>a)homeCover+=p;
  }
  const norm=v=>totalMass?v/totalMass:v,otHome=1/(1+Math.exp(-(home-away)/0.65));
  const hw=norm(homeReg)+norm(tie)*otHome;
  const mode=[...scoreMass.entries()].sort((a,b)=>b[1]-a[1])[0]||["0-0",0];
  const [modeHome,modeAway]=mode[0].split("-").map(Number);
  return {homeRegWin:round(norm(homeReg),4),awayRegWin:round(norm(awayReg),4),regulationTie:round(norm(tie),4),
    homeWinIncludingOt:round(hw,4),awayWinIncludingOt:round(1-hw,4),
    over:totalLine==null?null:round(norm(over),4),under:totalLine==null?null:round(norm(under),4),push:totalLine==null?null:round(norm(push),4),
    homeCover:homeSpread==null?null:round(norm(homeCover),4),sharedComponent:round(shared,3),
    mostLikelyScore:{home:modeHome,away:modeAway,probability:round(norm(mode[1]),4)}};
}
function baseTeamRate(team,artifact,key,fallback){
  const v=finite(artifact?.teams?.[team]?.[key]);return v==null?fallback:v;
}
function edgeAdjustment(team,opp,edge){
  const t=edge?.[team],o=edge?.[opp];
  if(!t?.available&&!o?.available)return {goals:0,available:false};
  const league=finite(t?.leagueAvg)??finite(o?.leagueAvg)??0.333;
  const off=finite(t?.offensiveZonePct),oppDef=finite(o?.defensiveZonePct);
  let delta=0;
  if(off!=null)delta+=(off-league)*0.9;
  if(oppDef!=null)delta+=(oppDef-(1-2*league))*0.35;
  return {goals:clamp(delta,-0.10,0.10),available:true};
}
function restDays(team,start,schedule=[]){
  const target=Date.parse(start||"");
  if(!Number.isFinite(target))return null;
  const prior=(schedule||[])
    .filter(g=>g.home===team||g.away===team)
    .filter(g=>Number.isFinite(Date.parse(g.start))&&Date.parse(g.start)<target)
    .sort((a,b)=>Date.parse(b.start)-Date.parse(a.start))[0];
  if(!prior)return 4;
  return Math.max(0,(target-Date.parse(prior.start))/86400000-1);
}
function fallbackBaseFromArtifact(){
  const teams={};
  for(const [abbr,row] of Object.entries(NHL_PRO_V2_ARTIFACT?.teams||{})){
    teams[abbr]={
      abbr,
      games:0,
      gfpg:finite(row?.gfpg)??finite(NHL_PRO_V2_ARTIFACT?.league?.goals)??3.05,
      gapg:finite(row?.gapg)??finite(NHL_PRO_V2_ARTIFACT?.league?.goals)??3.05,
      pp:null,pk:null,
      shotsFor:finite(row?.shotsFor),
      shotsAgainst:finite(row?.shotsAgainst),
      currentWeight:0,
    };
  }
  return {
    ok:Object.keys(teams).length>=20,
    degraded:true,
    fallbackReason:"LIVE_NHL_CONTEXT_UNAVAILABLE",
    teams,
    skatersByTeam:{},
    priorGoalies:[],
    currentGoalies:[],
    schedule:[],
    artifact:null,
    marketInformed:false,
    canQualify:false,
    canAuthorize:false,
  };
}
function contextKey(date,games=[]){
  const ids=(games||[]).map(g=>String(g?.id||`${g?.away?.abbr||""}@${g?.home?.abbr||""}`)).sort();
  return `${date}|${ids.join(",")}`;
}

export async function loadNhlProV2Context(date,games=[],{fetcher=fetch,sportsDataverseUpdatedAt=null,DB=null}={}){
  const key=contextKey(date,games),now=Date.now();
  const cached=CONTEXT_CACHE.get(key);
  if(cached&&now-cached.at<CONTEXT_CACHE_MS)return {...cached.value,cacheHit:true};
  if(CONTEXT_INFLIGHT.has(key))return CONTEXT_INFLIGHT.get(key);

  const task=(async()=>{
    const started=Date.now();
    const liveFetcher=timeoutFetcher(fetcher,LIVE_FETCH_TIMEOUT_MS);
    const edgeFetcher=timeoutFetcher(fetcher,EDGE_FETCH_TIMEOUT_MS);
    const profileTeams=[...new Set((games||[]).flatMap(g=>[g?.home?.abbr,g?.away?.abbr]).filter(Boolean))];
    const [baseResult,edge,persistentProfiles]=await Promise.all([
      loadNhlV1Context(date,games,{fetcher:liveFetcher,sportsDataverseUpdatedAt})
        .then(base=>({base,error:null}))
        .catch(err=>({base:fallbackBaseFromArtifact(),error:String(err?.message||err)})),
      withBudget(
        loadEdgeForSlate(games,edgeFetcher).catch(err=>({__error:String(err?.message||err)})),
        EDGE_TOTAL_BUDGET_MS,
        {__timeout:true,__error:"NHL_EDGE_BUDGET_EXCEEDED"}
      ),
      DB?.prepare
        ? withBudget(
            loadNhlPersistentProfiles(DB,profileTeams).catch(err=>({ok:false,__error:String(err?.message||err),teams:{},players:{},goalies:{},linemates:{},schedule:{}})),
            450,
            {ok:false,__timeout:true,teams:{},players:{},goalies:{},linemates:{},schedule:{}}
          )
        : Promise.resolve({ok:false,reason:"DB_UNAVAILABLE",teams:{},players:{},goalies:{},linemates:{},schedule:{}}),
    ]);
    const [playerEdge,opportunity]=await Promise.all([
      withBudget(
        loadNhlPlayerEdgeSnapshot(baseResult.base,games,{fetcher:edgeFetcher}).catch(err=>({__error:String(err?.message||err),byPlayer:{},coverage:0,available:0,requested:0,researchOnly:true})),
        PLAYER_EDGE_TOTAL_BUDGET_MS,
        {__timeout:true,__error:"NHL_PLAYER_EDGE_BUDGET_EXCEEDED",byPlayer:{},coverage:0,available:0,requested:0,researchOnly:true}
      ),
      withBudget(
        loadNhlOpportunitySnapshot(baseResult.base,games,{fetcher:edgeFetcher}).catch(err=>({__error:String(err?.message||err),byGame:{},coverage:0,available:0,requested:0,researchOnly:true})),
        OPPORTUNITY_TOTAL_BUDGET_MS,
        {__timeout:true,__error:"NHL_OPPORTUNITY_BUDGET_EXCEEDED",byGame:{},coverage:0,available:0,requested:0,researchOnly:true}
      )
    ]);
    const value={
      ok:Boolean(baseResult.base?.ok),
      base:baseResult.base,
      edge,
      playerEdge,
      opportunity,
      persistentProfiles,
      artifact:NHL_PRO_V2_ARTIFACT,
      degraded:Boolean(baseResult.base?.degraded||edge?.__timeout||edge?.__error),
      advisoryDegraded:Boolean(playerEdge?.__timeout||playerEdge?.__error||persistentProfiles?.__timeout||persistentProfiles?.__error),
      liveContextError:baseResult.error,
      timingMs:Date.now()-started,
      cacheHit:false,
      sourceLineage:buildNhlSourceLineage({asOf:new Date().toISOString(),artifactGeneratedAt:NHL_PRO_V2_ARTIFACT?.generatedAt||null,sportsDataverseUpdatedAt}),
      marketInformed:false,canQualify:false,canAuthorize:false
    };
    CONTEXT_CACHE.set(key,{at:Date.now(),value});
    return value;
  })();
  CONTEXT_INFLIGHT.set(key,task);
  try{return await task;}finally{CONTEXT_INFLIGHT.delete(key);}
}

export function projectNhlProV2Game(game,ctx){
  const home=String(game?.home?.abbr||"").toUpperCase(),away=String(game?.away?.abbr||"").toUpperCase();
  const base=ctx?.base,artifact=ctx?.artifact||NHL_PRO_V2_ARTIFACT;
  const hs=base?.teams?.[home],as=base?.teams?.[away];
  if(!ctx?.ok||!hs||!as)return {ok:false,reason:"nhl-pro-v2-context-missing",home,away};
  const leagueGoals=finite(artifact?.league?.goals)||finite(base?.artifact?.league?.goalsPerTeamGame)||3.05;
  const leagueXg=finite(artifact?.league?.xg)||finite(base?.artifact?.league?.fiveVFiveXgPerTeamGame)||2.35;
  const hprior=artifact?.teams?.[home]||{},aprior=artifact?.teams?.[away]||{};
  const currentWeight=clamp((finite(hs.games)||0)/24,0,0.84);
  const mix=(p,c,fallback)=>{const a=finite(p)??fallback,b=finite(c);return b==null?a:a*(1-currentWeight)+b*currentWeight;};
  const awayWeight=clamp((finite(as.games)||0)/24,0,0.84);
  const mixA=(p,c,fallback)=>{const a=finite(p)??fallback,b=finite(c);return b==null?a:a*(1-awayWeight)+b*awayWeight;};

  const hgf=mix(hprior.gfpg,hs.gfpg,leagueGoals),hga=mix(hprior.gapg,hs.gapg,leagueGoals);
  const agf=mixA(aprior.gfpg,as.gfpg,leagueGoals),aga=mixA(aprior.gapg,as.gapg,leagueGoals);
  const hxgf=baseTeamRate(home,artifact,"xgf",leagueXg),hxga=baseTeamRate(home,artifact,"xga",leagueXg);
  const axgf=baseTeamRate(away,artifact,"xgf",leagueXg),axga=baseTeamRate(away,artifact,"xga",leagueXg);
  const hst=baseTeamRate(home,artifact,"stxgf",finite(artifact?.league?.specialTeamsXg)||0.70);
  const ast=baseTeamRate(away,artifact,"stxgf",finite(artifact?.league?.specialTeamsXg)||0.70);
  const hsht=baseTeamRate(home,artifact,"shotsFor",finite(artifact?.league?.shots)||30);
  const asht=baseTeamRate(away,artifact,"shotsFor",finite(artifact?.league?.shots)||30);
  const hhd=baseTeamRate(home,artifact,"highDangerFor",finite(artifact?.league?.highDanger)||8);
  const ahd=baseTeamRate(away,artifact,"highDangerFor",finite(artifact?.league?.highDanger)||8);
  const hrush=baseTeamRate(home,artifact,"rushFor",finite(artifact?.league?.rush)||4);
  const arush=baseTeamRate(away,artifact,"rushFor",finite(artifact?.league?.rush)||4);
  const leagueShots=finite(artifact?.league?.shots)||30;
  const leagueHd=finite(artifact?.league?.highDanger)||8;
  const leagueRush=finite(artifact?.league?.rush)||4;

  const baselineH=(hgf+aga)/2,baselineA=(agf+hga)/2;
  const xgH=(hxgf+axga)/2,xgA=(axgf+hxga)/2;
  const leagueSt=finite(artifact?.league?.specialTeamsXg)||0.70;
  let homeGoals=0.30*baselineH+0.50*xgH+0.20*(xgH+(hst-leagueSt));
  let awayGoals=0.30*baselineA+0.50*xgA+0.20*(xgA+(ast-leagueSt));
  homeGoals+=(hsht-leagueShots)*0.018+(hhd-leagueHd)*0.014+(hrush-leagueRush)*0.018;
  awayGoals+=(asht-leagueShots)*0.018+(ahd-leagueHd)*0.014+(arush-leagueRush)*0.018;

  const hShoot=shooterFactor(home,base,artifact),aShoot=shooterFactor(away,base,artifact);
  homeGoals+=(hShoot.factor-1)*0.70;awayGoals+=(aShoot.factor-1)*0.70;
  const hg=goalieImpact(home,base,artifact,ctx?.persistentProfiles,ctx?.sourceLineage?.asOf,game?.start),
        ag=goalieImpact(away,base,artifact,ctx?.persistentProfiles,ctx?.sourceLineage?.asOf,game?.start);
  homeGoals-=ag.impactPerShot*30*ag.reliability;awayGoals-=hg.impactPerShot*30*hg.reliability;

  const he=edgeAdjustment(home,away,ctx.edge),ae=edgeAdjustment(away,home,ctx.edge);
  const playerTracking={home:aggregateNhlTrackingMatchup(home,away,base,ctx?.playerEdge),away:aggregateNhlTrackingMatchup(away,home,base,ctx?.playerEdge)};
  const opportunity=opportunityForGame(ctx,game?.id);
  const opportunityHome=finite(opportunity?.home?.goalAdjustment)||0,opportunityAway=finite(opportunity?.away?.goalAdjustment)||0;
  homeGoals+=he.goals+opportunityHome;awayGoals+=ae.goals+opportunityAway;
  const priorHomeElo=finite(hprior.elo)??1500,priorAwayElo=finite(aprior.elo)??1500;
  const hGames=finite(hs.games)||0,aGames=finite(as.games)||0;
  const homeFormElo=priorHomeElo+clamp(((finite(hs.gfpg)||leagueGoals)-(finite(hs.gapg)||leagueGoals))*Math.min(hGames,20)*4,-120,120);
  const awayFormElo=priorAwayElo+clamp(((finite(as.gfpg)||leagueGoals)-(finite(as.gapg)||leagueGoals))*Math.min(aGames,20)*4,-120,120);
  const eloGoalAdj=clamp((homeFormElo-awayFormElo)*0.0011,-0.28,0.28);
  homeGoals+=0.12+eloGoalAdj/2;awayGoals-=eloGoalAdj/2;
  const hRest=restDays(home,game?.start,base?.schedule),aRest=restDays(away,game?.start,base?.schedule);
  if(hRest!=null&&hRest<0.6)homeGoals-=0.10;
  if(aRest!=null&&aRest<0.6)awayGoals-=0.10;
  if(hRest!=null&&aRest!=null){const rd=clamp((hRest-aRest)*0.018,-0.07,0.07);homeGoals+=rd;awayGoals-=rd;}

  homeGoals=clamp(homeGoals,1.45,5.25);awayGoals=clamp(awayGoals,1.45,5.25);
  const probability=bivariateDistribution(homeGoals,awayGoals,finite(game?.odds?.total),finite(game?.odds?.spread));
  const rawScoreWin=probability.homeWinIncludingOt;
  const eloProb=1/(1+10**(-((homeFormElo-awayFormElo)+35)/400));
  const calibratedHomeWin=clamp(0.5+0.86*((0.78*rawScoreWin+0.22*eloProb)-0.5),0.04,0.96);
  probability.rawHomeWinIncludingOt=rawScoreWin;
  probability.eloHead=round(eloProb,4);
  probability.homeWinIncludingOt=round(calibratedHomeWin,4);
  probability.awayWinIncludingOt=round(1-calibratedHomeWin,4);
  const winnerHead=projectNhlWinnerV1({
    game,
    projection:{
      home,away,projHome:homeGoals,projAway:awayGoals,probability,
      layers:{situation:{homeRestDays:hRest,awayRestDays:aRest}}
    },
    base,
    signals:{
      eloDiff:homeFormElo-awayFormElo,
      xgHome:xgH,xgAway:xgA,
      goalieVsHome:-ag.impactPerShot*30,
      goalieVsAway:-hg.impactPerShot*30
    }
  });
  return {
    ok:true,modelId:NHL_PRO_V2_ID,modelVersion:NHL_PRO_V2_VERSION,home,away,
    eventId:game?.id==null?null:String(game.id),gameStart:game?.start||null,
    featureCutoffTimestamp:ctx?.sourceLineage?.asOf||null,
    projHome:round(homeGoals,2),projAway:round(awayGoals,2),margin:round(homeGoals-awayGoals,2),total:round(homeGoals+awayGoals,2),
    projectedScore:probability.mostLikelyScore,
    projectedWinner:winnerHead?.ok?winnerHead.pick:(calibratedHomeWin>=0.5?home:away),
    probability,
    winnerHead,
    layers:{
      eventChainXg:{home:round(xgH,3),away:round(xgA,3),trained:Boolean(artifact?.trained),trees:artifact?.xgModel?.trees?.length||0},
      finishing:{home:hShoot,away:aShoot},
      goalie:{home:hg,away:ag},
      specialTeams:{home:round(hst-leagueSt,3),away:round(ast-leagueSt,3)},
      tracking:{home:he,away:ae,source:"NHL_EDGE_EXPANDED_OPTIONAL",expanded:{home:ctx?.edge?.[home]?.expanded||null,away:ctx?.edge?.[away]?.expanded||null,activation:"RESEARCH_ADVISORY_ONLY"},player:playerTracking,playerEdgeCoverage:ctx?.playerEdge?.coverage??0,historicalProxy:{homeHighDanger:round(hhd,2),awayHighDanger:round(ahd,2),homeRush:round(hrush,2),awayRush:round(arush,2)}},
      opportunity:{source:opportunity?.source||null,available:Boolean(opportunity?.available),gameType:finite(opportunity?.gameType),scratchCount:opportunity?.scratchCount||0,home:opportunity?.home||null,away:opportunity?.away||null,homeGoalAdjustment:round(opportunityHome,3),awayGoalAdjustment:round(opportunityAway,3),researchOnly:true},
      persistentState:{
        modelId:"NHL-PERSISTENT-PROFILE-v1",
        home:persistentTeamFor(ctx,home),
        away:persistentTeamFor(ctx,away),
        available:Boolean(persistentTeamFor(ctx,home)||persistentTeamFor(ctx,away)),
        appliedToProjection:false,
        role:"PERSISTED_CONTEXT_AND_FAIL_SOFT_FALLBACK",
        marketInformed:false,
        researchOnly:true
      },
      situation:{homeRestDays:hRest,awayRestDays:aRest,eloGoalAdjustment:round(eloGoalAdj,3),winnerSituational:winnerHead?.situational||null},
      distribution:{family:"BIVARIATE_POISSON",shared:probability.sharedComponent,winHead:"NHL-PRO-v2 calibrated probability + NHL-WIN-v1 directional pick",mostLikelyScore:probability.mostLikelyScore}
    },
    dataLineage:ctx?.sourceLineage||null,marketInformed:false,independent:true,
    canQualify:true,canAuthorizeWager:false,
    promotion:artifact?.promotion||null,
    note:"NHL-PRO-v2 independent research challenger: event-chain boosted xG, shooter finishing, goalie GSAx, special teams, timeout-safe NHL EDGE zone-time plus expanded speed/distance/shot tracking advisory, and bivariate scoring."
  };
}
export function attachNhlProV2(games=[],ctx=null){
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    if(game.sport&&String(game.sport).toLowerCase()!=="nhl")return game;
    const p=projectNhlProV2Game(game,ctx);if(p.ok)projected++;else missing++;
    return {...game,nhlProV2:p,challengers:{...(game.challengers||{}),[NHL_PRO_V2_ID]:p}};
  });
  return {games:next,meta:{modelId:NHL_PRO_V2_ID,modelVersion:NHL_PRO_V2_VERSION,projected,missing,
    artifactVersion:ctx?.artifact?.artifactVersion||null,trained:Boolean(ctx?.artifact?.trained),
    historicalPromotionEligible:Boolean(ctx?.artifact?.promotion?.historicalPromotionEligible),
    persistentProfilesLoaded:Object.keys(ctx?.persistentProfiles?.teams||{}).length,
    persistentProfilesTimedOut:Boolean(ctx?.persistentProfiles?.__timeout),
    canQualify:true,canAuthorize:false,marketInformed:false}};
}
