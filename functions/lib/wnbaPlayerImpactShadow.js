import { pGreater } from "./metrics.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;

export const WNBA_PROP_IMPACT_CHALLENGER_ID="WNBA-PLAYER-PROP-IMPACT-v1";
export const WNBA_GAME_IMPACT_CHALLENGER_ID="WNBA-FBIS-IMPACT-v1";

function roleMultiplier(market,role={}){
  if(market==="points")return finite(role.pointsMultiplier)??1;
  if(market==="rebounds")return finite(role.reboundsMultiplier)??1;
  if(market==="assists")return finite(role.assistsMultiplier)??1;
  if(market==="three_pointers_made")return finite(role.threesMultiplier)??1;
  return 1;
}
export function applyWnbaPropImpactShadow(row,{impact=null,role=null,lineup=null,availabilityVerified=false}={}){
  const base=finite(row?.fbisProjection),sigma=finite(row?.fbisSigma);
  if(base==null)return {...row,impactShadow:null};
  const directImpact=impact?.offense==null?1:clamp(1+Number(impact.offense)/400,.97,1.035);
  const adjusted=base*roleMultiplier(row.market,role)*(finite(lineup?.multiplier)??1)*directImpact;
  const minutes=finite(row?.role?.minutes);
  const projectedMinutes=minutes==null?null:clamp(minutes+(finite(role?.minutesDelta)||0),0,40);
  return {
    ...row,
    impactShadow:{
      modelId:WNBA_PROP_IMPACT_CHALLENGER_ID,modelVersion:"research-v1-shadow",
      projection:round1(adjusted),sigma:round1((sigma??1)*(availabilityVerified?.98:1.04)),
      baselineProjection:base,projectedMinutes,
      playerImpact:impact?{offense:impact.offense,defense:impact.defense,net:impact.net}:null,
      roleContext:role||null,lineupContext:lineup||null,availabilityVerified:Boolean(availabilityVerified),
      independent:true,marketInformed:false,canQualify:false,canAuthorize:false
    }
  };
}
export function applyWnbaGameImpactShadow(game,{homeAdjustment=0,awayAdjustment=0,availabilityVerified=false}={}){
  const base=game?.wnbaV2||game?.researchProjection;
  if(!base?.ok&&base?.home==null)return null;
  const home=Number(base.home)+(finite(homeAdjustment)||0),away=Number(base.away)+(finite(awayAdjustment)||0);
  const margin=home-away,total=home+away;
  return {
    ok:true,modelId:WNBA_GAME_IMPACT_CHALLENGER_ID,modelVersion:"research-v1-shadow",
    home:round1(home),away:round1(away),margin:round1(margin),total:round1(total),
    sigmaMargin:base.sigmaMargin??10.2,sigmaTotal:base.sigmaTotal??12.1,
    pHomeWin:pGreater(margin,0,base.sigmaMargin??10.2),
    adjustments:{home:finite(homeAdjustment)||0,away:finite(awayAdjustment)||0,availabilityVerified:Boolean(availabilityVerified)},
    independent:true,marketInformed:false,canQualify:false,canAuthorize:false
  };
}
