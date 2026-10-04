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

export const NHL_PRO_V2_ID = "NHL-PRO-v2";
export const NHL_PRO_V2_VERSION = "research-v2.0-event-chain-gbdt";

const WEB="https://api-web.nhle.com/v1";
const STATS="https://api.nhle.com/stats/rest/en";

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function round(v,n=3){const p=10**n;return Math.round(Number(v)*p)/p;}
function sigmoid(z){return z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));}
async function fetchJson(url,fetcher=fetch){
  const res=await fetcher(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-PRO-v2/1.0"}});
  if(!res.ok)throw new Error(`NHL_PRO_V2_HTTP_${res.status}`);
  return res.json();
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
  const entries=await Promise.all(teams.map(async abbr=>{
    const id=ids[abbr];if(!id)return [abbr,{available:false,error:"team-id-missing"}];
    try{
      const zone=await fetchJson(`${WEB}/edge/team-zone-time-details/${id}/now`,fetcher);
      return [abbr,{...edgeZone(zone),teamId:id,source:"NHL_EDGE"}];
    }catch(err){return [abbr,{available:false,teamId:id,error:String(err?.message||err),source:"NHL_EDGE"}];}
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
function goalieImpact(team,base,artifact){
  const candidates=(base?.currentGoalies||[]).filter(g=>g.teams?.includes(team)).sort((a,b)=>(b.starts||0)-(a.starts||0));
  const g=candidates[0]||(base?.priorGoalies||[]).filter(g=>g.teams?.includes(team)).sort((a,b)=>(b.starts||0)-(a.starts||0))[0]||null;
  if(!g)return {goalieId:null,impactPerShot:0,reliability:0};
  const learned=artifact?.goalies?.[String(g.id)]||null;
  const starts=finite(g.starts)||0;
  return {goalieId:String(g.id),name:g.name||null,impactPerShot:finite(learned?.impactPerShot)||0,reliability:clamp(starts/(starts+5),0.45,0.9),source:learned?"NHL_PRO_V2_GSAX":"NO_V2_PRIOR"};
}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function bivariateDistribution(home,away,totalLine=null,homeSpread=null){
  const shared=Math.min(0.32,0.10*Math.min(home,away)),lh=Math.max(0.05,home-shared),la=Math.max(0.05,away-shared);
  let homeReg=0,awayReg=0,tie=0,over=0,under=0,push=0,homeCover=0,totalMass=0;
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),h=x+z,a=y+z;totalMass+=p;
    if(h>a)homeReg+=p;else if(a>h)awayReg+=p;else tie+=p;
    if(totalLine!=null){const t=h+a;if(t>totalLine)over+=p;else if(t<totalLine)under+=p;else push+=p;}
    if(homeSpread!=null&&h+homeSpread>a)homeCover+=p;
  }
  const norm=v=>totalMass?v/totalMass:v,otHome=1/(1+Math.exp(-(home-away)/0.65));
  const hw=norm(homeReg)+norm(tie)*otHome;
  return {homeRegWin:round(norm(homeReg),4),awayRegWin:round(norm(awayReg),4),regulationTie:round(norm(tie),4),
    homeWinIncludingOt:round(hw,4),awayWinIncludingOt:round(1-hw,4),
    over:totalLine==null?null:round(norm(over),4),under:totalLine==null?null:round(norm(under),4),push:totalLine==null?null:round(norm(push),4),
    homeCover:homeSpread==null?null:round(norm(homeCover),4),sharedComponent:round(shared,3)};
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

export async function loadNhlProV2Context(date,games=[],{fetcher=fetch,sportsDataverseUpdatedAt=null}={}){
  const base=await loadNhlV1Context(date,games,{fetcher,sportsDataverseUpdatedAt});
  const edge=await loadEdgeForSlate(games,fetcher).catch(err=>({__error:String(err?.message||err)}));
  return {
    ok:Boolean(base?.ok),
    base,edge,
    artifact:NHL_PRO_V2_ARTIFACT,
    sourceLineage:buildNhlSourceLineage({asOf:new Date().toISOString(),artifactGeneratedAt:NHL_PRO_V2_ARTIFACT?.generatedAt||null,sportsDataverseUpdatedAt}),
    marketInformed:false,canQualify:false,canAuthorize:false
  };
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
  const leagueShots=finite(artifact?.league?.shots)||30;

  const baselineH=(hgf+aga)/2,baselineA=(agf+hga)/2;
  const xgH=(hxgf+axga)/2,xgA=(axgf+hxga)/2;
  const leagueSt=finite(artifact?.league?.specialTeamsXg)||0.70;
  let homeGoals=0.30*baselineH+0.50*xgH+0.20*(xgH+(hst-leagueSt));
  let awayGoals=0.30*baselineA+0.50*xgA+0.20*(xgA+(ast-leagueSt));
  homeGoals+=(hsht-leagueShots)*0.012;awayGoals+=(asht-leagueShots)*0.012;

  const hShoot=shooterFactor(home,base,artifact),aShoot=shooterFactor(away,base,artifact);
  homeGoals+=(hShoot.factor-1)*0.70;awayGoals+=(aShoot.factor-1)*0.70;
  const hg=goalieImpact(home,base,artifact),ag=goalieImpact(away,base,artifact);
  homeGoals-=ag.impactPerShot*30*ag.reliability;awayGoals-=hg.impactPerShot*30*hg.reliability;

  const he=edgeAdjustment(home,away,ctx.edge),ae=edgeAdjustment(away,home,ctx.edge);
  homeGoals+=he.goals;awayGoals+=ae.goals;
  homeGoals+=0.12;

  homeGoals=clamp(homeGoals,1.45,5.25);awayGoals=clamp(awayGoals,1.45,5.25);
  const probability=bivariateDistribution(homeGoals,awayGoals,finite(game?.odds?.total),finite(game?.odds?.spread));
  const rawScoreWin=probability.homeWinIncludingOt;
  const priorHomeElo=finite(hprior.elo)??1500,priorAwayElo=finite(aprior.elo)??1500;
  const hGames=finite(hs.games)||0,aGames=finite(as.games)||0;
  const homeFormElo=priorHomeElo+clamp(((finite(hs.gfpg)||leagueGoals)-(finite(hs.gapg)||leagueGoals))*Math.min(hGames,20)*4,-120,120);
  const awayFormElo=priorAwayElo+clamp(((finite(as.gfpg)||leagueGoals)-(finite(as.gapg)||leagueGoals))*Math.min(aGames,20)*4,-120,120);
  const eloProb=1/(1+10**(-((homeFormElo-awayFormElo)+35)/400));
  const calibratedHomeWin=clamp(0.5+0.86*((0.78*rawScoreWin+0.22*eloProb)-0.5),0.04,0.96);
  probability.rawHomeWinIncludingOt=rawScoreWin;
  probability.eloHead=round(eloProb,4);
  probability.homeWinIncludingOt=round(calibratedHomeWin,4);
  probability.awayWinIncludingOt=round(1-calibratedHomeWin,4);
  return {
    ok:true,modelId:NHL_PRO_V2_ID,modelVersion:NHL_PRO_V2_VERSION,home,away,
    projHome:round(homeGoals,2),projAway:round(awayGoals,2),margin:round(homeGoals-awayGoals,2),total:round(homeGoals+awayGoals,2),
    probability,
    layers:{
      eventChainXg:{home:round(xgH,3),away:round(xgA,3),trained:Boolean(artifact?.trained),trees:artifact?.xgModel?.trees?.length||0},
      finishing:{home:hShoot,away:aShoot},
      goalie:{home:hg,away:ag},
      specialTeams:{home:round(hst-leagueSt,3),away:round(ast-leagueSt,3)},
      tracking:{home:he,away:ae,source:"NHL_EDGE_ZONE_TIME_OPTIONAL"},
      distribution:{family:"BIVARIATE_POISSON",shared:probability.sharedComponent,winHead:"78% score + 22% latent strength; 14% reliability shrink"}
    },
    dataLineage:ctx?.sourceLineage||null,marketInformed:false,independent:true,
    canQualify:false,canAuthorizeWager:false,
    promotion:artifact?.promotion||null,
    note:"NHL-PRO-v2 independent research challenger: event-chain boosted xG, shooter finishing, goalie GSAx, special teams, optional NHL EDGE zone-time, and bivariate scoring."
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
    canQualify:false,canAuthorize:false,marketInformed:false}};
}
