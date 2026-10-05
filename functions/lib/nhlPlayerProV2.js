import { NHL_PLAYER_PRO_V2_ARTIFACT } from "../../data/models/nhl-player-pro-v2.js";
import { playerTrackingFor } from "./nhlPlayerTrackingV3.js";
import { opportunityForGame, opportunityForPlayer } from "./nhlOpportunityV4.js";

export const NHL_PLAYER_PRO_V2_ID="NHL-PLAYER-PRO-v2";
export const NHL_PLAYER_PRO_V2_VERSION="research-v2.0-share-environment";

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function teamAbbr(team={}){return String(team.abbr||team.shortName||team.name||"").toUpperCase();}
function sideGoals(game,side){
  const v=side==="home"
    ? finite(game?.nhlProV2?.projHome??game?.researchProjection?.home??game?.nhlV1?.home)
    : finite(game?.nhlProV2?.projAway??game?.researchProjection?.away??game?.nhlV1?.away);
  return v;
}
function sideRest(game,side){
  return finite(game?.nhlProV2?.layers?.situation?.[side==="home"?"homeRestDays":"awayRestDays"]);
}
function goalieRow(id,ctx){
  if(!id)return null;
  return [...(ctx?.currentGoalies||[]),...(ctx?.priorGoalies||[])].find(g=>String(g.id)===String(id))||null;
}
function marketValidationStatus(market){
  return String(NHL_PLAYER_PRO_V2_ARTIFACT?.validation?.markets?.[market]?.status||"PENDING_VALIDATION");
}
function validatedLines(market){
  const out={};
  for(const [key,row] of Object.entries(NHL_PLAYER_PRO_V2_ARTIFACT?.validation?.lines||{})){
    const [m,line]=String(key).split(":");
    if(m===market&&line!=null)out[line]=String(row?.status||"PENDING_VALIDATION");
  }
  return out;
}
function playerSigma(playerId,market,fallback){
  const v=finite(NHL_PLAYER_PRO_V2_ARTIFACT?.players?.[String(playerId)]?.sigma?.[market]);
  if(v!=null)return v;
  if(market==="shots_on_goal")return clamp(Math.sqrt(Math.max(0.6,fallback)),0.75,3.5);
  return clamp(Math.sqrt(Math.max(0.12,fallback*0.65)),0.35,1.6);
}

export function nhlPlayerProV2RowsForSide(game,side,ctx={}){
  const team=teamAbbr(game?.[side]),opp=teamAbbr(game?.[side==="home"?"away":"home"]);
  const skaters=ctx?.skatersByTeam?.[team]||[];
  if(!team||!opp||!skaters.length)return [];
  const teamCtx=ctx?.teams?.[team]||{},oppCtx=ctx?.teams?.[opp]||{};
  const teamGoals=sideGoals(game,side)??finite(teamCtx.gfpg)??3.05;
  const oppGoals=sideGoals(game,side==="home"?"away":"home")??finite(oppCtx.gfpg)??3.05;
  const teamShots=clamp(((finite(teamCtx.shotsFor)??30)+(finite(oppCtx.shotsAgainst)??30))/2,20,42);
  const rates=skaters.slice(0,14).map(p=>({
    p,
    shots:finite(p.shotsPerGame)??finite(NHL_PLAYER_PRO_V2_ARTIFACT?.players?.[String(p.id)]?.shotsPerGame)??0,
    goals:finite(p.goalsPerGame)??finite(NHL_PLAYER_PRO_V2_ARTIFACT?.players?.[String(p.id)]?.goalsPerGame)??0,
    assists:finite(p.assistsPerGame)??finite(NHL_PLAYER_PRO_V2_ARTIFACT?.players?.[String(p.id)]?.assistsPerGame)??0,
    points:finite(p.pointsPerGame)??finite(NHL_PLAYER_PRO_V2_ARTIFACT?.players?.[String(p.id)]?.pointsPerGame)??0,
  })).filter(x=>x.shots>0||x.points>0);
  const shotSum=rates.reduce((s,x)=>s+x.shots,0)||1,goalSum=rates.reduce((s,x)=>s+x.goals,0)||1,assistSum=rates.reduce((s,x)=>s+x.assists,0)||1;
  const rest=sideRest(game,side),restFactor=rest!=null&&rest<0.6?0.96:rest!=null&&rest>2.5?1.01:1;
  const rows=[];
  const opportunity=opportunityForGame(ctx,game?.id);
  const oppSide=opportunity?.[side]||null;
  for(const x of rates){
    const p=x.p,role=opportunityForPlayer(opportunity,side,p.id);
    const persistent=ctx?.persistent?.byPlayer?.[String(p.id)]||null;
    const persistentBlocked=["OUT","IR","CONFIRMED_SCRATCH"].includes(String(persistent?.status||"").toUpperCase());
    if(role?.scratched||(!opportunity?.available&&persistentBlocked))continue;
    const shareShots=teamShots*(x.shots/shotSum);
    const baseToi=Math.max(300,finite(p.toiPerGame)??finite(persistent?.expected_toi_seconds)??900);
    const basePp=Math.max(30,finite(p.powerPlayToiPerGame)??finite(persistent?.expected_pp_toi_seconds)??60);
    const persistentToi=finite(persistent?.expected_toi_seconds),persistentPp=finite(persistent?.expected_pp_toi_seconds);
    const persistentToiMult=persistentToi==null?1:clamp(persistentToi/baseToi,.78,1.25);
    const persistentPpMult=persistentPp==null?1:clamp(persistentPp/basePp,.70,1.35);
    const roleShot=finite(role?.shotMultiplier)??1,rolePoint=finite(role?.pointMultiplier)??1;
    const roleToi=finite(role?.toiMultiplier)??persistentToiMult,rolePp=finite(role?.ppMultiplier)??persistentPpMult;
    const deploymentFactor=clamp(.62*roleToi+.38*rolePp,.82,1.28);
    const sog=clamp((0.55*x.shots+0.45*shareShots)*restFactor*roleShot*deploymentFactor,0.15,7.5);
    const learned=NHL_PLAYER_PRO_V2_ARTIFACT?.players?.[String(p.id)]||{};
    const shootPct=clamp(finite(learned.shootingPct)??(x.goals/Math.max(0.35,x.shots)),0.025,0.28);
    const goals=clamp((0.55*(sog*shootPct)+0.45*(teamGoals*(x.goals/goalSum)))*restFactor*rolePoint,0.015,1.4);
    const assists=clamp((0.55*x.assists+0.45*(teamGoals*1.65*(x.assists/assistSum)))*restFactor*rolePoint*deploymentFactor,0.02,1.8);
    const points=clamp(goals+assists,0.04,2.5);
    for(const [market,projection] of [["shots_on_goal",sog],["goals",goals],["assists",assists],["points",points]]){
      rows.push({
        player:{id:p.id,name:p.name,position:p.position},team,market,projection,
        sigma:playerSigma(p.id,market,projection),
        source:"NHL_PLAYER_PRO_V2_SHARE_ENVIRONMENT",
        validationStatus:marketValidationStatus(market),
        validatedLines:validatedLines(market),
        shotEnvironment:market==="shots_on_goal"?{
          teamShotsFor:finite(teamCtx.shotsFor)??30,
          opponentShotsAgainst:finite(oppCtx.shotsAgainst)??30,
          projectedTeamShots:teamShots,
          playerShotRate:x.shots,
          playerShotShare:x.shots/shotSum,
        }:null,
        trackingAdvisory:playerTrackingFor(ctx,p.id),
        opportunityAdjustment:{...(role||{}),persistentState:persistent?{status:persistent.status,evRole:persistent.ev_role,ppUnit:persistent.pp_unit,roleConfidence:persistent.role_confidence,linemates:persistent.linemates||[]}:null,teamScratchCount:oppSide?.scratched?.length||0,source:opportunity?.source||(persistent?"NHL_PERSISTENT_D1":null)},
        matchupTrackingAdvisory:game?.nhlProV2?.layers?.tracking?.player?.[side]||null,
        notes:"Point-in-time player rate/share model tied to NHL-PRO-v2. Persistent D1 EV-line/PP/TOI state supplies baseline deployment; bounded live gamecenter scratches override it when available. Market prices remain outside the projection."
      });
    }
  }

  const goalie=game?.nhlProV2?.layers?.goalie?.[side]||game?.nhlV1?.layers?.goalie?.[side]||null;
  if(goalie?.goalieId){
    const g=goalieRow(goalie.goalieId,ctx),learned=NHL_PLAYER_PRO_V2_ARTIFACT?.goalies?.[String(goalie.goalieId)]||{};
    const savePct=clamp(finite(g?.savePct)??finite(learned.savePct)??0.905,0.84,0.95);
    const oppSf=finite(oppCtx.shotsFor)??30;
    const teamSa=finite(teamCtx.shotsAgainst)??30;
    const oppShots=clamp((oppSf+teamSa)/2,20,42);
    const baseline=oppShots*savePct;
    const projection=clamp(0.60*baseline+0.40*Math.max(8,oppShots-oppGoals),10,40);
    const sigma=clamp(finite(learned.sigmaSaves)??Math.sqrt(Math.max(4,projection)),2.5,9);
    rows.push({
      player:{id:goalie.goalieId,name:goalie.name||g?.name||null,position:"G"},team,market:"saves",projection,sigma,
      source:"NHL_PLAYER_PRO_V2_CONFIRMED_STARTER_SAVE_ENVIRONMENT",
      validationStatus:marketValidationStatus("saves"),
      validatedLines:validatedLines("saves"),
      shotEnvironment:{opponentShotsFor:oppSf,teamShotsAgainst:teamSa,projectedShotsFaced:oppShots},
      matchupTrackingAdvisory:game?.nhlProV2?.layers?.tracking?.player?.[side]||null,
      notes:"Starter-gated saves model using opponent shot generation + team shot suppression, goalie save rate, and NHL-PRO-v2 opponent goal expectation."
    });
  }
  return rows;
}
