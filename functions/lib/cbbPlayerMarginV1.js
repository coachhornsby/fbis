/**
 * CBB-PLAYER-GAME-MARGIN-v1
 * Frozen incremental player-state margin correction.
 *
 * Adds a small out-of-sample improvement to FBIS margin MAE:
 * 2023-24 +0.0340 overall (+0.0374 eligible-only)
 * 2025    +0.0553 overall (+0.0610 eligible-only)
 *
 * It is a shadow game-projection improvement only. It is NOT used by
 * CBB-SIDE-DISLOCATION-v1 because the frozen >=10 money regime weakened.
 */
export const CBB_PLAYER_MARGIN_ID="CBB-PLAYER-GAME-MARGIN-v1";
export const CBB_PLAYER_MARGIN_VERSION="v1.0.0";
export const CBB_PLAYER_MARGIN_MODEL=Object.freeze({"features":["pointsProxyDiff","pointsProxySum","reboundsProxyDiff","reboundsProxySum","assistsProxyDiff","assistsProxySum","threesProxyDiff","threesProxySum","fgaProxyDiff","fgaProxySum","ftaProxyDiff","ftaProxySum","offensiveReboundProxyDiff","offensiveReboundProxySum","defensiveReboundProxyDiff","defensiveReboundProxySum","turnoverProxyDiff","turnoverProxySum","efgDiff","efgSum","trueShootingDiff","trueShootingSum","top5MinuteShareDiff","top5MinuteShareSum","top3UsageShareDiff","top3UsageShareSum","roleConfidenceDiff","roleConfidenceSum","minuteStabilityDiff","minuteStabilitySum","starterMinuteShareDiff","starterMinuteShareSum","experiencedMinuteShareDiff","experiencedMinuteShareSum","recentDnpMinuteShareDiff","recentDnpMinuteShareSum"],"means":[0.43349941,145.20835565,0.21960803,65.56383892,0.11248885,27.16400796,0.02144205,15.10954487,0.05501405,116.55918107,0.14317104,36.95855036,0.05077446,17.36369225,0.16883374,48.20014608,-0.08443652,25.15235988,0.22824519,102.17760585,0.22462021,109.00401601,0.00260125,1.40950373,0.00282924,0.70452822,0.00159907,1.72666131,0.00174439,1.37068502,0.00404842,1.35504245,0.000372,1.89759899,-0.00090952,0.04229114],"sds":[8.59757998,9.63438488,4.20128535,4.64574013,2.96197909,3.2470113,2.13329391,2.32199338,5.03581217,5.33923747,4.14717815,4.86526091,2.46422868,2.72119704,2.93238244,3.25236149,2.30702179,2.68126539,4.89157179,5.49378998,4.59796255,5.18382864,0.07959428,0.08628914,0.07807849,0.08309047,0.0478757,0.10424933,0.11386465,0.12163675,0.10767853,0.11568841,0.06727132,0.2288748,0.0428632,0.04402642],"beta":[0.34259982,-0.09671116,0.00381597,0.00010134,0.65250621,0.20863356,-0.24003031,-0.08799813,-0.19804042,-0.21706057,0.05680889,0.04289509,0.20775373,0.05270764,-0.16908475,-0.04393402,-0.66960672,-0.08381013,-0.01009107,-0.09800171,0.11730147,0.07999413,0.02179392,-0.1768076,-0.12452133,0.06531268,0.04507982,0.09298508,0.17351047,-0.01951902,0.17203697,0.08126365,-0.18565821,0.04347981,-0.57753628,0.09411209],"intercept":-0.06799047,"lambda":1000});
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const r=v=>Number(Number(v).toFixed(3));
export function playerMarginEligible(home={},away={}){
 return Boolean(home.ok&&away.ok&&(n(home.players)||0)>=6&&(n(away.players)||0)>=6
  &&(n(home.roleConfidence)||0)>=.42&&(n(away.roleConfidence)||0)>=.42
  &&(n(home.experiencedMinuteShare)||0)>=.45&&(n(away.experiencedMinuteShare)||0)>=.45);
}
export function cbbPlayerMarginCorrection(features={},home={},away={}){
 if(!playerMarginEligible(home,away))return{ok:false,reason:"player-state-not-mature",correction:0};
 const m=CBB_PLAYER_MARGIN_MODEL;let y=m.intercept;
 for(let j=0;j<m.features.length;j++){
   const x=n(features?.[m.features[j]])??0;
   y+=m.beta[j]*(x-m.means[j])/m.sds[j];
 }
 return{
   ok:true,modelId:CBB_PLAYER_MARGIN_ID,modelVersion:CBB_PLAYER_MARGIN_VERSION,
   correction:r(y),independent:true,marketInformed:false,
   evidence:{validationMaeGain:0.0340,confirmation2025MaeGain:0.0553,eligibleValidationGain:0.0374,eligible2025Gain:0.0610},
   moneySelectorApproved:false,
   moneyReason:"Frozen >=10 side-dislocation ROI declined after player correction; retain original money trigger."
 };
}
