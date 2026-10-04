import { fbisCbbV2MarginCorrection } from "./cbbFbisV2Margin.js";
import { CBB_PLAYER_GAME_MARGIN_MODEL, CBB_PLAYER_PROP_MODELS } from "./cbbPlayerValidatedModels.js";

export const CBB_PLAYER_GAME_MODEL_ID="CBB-PLAYER-GAME-v1";
export const CBB_PLAYER_PROP_MODEL_V2_ID="CBB-PLAYER-PROP-v2";
export const CBB_PLAYER_PROP_PROMOTED_MARKETS=Object.freeze(["points","rebounds","assists","points_rebounds_assists"]);

const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const r=(v,d=3)=>v==null?null:Number(Number(v).toFixed(d));

function residual(model,x){
  let y=model.intercept;
  for(let i=0;i<x.length;i++)y+=model.beta[i]*(x[i]-model.means[i])/model.sds[i];
  return y;
}
function weighted(vals){
  let sx=0,sw=0;
  for(const [x0,w] of vals){const x=n(x0);if(x==null)continue;sx+=x*w;sw+=w}
  return sw?sx/sw:null;
}
function marketVals(p,m){
  const key=m==="three_pointers_made"?"threesMade":m;
  if(m==="points_rebounds_assists"){
    return{
      season:(n(p.pointsPerGame)||0)+(n(p.reboundsPerGame)||0)+(n(p.assistsPerGame)||0),
      per40:(n(p.pointsPer40)||0)+(n(p.reboundsPer40)||0)+(n(p.assistsPer40)||0),
      recent:(n(p.recent?.points)||0)+(n(p.recent?.rebounds)||0)+(n(p.recent?.assists)||0),
      trend:(n(p.trend?.points)||0)+(n(p.trend?.rebounds)||0)+(n(p.trend?.assists)||0),
      volatility:Math.sqrt((n(p.volatility?.points)||0)**2+(n(p.volatility?.rebounds)||0)**2+(n(p.volatility?.assists)||0)**2),
    };
  }
  return{
    season:n(p[key+"PerGame"]),
    per40:n(p[key+"Per40"]),
    recent:n(p.recent?.[key]),
    trend:n(p.trend?.[key]),
    volatility:n(p.volatility?.[key]),
  };
}
function propBaseline(p,m,{possessions=69,teamScore=72}={}){
  const v=marketVals(p,m),mins=n(p.projectedMinutes)||0;
  let y=weighted([
    [v.per40==null?null:v.per40*mins/40,.48],
    [v.season,.22],[v.recent,.20],[v.trend,.10],
  ]);
  if(y==null)return null;
  y*=clamp((n(possessions)||69)/69,.88,1.12);
  if(m==="points"||m==="points_rebounds_assists")y*=clamp((n(teamScore)||72)/72,.86,1.16);
  return y;
}
function propFeatures(p,m,{possessions=69,teamScore=72,home=false}={}){
  const v=marketVals(p,m);
  return[
    n(p.projectedMinutes)||0,n(p.minutesPerGame)||0,n(p.roleConfidence)||0,n(p.sampleSize)||0,
    n(v.season)||0,n(v.per40)||0,n(v.recent)||0,n(v.trend)||0,n(v.volatility)||0,
    n(possessions)||69,n(teamScore)||72,home?1:0,
    n(p.pointsPer40)||0,n(p.reboundsPer40)||0,n(p.assistsPer40)||0,n(p.threesMadePer40)||0,
    n(p.fieldGoalAttemptsPer40)||0,n(p.freeThrowAttemptsPer40)||0,
    n(p.offensiveReboundsPer40)||0,n(p.defensiveReboundsPer40)||0,n(p.turnoversPer40)||0,
    n(p.role?.minuteStability)||0,p.role?.lastGameDnp?1:0,
  ];
}

export function projectCbbPlayerPropV2(player,market,context={}){
  const model=CBB_PLAYER_PROP_MODELS[market];
  if(!model)return{ok:false,reason:"market-not-validated"};
  const base=propBaseline(player,market,context);
  if(base==null)return{ok:false,reason:"baseline-unavailable"};
  const correction=residual(model,propFeatures(player,market,context));
  return{
    ok:true,
    modelId:CBB_PLAYER_PROP_MODEL_V2_ID,
    market,
    baseline:r(base),
    correction:r(correction),
    projection:r(base+correction),
    sigma:r(model.sigma),
    independent:true,
    marketInformed:false,
    canQualify:false,
    canAuthorizeWager:false,
    validationStatus:"PROMOTED_PREDICTIVE_ONLY",
  };
}

export function applyCbbPlayerMarginV1(game={}){
  const native=game.cbbFbisNative||game?.challengers?.["FBIS-CBB-RATINGS-v2"]||game?.challengers?.["FBIS-CBB-RATINGS-v1"];
  const base=fbisCbbV2MarginCorrection(native);
  const pg=game.cbbPlayerGame;
  if(!base?.ok||!pg?.ok)return{ok:false,reason:"player-game-context-unavailable"};
  const x=CBB_PLAYER_GAME_MARGIN_MODEL.features.map(k=>n(pg.features?.[k])||0);
  const correction=residual(CBB_PLAYER_GAME_MARGIN_MODEL,x);
  return{
    ok:true,
    modelId:CBB_PLAYER_GAME_MODEL_ID,
    baseMargin:r(base.margin),
    playerCorrection:r(correction),
    margin:r(base.margin+correction),
    independent:true,
    marketInformed:false,
    canQualify:false,
    canAuthorizeWager:false,
    evidence:{
      validationGain:0.0436,
      confirmation2025Gain:0.0486,
      eligibleValidationGain:0.0481,
      eligibleConfirmation2025Gain:0.0536,
      totalPromoted:false,
      marginPromoted:true,
    },
  };
}
