/**
 * Frozen FBIS CBB v2 total residual correction.
 * Training: 2018-22 only. Lambda selected by leave-one-season-out.
 * Validation: 2023-24. Confirmation: 2025.
 * KenPom is benchmark-only and is not an input to this correction.
 */
export const FBIS_CBB_V2_TOTAL_ID="FBIS-CBB-v2-TOTAL";
export const FBIS_CBB_V2_TOTAL_VERSION="v2.0.0";
export const FBIS_CBB_V2_TOTAL_EVIDENCE=Object.freeze({
 training:"2018-22",
 validation:{n:8971,correctedMae:13.5092,kenpomMae:13.5758,vsKenpom:0.0666,baseGain:0.4631},
 confirmation:{n:4531,correctedMae:14.4553,kenpomMae:14.8974,vsKenpom:0.4421,baseGain:1.6809},
 marketInput:false,
 kenpomInput:false,
 canQualify:false,
 canAuthorizeWager:false
});
const FEATURES=[
"possessions","paceAdjustment","homeEff","awayEff","reliability","hca",
"matchup.home.efg","matchup.away.efg","matchup.home.twoPt","matchup.away.twoPt","matchup.home.threePt","matchup.away.threePt",
"matchup.home.orebVsDrb","matchup.away.orebVsDrb","matchup.home.drbRate","matchup.away.drbRate",
"matchup.home.turnover","matchup.away.turnover","matchup.home.ftr","matchup.away.ftr",
"schedule.home.sos","schedule.away.sos","schedule.home.conferenceStrength","schedule.away.conferenceStrength"
];
const MEANS=[72.0509515,-0.01629131,98.94032957,98.14600372,0.22443635,5.03567988,1.31932395,1.45985439,1.59611771,1.73520387,0.60801314,0.69136861,1.15955698,1.05462795,72.35599142,72.5602724,0.58762826,0.45241759,0.92901543,1.01291402,2.26953594,2.13688084,3.58387109,2.82645912];
const SDS=[3.35890923,0.3876762,4.81345148,4.95911179,0.12015628,2.20583894,5.51576036,5.58602983,6.42039475,6.43669786,5.74255587,5.8470958,6.40620141,6.28841169,4.1153286,4.02608311,3.83392351,3.89168383,9.57089765,9.26242587,2.63379786,2.67435015,3.82653047,3.83860497];
const BETA=[-0.83504902,1.13301313,0.36542919,0.09638574,2.63791935,0.3377703,0.29007336,0.21835998,0.33453986,0.12725472,0.10933338,0.20107432,0.35029627,0.2973489,-0.68096673,-0.45027427,0.24798716,0.19609061,0.52050697,0.19539902,0.4265534,0.34318551,0.36606792,0.00128297];
const INTERCEPT=-8.25209615;

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);
const r1=v=>Math.round(Number(v)*10)/10;

export function cbbFbisV2TotalCorrection(fbis){
 if(!fbis?.ok||n(fbis.total)==null)return{ok:false,total:null,residual:null,reason:"fbis-native-unavailable"};
 let residual=INTERCEPT;
 for(let i=0;i<FEATURES.length;i++){
  const x=n(get(fbis,FEATURES[i]))??0;
  residual+=BETA[i]*(x-MEANS[i])/SDS[i];
 }
 const total=n(fbis.total)+residual;
 return {
  ok:Number.isFinite(total),
  modelId:FBIS_CBB_V2_TOTAL_ID,
  modelVersion:FBIS_CBB_V2_TOTAL_VERSION,
  baseTotal:r1(fbis.total),
  residual:r1(residual),
  total:r1(total),
  independent:true,
  marketInformed:false,
  kenpomInput:false,
  evidence:FBIS_CBB_V2_TOTAL_EVIDENCE
 };
}
