import { pGreater } from "./metrics.js";
import { buildNbaDeepFeatures, NBA_DEEP_FEATURE_NAMES } from "./nbaDeepFeatures.js";

export const NBA_DEEP_MODEL_ID="NBA-FBIS-v2-DEEP";
export const NBA_DEEP_MODEL_VERSION="research-v1";
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;

function scoreHead(vector,head={}){
 const means=head.means||[],scales=head.scales||[],coef=head.coefficients||[];
 const z=vector.map((v,i)=>((finite(v)||0)-(finite(means[i])||0))/Math.max(finite(scales[i])||1,1e-8));
 let pred=finite(head.intercept)||0;
 for(let i=0;i<z.length;i++)pred+=(finite(coef[i])||0)*z[i];
 for(const s of head.stumps||[]){
   const x=z[Number(s.feature)||0]||0;
   pred+=(finite(s.learningRate)??1)*(x<=Number(s.threshold)?Number(s.left||0):Number(s.right||0));
 }
 return pred;
}

export function projectNbaDeepGame(game,context={},fit={}){
 const f=buildNbaDeepFeatures(game,context);
 if(!f.ok)return {ok:false,reason:f.reason||"deep_features_failed",modelId:NBA_DEEP_MODEL_ID};
 const marginResidual=scoreHead(f.vector,fit.margin||{});
 const totalResidual=scoreHead(f.vector,fit.total||{});
 const margin=f.incumbent.margin+marginResidual;
 const total=f.incumbent.total+totalResidual;
 const home=(total+margin)/2,away=(total-margin)/2;
 const availabilityUnc=(f.incumbent?.decomposition?.homeAvailability?.unc||0)+(f.incumbent?.decomposition?.awayAvailability?.unc||0);
 const baseMarginSigma=finite(fit?.margin?.sigma)??f.incumbent.sigmaMargin??14.5;
 const baseTotalSigma=finite(fit?.total?.sigma)??f.incumbent.sigmaTotal??18.5;
 const lineupUnknown=(context?.homeLineup?.availabilityVerified||context?.awayLineup?.availabilityVerified)?0:.35;
 const sigmaMargin=clamp(baseMarginSigma+availabilityUnc+lineupUnknown,10,22);
 const sigmaTotal=clamp(baseTotalSigma+availabilityUnc*.8+lineupUnknown*.6,13,28);
 return {
   ok:true,modelId:NBA_DEEP_MODEL_ID,modelVersion:fit.version||NBA_DEEP_MODEL_VERSION,
   home:round1(home),away:round1(away),margin:round1(margin),total:round1(total),
   expectedPossessions:f.incumbent.expectedPossessions,pHomeWin:pGreater(margin,0,sigmaMargin),
   sigmaMargin:round1(sigmaMargin),sigmaTotal:round1(sigmaTotal),
   incumbent:{modelId:f.incumbent.modelId,modelVersion:f.incumbent.modelVersion,margin:f.incumbent.margin,total:f.incumbent.total},
   residualAdjustments:{margin:round1(marginResidual),total:round1(totalResidual)},
   decomposition:{
     fourFactors:{
       home:{efg:f.values.homeExpectedEfg,tov:f.values.homeExpectedTov,orb:f.values.homeExpectedOrb,ftr:f.values.homeExpectedFtr},
       away:{efg:f.values.awayExpectedEfg,tov:f.values.awayExpectedTov,orb:f.values.awayExpectedOrb,ftr:f.values.awayExpectedFtr}
     },
     shotProfile:{home:f.homeShot,away:f.awayShot},
     schedule:f.schedule,lineups:f.lineups,
     nonlinearInteractions:{
       paceB2b:f.values.paceB2bInteraction,altitudeFatigue:f.values.altitudeFatigueInteraction,
       lineupDefenseVsOffense:f.values.lineupDefenseVsOffense,threeVolumeVsDefense:f.values.threeVolumeVsDefense
     },
     featureNames:NBA_DEEP_FEATURE_NAMES,
   },
   independent:true,marketInformed:false,maturity:"CHALLENGER",canQualify:false,canAuthorize:false,
   provenance:{marketUsed:false,fitId:fit.id||null,trainingCutoff:fit.trainingCutoff||null,availabilityVerified:f.provenance.availabilityVerified}
 };
}
