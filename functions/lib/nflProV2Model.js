/**
 * NFL-PRO-v2 research challenger.
 * Interaction-first extension of NFL-PRO-v1.2. Market prices are never inputs.
 * Missing advanced inputs remain missing and widen uncertainty.
 */
import { projectNflProV1 } from "./nflProModel.js";
import { clamp, finite, round1 } from "./deepModelCommon.js";
import { pGreater } from "./metrics.js";

export const NFL_PRO_V2_ID="NFL-PRO-v2";

const n=(o,...ks)=>{for(const k of ks){const v=finite(o?.[k]);if(v!=null)return v;}return null;};
const side=(g,s)=>g?.nflFeatures?.[s]||g?.nflDeepInput?.[s]||g?.gameFeatures?.[s]||{};

function pressureInteraction(off={},def={}){
  const allowed=n(off,"pressureRateAllowed"), generated=n(def,"pressureRate","defPressureRate");
  const qbPress=n(off,"qbPressureEpa","pressureEpa");
  if(allowed==null||generated==null)return null;
  const exposure=clamp((allowed-generated)*8,-1.6,1.6);
  const response=qbPress==null?0:clamp(qbPress*2.5,-0.8,0.8);
  return clamp(exposure+response,-2,2);
}
function runInteraction(off={},def={}){
  const yoe=n(off,"rushYoePerAtt"), rush=n(off,"rushEpa"), allowed=n(def,"rushEpaAllowed");
  if(rush==null||allowed==null)return null;
  return clamp((rush-allowed)*3.2+(yoe==null?0:yoe*.25),-1.6,1.6);
}
function coverageRouteInteraction(off={},def={}){
  const sep=n(off,"receivingSeparation"),yac=n(off,"receivingYacOe");
  const man=n(def,"manRate"),zone=n(def,"zoneRate"),manE=n(off,"epaVsMan"),zoneE=n(off,"epaVsZone");
  const coverage=man!=null&&zone!=null&&manE!=null&&zoneE!=null?man*manE+zone*zoneE:null;
  if(sep==null&&yac==null&&coverage==null)return null;
  return clamp((sep==null?0:(sep-2.9)*.35)+(yac==null?0:yac*.18)+(coverage==null?0:coverage*2),-1.4,1.4);
}
function availabilityValue(game,which){
  const impact=game?.availabilityImpact;
  if(!impact?.configured)return null;
  return which==="home"?finite(impact.homeScoreAdjustment):finite(impact.awayScoreAdjustment);
}
function volatility(f={}){
  const vals=[n(f,"explosiveRate"),n(f,"turnoverRate"),n(f,"qbSackRate"),n(f,"pressureRateAllowed")].filter(v=>v!=null);
  if(!vals.length)return null;
  return vals.reduce((s,v)=>s+Math.abs(v),0)/vals.length;
}
function familyMap(game,h,a){
  return {
    availability:game?.availabilityImpact?.configured===true,
    pressure:pressureInteraction(h,a)!=null&&pressureInteraction(a,h)!=null,
    runConcept:runInteraction(h,a)!=null&&runInteraction(a,h)!=null,
    coverageRoute:coverageRouteInteraction(h,a)!=null&&coverageRouteInteraction(a,h)!=null,
    tracking:[h,a].every(x=>n(x,"rushYoePerAtt","receivingSeparation","qbNgsCpoe")!=null),
    personnel:[h,a].every(x=>n(x,"snapShare","projectedSnapShare","offenseSnaps")!=null),
    context:[h,a].some(x=>Object.keys(x).some(k=>/rest|travel|weather|altitude|timeZone/i.test(k))),
  };
}
export function projectNflProV2(game={},options={}){
  const base=projectNflProV1(game);
  if(!base.ok)return {...base,modelId:NFL_PRO_V2_ID,version:"v2.0",role:"shadow",canQualify:false};
  const h=side(game,"home"),a=side(game,"away");
  const hp=pressureInteraction(h,a),ap=pressureInteraction(a,h);
  const hr=runInteraction(h,a),ar=runInteraction(a,h);
  const hc=coverageRouteInteraction(h,a),ac=coverageRouteInteraction(a,h);
  const ha=availabilityValue(game,"home"),aa=availabilityValue(game,"away");
  const w={pressure:1,run:1,coverageRoute:1,availability:1,...(options.weights||{})};
  const homeAdj=(hp??0)*w.pressure+(hr??0)*w.run+(hc??0)*w.coverageRoute+(ha??0)*w.availability;
  const awayAdj=(ap??0)*w.pressure+(ar??0)*w.run+(ac??0)*w.coverageRoute+(aa??0)*w.availability;
  const home=round1(clamp(base.home+homeAdj,8,42)),away=round1(clamp(base.away+awayAdj,8,42));
  const margin=round1(home-away),total=round1(home+away);
  const families=familyMap(game,h,a),present=Object.values(families).filter(Boolean).length,totalFamilies=Object.keys(families).length;
  const advancedCoverage=present/totalFamilies;
  const vol=[volatility(h),volatility(a)].filter(v=>v!=null);
  const volAdj=vol.length?clamp(vol.reduce((s,v)=>s+v,0)/vol.length,0,.25):.08;
  const missing=1-advancedCoverage;
  const sigmaMargin=round1(base.sigmaMargin*(1+missing*.16+volAdj*.10));
  const sigmaTotal=round1(base.sigmaTotal*(1+missing*.12+volAdj*.08));
  return {
    ...base,modelId:NFL_PRO_V2_ID,version:"v2.0",role:"shadow",canQualify:false,
    home,away,margin,total,sigmaMargin,sigmaTotal,pHomeWin:pGreater(margin,0,sigmaMargin),
    advancedCoverage:{share:advancedCoverage,present,total:totalFamilies,families},
    interactions:{weights:w,home:{pressure:hp,run:hr,coverageRoute:hc,availability:ha},away:{pressure:ap,run:ar,coverageRoute:ac,availability:aa}},
    provenance:{...base.provenance,marketUsed:false,missingFeaturesRemainMissing:true},
    note:"Research-only v2 interaction layer; no promotion without leakage-safe walk-forward evidence."
  };
}
export function attachNflProV2Shadow(games=[]){
  let available=0;
  const next=(games||[]).map(game=>{
    if(game.sport&&game.sport!=="nfl")return game;
    const p=projectNflProV2(game);if(p.ok)available++;
    return {...game,challengers:{...(game.challengers||{}),[NFL_PRO_V2_ID]:p},nflProV2Shadow:p};
  });
  return {games:next,meta:{modelId:NFL_PRO_V2_ID,role:"shadow",available,games:next.length,qualificationAllowed:false}};
}
