/**
 * CBB-PLAYER-PROP-v2
 * Frozen walk-forward player prop calibration.
 *
 * Training: 2018-22 prior-only player state.
 * Validation: 2023-24.
 * Confirmation: 2025.
 * Promoted markets: points, rebounds, assists, PRA.
 * 3PM explicitly remains on v1 because v2 worsened MAE in both validation windows.
 *
 * Market lines are NOT model inputs.
 */
export const CBB_PLAYER_PROP_V2_ID="CBB-PLAYER-PROP-v2";
export const CBB_PLAYER_PROP_V2_VERSION="v2.0.0";
export const CBB_PLAYER_PROP_V2_MARKETS=Object.freeze(["points","rebounds","assists","points_rebounds_assists"]);
export const CBB_PLAYER_PROP_V2_MODELS=Object.freeze({"points":{"sigma":5.508,"lambda":100,"intercept":-0.31680018,"means":[23.35876799,23.38037837,0.83056064,15.58000374,8.61466457,14.19485686,8.68186069,8.66497771,4.55568763,71.88279042,70.47151769,0.49915742,14.19485686,6.66706087,2.61393199,1.45228839,11.41372328,3.63114957,1.81643775,4.85062312,2.49955887,0.67623108,0.02003462],"sds":[7.26033449,6.92245775,0.16160763,8.1111426,4.39288553,4.66141721,4.88195659,5.26674152,2.17761801,3.25285162,5.31091487,0.50000043,4.66141721,2.97951758,1.63891513,1.1556396,3.31541822,1.97059955,1.42229736,1.93228298,1.02434397,0.17175348,0.14011895],"beta":[-0.26829556,0.6320141,0.24130184,0.04499394,-0.3517739,-0.5743607,-0.60019008,-0.0143493,0.03906685,-0.46592835,-0.21401482,-0.00019899,-0.5743607,0.01802916,0.01245873,-0.22170857,1.0652514,0.22569713,-0.13975899,0.13067291,0.11160946,-0.13972566,-0.11386392],"evidence":{"validationGain":0.1468,"confirmationGain":0.2834}},"rebounds":{"sigma":2.363,"lambda":100,"intercept":-0.21530603,"means":[23.35876799,23.38037837,0.83056064,15.58000374,3.83212618,6.66706087,3.84438708,3.83705681,2.02646145,71.88279042,70.47151769,0.49915742,14.19485686,6.66706087,2.61393199,1.45228839,11.41372328,3.63114957,1.81643775,4.85062312,2.49955887,0.67623108,0.02003462],"sds":[7.26033449,6.92245775,0.16160763,8.1111426,1.96266564,2.97951758,2.15828907,2.33150884,1.02625361,3.25285162,5.31091487,0.50000043,4.66141721,2.97951758,1.63891513,1.1556396,3.31541822,1.97059955,1.42229736,1.93228298,1.02434397,0.17175348,0.14011895],"beta":[-0.09920542,-0.06306599,0.16308476,0.02102529,0.19853631,-0.11496084,-0.34328084,-0.02136472,0.00028507,-0.16592385,0.12893742,-0.00434329,0.27560842,-0.11496084,-0.10013084,-0.20778735,-0.0737831,-0.04482284,-0.04998561,-0.14047292,0.03580129,-0.07587034,-0.05351644],"evidence":{"validationGain":0.0238,"confirmationGain":0.0172}},"assists":{"sigma":1.467,"lambda":100,"intercept":-0.10985147,"means":[23.35876799,23.38037837,0.83056064,15.58000374,1.61640468,2.61393199,1.61661963,1.61134123,1.17331812,71.88279042,70.47151769,0.49915742,14.19485686,6.66706087,2.61393199,1.45228839,11.41372328,3.63114957,1.81643775,4.85062312,2.49955887,0.67623108,0.02003462],"sds":[7.26033449,6.92245775,0.16160763,8.1111426,1.25213247,1.63891513,1.36293281,1.45560627,0.73208083,3.25285162,5.31091487,0.50000043,4.66141721,2.97951758,1.63891513,1.1556396,3.31541822,1.97059955,1.42229736,1.93228298,1.02434397,0.17175348,0.14011895],"beta":[0.05984079,-0.0186771,0.0153998,-0.00777793,0.15243969,-0.1460907,-0.16907286,-0.04225538,-0.01510753,-0.10317686,0.10485593,0.04094576,-0.01812391,-0.04101052,-0.1460907,-0.05450718,0.04346938,0.01879208,-0.07823997,-0.00564673,0.08102918,-0.04573602,-0.01419835],"evidence":{"validationGain":0.0174,"confirmationGain":0.0112}},"points_rebounds_assists":{"sigma":6.986,"lambda":10,"intercept":-0.55052738,"means":[23.35876799,23.38037837,0.83056064,15.58000374,14.06319542,23.47584973,14.1428674,14.11337574,5.3139968,71.88279042,70.47151769,0.49915742,14.19485686,6.66706087,2.61393199,1.45228839,11.41372328,3.63114957,1.81643775,4.85062312,2.49955887,0.67623108,0.02003462],"sds":[7.26033449,6.92245775,0.16160763,8.1111426,6.22051751,5.98538079,6.82721607,7.30390908,2.08088901,3.25285162,5.31091487,0.50000043,4.66141721,2.97951758,1.63891513,1.1556396,3.31541822,1.97059955,1.42229736,1.93228298,1.02434397,0.17175348,0.14011895],"beta":[-0.70453196,1.02308068,0.43380585,0.06488894,-0.56802735,-0.51291962,-0.70941308,0.19957895,0.05341865,-0.72875106,-0.37788942,0.03517292,-0.61295581,-0.00846325,-0.11444159,-0.48471803,1.03921001,0.20083493,-0.1747071,0.11554676,0.22839023,-0.21355478,-0.18395544],"evidence":{"validationGain":0.2361,"confirmationGain":0.4697}}});

const FEATURES=Object.freeze(["projectedMinutes","minutesPerGame","roleConfidence","sampleSize","season","per40","recent","trend","volatility","possessions","teamScore","home","pointsPer40","reboundsPer40","assistsPer40","threesPer40","fgaPer40","ftaPer40","orebPer40","drebPer40","tovPer40","minuteStability","lastGameDnp"]);
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const r1=v=>Math.round(Number(v)*10)/10;
function marketVals(p,m){
 if(m==="points_rebounds_assists"){
  return {
   season:(n(p.pointsPerGame)||0)+(n(p.reboundsPerGame)||0)+(n(p.assistsPerGame)||0),
   per40:(n(p.pointsPer40)||0)+(n(p.reboundsPer40)||0)+(n(p.assistsPer40)||0),
   recent:(n(p.recent?.points)||0)+(n(p.recent?.rebounds)||0)+(n(p.recent?.assists)||0),
   trend:(n(p.trend?.points)||0)+(n(p.trend?.rebounds)||0)+(n(p.trend?.assists)||0),
   volatility:Math.sqrt((n(p.volatility?.points)||0)**2+(n(p.volatility?.rebounds)||0)**2+(n(p.volatility?.assists)||0)**2)
  };
 }
 const key=m;
 return {season:n(p[key+"PerGame"]),per40:n(p[key+"Per40"]),recent:n(p.recent?.[key]),trend:n(p.trend?.[key]),volatility:n(p.volatility?.[key])};
}
function baseline(p,m,{possessions=69,teamScore=72}={}){
 const v=marketVals(p,m),mins=n(p.projectedMinutes)||0;
 const pieces=[[v.per40==null?null:v.per40*mins/40,.48],[v.season,.22],[v.recent,.20],[v.trend,.10]];
 let sx=0,sw=0;for(const [x,w] of pieces){if(x==null)continue;sx+=x*w;sw+=w}
 if(!sw)return null;
 let y=sx/sw;
 y*=clamp((n(possessions)||69)/69,.88,1.12);
 if(m==="points"||m==="points_rebounds_assists")y*=clamp((n(teamScore)||72)/72,.86,1.16);
 return y;
}
function vector(p,m,{possessions=69,teamScore=72,home=false}={}){
 const v=marketVals(p,m);
 return [
  n(p.projectedMinutes)||0,n(p.minutesPerGame)||0,n(p.roleConfidence)||0,n(p.sampleSize)||0,
  n(v.season)||0,n(v.per40)||0,n(v.recent)||0,n(v.trend)||0,n(v.volatility)||0,
  n(possessions)||69,n(teamScore)||72,home?1:0,
  n(p.pointsPer40)||0,n(p.reboundsPer40)||0,n(p.assistsPer40)||0,n(p.threesMadePer40)||0,
  n(p.fieldGoalAttemptsPer40)||0,n(p.freeThrowAttemptsPer40)||0,n(p.offensiveReboundsPer40)||0,n(p.defensiveReboundsPer40)||0,n(p.turnoversPer40)||0,
  n(p.role?.minuteStability)||0,p.role?.lastGameDnp?1:0
 ];
}
export function projectCbbPlayerPropV2(player,market,context={}){
 const model=CBB_PLAYER_PROP_V2_MODELS[market];
 if(!model)return{ok:false,reason:"market-not-promoted",market};
 const base=baseline(player,market,context);if(base==null)return{ok:false,reason:"insufficient-player-state",market};
 const x=vector(player,market,context);let residual=model.intercept;
 for(let j=0;j<x.length;j++)residual+=model.beta[j]*(x[j]-model.means[j])/model.sds[j];
 const projection=Math.max(0,base+residual);
 return {ok:true,market,projection:r1(projection),sigma:model.sigma,baseProjection:r1(base),residual:r1(residual),modelId:CBB_PLAYER_PROP_V2_ID,modelVersion:CBB_PLAYER_PROP_V2_VERSION,independent:true,marketInformed:false,evidence:model.evidence};
}
export function v2FeatureNames(){return FEATURES.slice()}
