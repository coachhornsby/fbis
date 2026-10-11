/** CFB prospective research diagnostics. No production projection or wagering authority. */
const finite=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const iso=v=>{const n=Date.parse(String(v||""));return Number.isFinite(n)?n:null;};
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const sd=a=>{const m=avg(a);return m==null?null:Math.sqrt(avg(a.map(v=>(v-m)**2)));};
const mae=a=>avg(a.map(Math.abs));
const rmse=a=>a.length?Math.sqrt(avg(a.map(v=>v*v))):null;
const side=(game,side)=>{const est=game?.cfb?.[side+"Est"]||{},fv=est.featureVector||{};
return {...(fv.raw||{}),...fv,...(game?.cfbMatchupInput?.[side]||{}),...(game?.cfbDeepInput?.[side]||{}),...(game?.cfbFbisV2Input?.[side]||{})};};
const pick=(o,keys)=>{for(const k of keys){const x=finite(o?.[k]);if(x!=null)return x;}return null;};
const specs={
 pass:{off:["passEpa","epaPass","passingPpa","ppaOffensePassing"],def:["passEpaAllowed","defPassEpa","passingPpaAllowed","ppaDefensePassing"]},
 rush:{off:["rushEpa","epaRush","rushingPpa","ppaOffenseRushing"],def:["rushEpaAllowed","defRushEpa","rushingPpaAllowed","ppaDefenseRushing"]}
};
const pairs=[["away-run-defense","rush","home","away"],["away-run-offense","rush","away","home"],["away-pass-defense","pass","home","away"],["away-pass-offense","pass","away","home"]];
export function cfbUnitFeatureAudit(game={}){
 const out={},missing=[];
 for(const [id,kind,offSide,defSide] of pairs){
  const o=pick(side(game,offSide),specs[kind].off),d=pick(side(game,defSide),specs[kind].def);
  const eligible=game.featureCutoffOk===true && finite(o)!=null && finite(d)!=null && iso(game.featureSnapshotAt)!=null && iso(game.startTime||game.startDate||game.kickoff)!=null && iso(game.featureSnapshotAt)<iso(game.startTime||game.startDate||game.kickoff);
  out[id]={eligible,offense:o,defense:d,reason:eligible?null:game.featureCutoffOk!==true?"cutoff-unverified":o==null||d==null?"missing-directional-feature":"missing-or-poststart-feature-snapshot"};
  if(!eligible)missing.push({id,reason:out[id].reason});
 }
 return {ok:missing.length===0,count:4,available:4-missing.length,tiles:out,missing,canQualify:false,canAuthorizeWager:false};
}
export function cfbTotalDispersionAudit(rows=[]){
 const valid=(rows||[]).filter(r=>finite(r.projHome)!=null&&finite(r.projAway)!=null&&finite(r.actualHome)!=null&&finite(r.actualAway)!=null);
 const p=valid.map(r=>Number(r.projHome)+Number(r.projAway)),a=valid.map(r=>Number(r.actualHome)+Number(r.actualAway));
 const projectedSd=sd(p),actualSd=sd(a),ratio=actualSd>0?projectedSd/actualSd:null;
 return {n:valid.length,projectedMean:avg(p),actualMean:avg(a),projectedSd,actualSd,sdRatio:ratio,
  totalMae:mae(p.map((v,i)=>v-a[i])),totalRmse:rmse(p.map((v,i)=>v-a[i])),
  compressed:valid.length>=20&&ratio!=null&&ratio<.35,
  modelChangeApproved:false,reason:valid.length<20?"insufficient-sample":ratio!=null&&ratio<.35?"projected-totals-underdispersed":null};
}
export function gradeCfbFrozenRows(rows=[]){
 const accepted=[],rejected=[];
 for(const r of rows||[]){
  const start=iso(r.eventStartAt),decision=iso(r.predictionAt),observed=iso(r.observedAt),finalAt=iso(r.finalAt),gradedAt=iso(r.gradedAt);
  const nums=[r.projHome,r.projAway,r.actualHome,r.actualAway].map(finite);
  const reason=start==null||decision==null?"missing-cutoff-proof":decision>=start?"poststart-prediction":r.featureCutoffOk!==true?"features-not-pit-verified":observed!=null&&observed>decision?"observation-after-decision":finalAt!=null&&finalAt<start?"invalid-final-timestamp":gradedAt!=null&&gradedAt<start?"graded-before-kickoff":nums.some(v=>v==null)?"missing-score":"";
  if(reason){rejected.push({gameId:r.gameId||null,reason});continue;}
  const [ph,pa,ah,aa]=nums,pMargin=ph-pa,aMargin=ah-aa,pTotal=ph+pa,aTotal=ah+aa;
  accepted.push({...r,projectedMargin:pMargin,actualMargin:aMargin,marginError:pMargin-aMargin,totalError:pTotal-aTotal,homeError:ph-ah,awayError:pa-aa,
    winnerCorrect:Math.sign(pMargin)===Math.sign(aMargin)&&pMargin!==0});
 }
 const marginErr=accepted.map(r=>r.marginError),totalErr=accepted.map(r=>r.totalError),scoreErr=accepted.flatMap(r=>[r.homeError,r.awayError]);
 return {n:accepted.length,rejected,metrics:{marginMae:mae(marginErr),marginRmse:rmse(marginErr),totalMae:mae(totalErr),totalRmse:rmse(totalErr),teamScoreMae:mae(scoreErr),
 winnerAccuracy:accepted.length?accepted.filter(r=>r.winnerCorrect).length/accepted.length:null,dispersion:cfbTotalDispersionAudit(accepted)},
  byGame:accepted.map(r=>({gameId:r.gameId,marginError:r.marginError,totalError:r.totalError,winnerCorrect:r.winnerCorrect})),
  canQualify:false,canAuthorizeWager:false};
}
export function cfbErrorSegments(rows=[]){
 const report=gradeCfbFrozenRows(rows);
 const valid=rows.filter(r=>report.byGame.some(x=>x.gameId===r.gameId));
 const groups=new Map();
 for(const r of valid){
  const margin=finite(r.projHome)-finite(r.projAway),total=finite(r.projHome)+finite(r.projAway);
  const conf=r.conference||"UNKNOWN";
  const groupKeys=[["conference",conf],["favoriteBand",Math.abs(margin)>=21?"21+":Math.abs(margin)>=10?"10-20.9":"0-9.9"],["projectedTotalBand",total<45?"under45":total<55?"45-54.9":"55+"],["sourceCoverage",r.featureCutoffOk===true?"verified":"unverified"]];
  for(const [dimension,key] of groupKeys){const id=dimension+":"+key;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(r);}
 }
 return [...groups].map(([id,subset])=>({segment:id,...gradeCfbFrozenRows(subset).metrics})).sort((a,b)=>a.segment.localeCompare(b.segment));
}
export function compareCfbTotalShadows(rows=[],challengers={}){
 const graded=gradeCfbFrozenRows(rows);
 const acceptedIds=new Set(graded.byGame.map(x=>x.gameId));
 const results={};
 for(const [name,predict] of Object.entries(challengers)){
  const errs=[],values=[];
  for(const r of rows){if(!acceptedIds.has(r.gameId))continue;const p=finite(predict(r));if(p==null)continue;
   errs.push(p-(finite(r.actualHome)+finite(r.actualAway)));values.push(p);}
  results[name]={n:errs.length,mae:mae(errs),rmse:rmse(errs),bias:avg(errs),predictionSd:sd(values),role:"shadow-only",canQualify:false};
 }
 return {incumbent:graded.metrics,challengers:results,automaticPromotion:false};
}
