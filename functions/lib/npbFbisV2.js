import { loadNpbContext } from "./npbFbisV1.js";
import {
  clamp, round2, deriveReliefEra, expectedRuns, gameDistribution,
  pitcherKProjection, leagueAverages,
} from "./asianBaseballV2.js";

export const NPB_FBIS_V2_ID = "NPB-FBIS-v2";
export const NPB_FBIS_V2_VERSION = "research-v2.0.0-independent-run-distribution";

const HOME_EDGE = 0.10;

function starterFor(game,ctx,side){
  const abbr=game?.[side]?.abbr;
  const id=game?.probableStarterIds?.[side];
  if(!abbr||!id) return null;
  return (ctx.pitchersByTeam?.[abbr]||[]).find(p=>String(p.playerId||"")===String(id))||null;
}

function enrichedTeams(ctx={}){
  const out={};
  for(const [abbr,t] of Object.entries(ctx.teams||{})){
    const pitchers=ctx.pitchersByTeam?.[abbr]||[];
    out[abbr]={...t,bullpenEra:deriveReliefEra(pitchers,t.staffEra||3.6)};
  }
  return out;
}

function parkFactor(game,ctx){
  const v=String(game?.venue||"");
  return Number(ctx?.parkFactors?.[v])||1;
}

function lineupFactor(game,ctx,side){
  return clamp(Number(ctx?.lineupFactors?.[game?.[side]?.abbr]||1),.82,1.18);
}

function recentFactor(game,ctx,side){
  return clamp(Number(ctx?.recentFactors?.[game?.[side]?.abbr]||1),.88,1.12);
}

export function projectNpbV2Game(game,ctx={}){
  const teams=enrichedTeams(ctx);
  const home=teams[game?.home?.abbr], away=teams[game?.away?.abbr];
  if(!home||!away) return {ok:false,reason:"npb-v2-team-context-missing"};
  const lg=leagueAverages(teams);
  const hs=starterFor(game,ctx,"home"), as=starterFor(game,ctx,"away");
  const park=parkFactor(game,ctx);

  const h=expectedRuns({
    offense:home,defense:away,starter:as,bullpenEra:away.bullpenEra,league:lg,
    parkFactor:park,lineupFactor:lineupFactor(game,ctx,"home"),recentFactor:recentFactor(game,ctx,"home"),homeEdge:HOME_EDGE,
  });
  const a=expectedRuns({
    offense:away,defense:home,starter:hs,bullpenEra:home.bullpenEra,league:lg,
    parkFactor:park,lineupFactor:lineupFactor(game,ctx,"away"),recentFactor:recentFactor(game,ctx,"away"),homeEdge:0,
  });

  const hSpIp=h.components.starterExpectedInnings||5;
  const aSpIp=a.components.starterExpectedInnings||5;
  const f5Home=clamp((h.runs*(5/9))*clamp(5/Math.max(3.5,aSpIp),.88,1.10),.4,6);
  const f5Away=clamp((a.runs*(5/9))*clamp(5/Math.max(3.5,hSpIp),.88,1.10),.4,6);
  const fullDist=gameDistribution(h.runs,a.runs,{dispersion:11});
  const f5Dist=gameDistribution(f5Home,f5Away,{dispersion:14,maxRuns:12});

  return {
    ok:true,modelId:NPB_FBIS_V2_ID,modelVersion:NPB_FBIS_V2_VERSION,maturity:"RESEARCH",
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false,
    home:round2(h.runs),away:round2(a.runs),margin:round2(h.runs-a.runs),total:round2(h.runs+a.runs),
    probabilities:fullDist,
    f5:{home:round2(f5Home),away:round2(f5Away),margin:round2(f5Home-f5Away),total:round2(f5Home+f5Away),probabilities:f5Dist,source:"NPB_FBIS_V2_STARTER_SEPARATED"},
    pitcherKs:{home:pitcherKProjection(hs,away,lg),away:pitcherKProjection(as,home,lg)},
    starters:{home:hs,away:as},
    components:{home:h.components,away:a.components},
    dataState:{
      startersResolved:Boolean(hs&&as),
      parkFactorSource:ctx?.parkFactors?.[game?.venue]?"HISTORICAL_SHRUNK":"NEUTRAL_PENDING_HISTORY",
      lineupSource:ctx?.lineupFactors?"LINEUP_CONTEXT":"NEUTRAL_PENDING_LINEUP",
      recentFormSource:ctx?.recentFactors?"TEMPORAL_FORM":"NEUTRAL_PENDING_FORM",
    },
    note:"Independent NPB v2: offense, starter, bullpen proxy, park/lineup/form hooks, separate F5 and probabilistic run distribution. Sportsbook inputs excluded.",
  };
}

export function attachNpbFbisV2(games=[],ctx={}){
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const p=projectNpbV2Game(game,ctx);
    if(!p.ok){missing++;return {...game,npbV2:p};}
    projected++;
    return {
      ...game,
      npbV2:p,
      projectionKind:"FBIS",
      projectionMaturity:"RESEARCH",
      canQualify:false,qualificationBlocked:true,bettingAuthority:"NOT_ELIGIBLE",
      projHomeScore:p.home,projAwayScore:p.away,
      researchProjection:{...p,projectionKind:"FBIS",generatedAt:new Date().toISOString()},
      model:{
        ...(game.model||{}),projectionKind:"FBIS",maturity:"RESEARCH",
        projHome:p.home,projAway:p.away,projMargin:p.margin,projTotal:p.total,
        pHomeFinal:p.probabilities.pHomeWin,canQualify:false,canAuthorize:false,
      },
      modelVersion:`${NPB_FBIS_V2_ID}@${NPB_FBIS_V2_VERSION}`,
      challengers:{...(game.challengers||{}),[NPB_FBIS_V2_ID]:p},
      quality:{
        ...(game.quality||{}),
        score:p.dataState.startersResolved?88:72,
        state:p.dataState.startersResolved?"COMPLETE":"PROVISIONAL",
        flags:[...new Set([...(game.quality?.flags||[]),...(p.dataState.startersResolved?[]:["npb_probable_starter_unresolved"]), "npb_v2_research_no_wager_authority"])],
      },
    };
  });
  return {games:next,meta:{modelId:NPB_FBIS_V2_ID,modelVersion:NPB_FBIS_V2_VERSION,projected,missing,maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorize:false}};
}

export async function loadNpbV2Context(date,opts={}){
  const base=await loadNpbContext(date,opts);
  return {...base,featureVersion:"npb-v2-live",parkFactors:base.parkFactors||{},lineupFactors:base.lineupFactors||null,recentFactors:base.recentFactors||null};
}
