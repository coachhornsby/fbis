/**
 * Frozen FBIS CBB v2 margin correction from the definitive 2018-22 training fit.
 * Used only as an input to market-dislocation research. It does not authorize wagers.
 */
export const FBIS_CBB_V2_MARGIN_ID="FBIS-CBB-v2-MARGIN";
export const FBIS_CBB_V2_MARGIN_VERSION="v1.0.0";
const MODEL={"features":["fbis.possessions","fbis.paceAdjustment","fbis.reliability","fbis.hca","fbis.matchup.home.efg","fbis.matchup.away.efg","fbis.matchup.home.twoPt","fbis.matchup.away.twoPt","fbis.matchup.home.threePt","fbis.matchup.away.threePt","fbis.matchup.home.orebVsDrb","fbis.matchup.away.orebVsDrb","fbis.matchup.home.drbRate","fbis.matchup.away.drbRate","fbis.matchup.home.turnover","fbis.matchup.away.turnover","fbis.matchup.home.ftr","fbis.matchup.away.ftr","fbis.schedule.home.sos","fbis.schedule.away.sos","fbis.schedule.home.conferenceStrength","fbis.schedule.away.conferenceStrength"],"means":[72.0509515,-0.01629131,0.22443635,5.03567988,1.31932395,1.45985439,1.59611771,1.73520387,0.60801314,0.69136861,1.15955698,1.05462795,72.35599142,72.5602724,0.58762826,0.45241759,0.92901543,1.01291402,2.26953594,2.13688084,3.58387109,2.82645912],"sds":[3.35890923,0.3876762,0.12015628,2.20583894,5.51576036,5.58602983,6.42039475,6.43669786,5.74255587,5.8470958,6.40620141,6.28841169,4.1153286,4.02608311,3.83392351,3.89168383,9.57089765,9.26242587,2.63379786,2.67435015,3.82653047,3.83860497],"beta":[-0.23581998,0.45659367,0.06415239,-0.94611809,0.22699649,0.67218554,0.23602409,-0.62793422,0.16027521,-0.40598528,1.25914017,-0.86095841,-1.33504343,1.08072945,0.22514516,0.00993889,-0.03549806,0.0796365,1.13879184,-1.30333213,1.93440434,-1.95268474],"intercept":-1.36124863,"lambda":100};
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);
export function fbisCbbV2MarginCorrection(fbis){
 if(!fbis?.ok||n(fbis.margin)==null)return{ok:false,reason:"missing-fbis-margin"};
 const wrap={fbis};
 const vals=MODEL.features.map(p=>n(get(wrap,p))??0);
 let residual=MODEL.intercept;
 for(let j=0;j<vals.length;j++)residual+=MODEL.beta[j]*(vals[j]-MODEL.means[j])/MODEL.sds[j];
 return {ok:true,modelId:FBIS_CBB_V2_MARGIN_ID,modelVersion:FBIS_CBB_V2_MARGIN_VERSION,baseMargin:n(fbis.margin),residual,margin:n(fbis.margin)+residual,evidence:{training:"2018-22 only",validationMae:9.286,kenpomValidationMae:8.9438,secondary2025Mae:9.4113,kenpom2025Mae:9.1437,promoted:false}};
}
