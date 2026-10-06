import { loadKboContext } from "./kboFbisV1.js";
import {
  clamp, round2, deriveReliefEra, expectedRuns, gameDistribution,
  pitcherKProjection, leagueAverages,
} from "./asianBaseballV2.js";

export const KBO_FBIS_V2_ID = "KBO-FBIS-v2";
export const KBO_FBIS_V2_VERSION = "research-v2.0.0-independent-run-distribution";

const HOME_EDGE = 0.15;

function starterFor(game,ctx,side){
  const s=ctx?.startersByGame?.[game?.id]?.[side]||null;
  return s;
}

function mergedTeams(ctx={}){
  const out={};
  for(const [abbr,t] of Object.entries(ctx.teams||{})){
    const adv=ctx.advancedTeams?.[abbr]||{};
    const pitchers=(ctx.pitchers||[]).filter(p=>p.team===abbr);
    out[abbr]={...t,...adv,bullpenEra:deriveReliefEra(pitchers,adv.era||t.era||4.6)};
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

export function projectKboV2Game(game,ctx={}){
  const teams=mergedTeams(ctx);
  const home=teams[game?.home?.abbr], away=teams[game?.away?.abbr];
  if(!home||!away) return {ok:false,reason:"kbo-v2-team-context-missing"};
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
  const f5Home=clamp((h.runs*(5/9))*clamp(5/Math.max(3.5,aSpIp),.87,1.11),.5,6.5);
  const f5Away=clamp((a.runs*(5/9))*clamp(5/Math.max(3.5,hSpIp),.87,1.11),.5,6.5);
  const fullDist=gameDistribution(h.runs,a.runs,{dispersion:8});
  const f5Dist=gameDistribution(f5Home,f5Away,{dispersion:11,maxRuns:13});

  return {
    ok:true,modelId:KBO_FBIS_V2_ID,modelVersion:KBO_FBIS_V2_VERSION,maturity:"RESEARCH",
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false,
    home:round2(h.runs),away:round2(a.runs),margin:round2(h.runs-a.runs),total:round2(h.runs+a.runs),
    probabilities:fullDist,
    f5:{home:round2(f5Home),away:round2(f5Away),margin:round2(f5Home-f5Away),total:round2(f5Home+f5Away),probabilities:f5Dist,source:"KBO_FBIS_V2_STARTER_SEPARATED"},
    pitcherKs:{home:pitcherKProjection(hs,away,lg),away:pitcherKProjection(as,home,lg)},
    starters:{home:hs,away:as,source:ctx?.startersByGame?.[game?.id]?.source||null},
    components:{home:h.components,away:a.components},
    dataState:{
      startersResolved:Boolean(hs&&as),
      parkFactorSource:ctx?.parkFactors?.[game?.venue]?"HISTORICAL_SHRUNK":"NEUTRAL_PENDING_HISTORY",
      lineupSource:ctx?.lineupFactors?"LINEUP_CONTEXT":"NEUTRAL_PENDING_LINEUP",
      recentFormSource:ctx?.recentFactors?"TEMPORAL_FORM":"NEUTRAL_PENDING_FORM",
      advancedTeamStats:Boolean(ctx?.advancedTeams?.[game?.home?.abbr]&&ctx?.advancedTeams?.[game?.away?.abbr]),
    },
    note:"Independent KBO v2: advanced offense, starter, bullpen proxy, park/lineup/form hooks, separate F5 and probabilistic run distribution. Sportsbook inputs excluded.",
  };
}

export function attachKboFbisV2(games=[],ctx={}){
  let projected=0,missing=0;
  const next=(games||[]).map(game=>{
    const p=projectKboV2Game(game,ctx);
    if(!p.ok){missing++;return {...game,kboV2:p};}
    projected++;
    return {
      ...game,
      kboV2:p,
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
      modelVersion:`${KBO_FBIS_V2_ID}@${KBO_FBIS_V2_VERSION}`,
      challengers:{...(game.challengers||{}),[KBO_FBIS_V2_ID]:p},
      quality:{
        ...(game.quality||{}),
        score:p.dataState.startersResolved&&p.dataState.advancedTeamStats?91:p.dataState.advancedTeamStats?82:70,
        state:p.dataState.startersResolved&&p.dataState.advancedTeamStats?"COMPLETE":"PROVISIONAL",
        flags:[...new Set([...(game.quality?.flags||[]),...(p.dataState.startersResolved?[]:["kbo_starter_feed_unresolved"]),...(p.dataState.advancedTeamStats?[]:["kbo_advanced_team_stats_unresolved"]),"kbo_v2_research_no_wager_authority"])],
      },
    };
  });
  return {games:next,meta:{modelId:KBO_FBIS_V2_ID,modelVersion:KBO_FBIS_V2_VERSION,projected,missing,maturity:"RESEARCH",independent:true,marketInformed:false,canQualify:false,canAuthorize:false}};
}

export async function loadKboV2Context(date,opts={}){
  const base=await loadKboContext(date,opts);
  return {...base,featureVersion:"kbo-v2-live",parkFactors:base.parkFactors||{},lineupFactors:base.lineupFactors||null,recentFactors:base.recentFactors||null};
}
