/**
 * CFB game-level wager intelligence.
 * Market/ACTION data is execution-only and never feeds the independent projection.
 */
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function americanBreakEven(price=-110){const p=n(price);if(p==null||p===0)return null;return p<0?(-p)/((-p)+100):100/(p+100)}
export function buildCfbMarketTrajectory(observations=[]){
 const rows=[...observations].filter(x=>x&&x.observedAt).sort((a,b)=>new Date(a.observedAt)-new Date(b.observedAt));
 return rows.map((r,i)=>{const prev=rows[i-1];const line=n(r.line);const prevLine=n(prev?.line);const open=n(rows[0]?.line);
  const tickets=n(r.ticketPct),money=n(r.moneyPct);
  return {...r,lineMoveFromOpen:line!=null&&open!=null?line-open:null,lineMoveFromPrior:line!=null&&prevLine!=null?line-prevLine:null,
   ticketMoneyDivergence:tickets!=null&&money!=null?money-tickets:null};
 });
}
export function scoreCfbGameOffer({projectionMargin,marketLine,price=-110,calibratedWinProbability,projectionUncertainty,dataQuality=1,actionConfirmation=0,trajectory=[]}={}){
 const proj=n(projectionMargin),line=n(marketLine),p=n(calibratedWinProbability),be=americanBreakEven(price);
 if([proj,line,p,be].some(v=>v==null)) return {ok:false,reason:"MISSING_REQUIRED_INPUT"};
 const edge=Math.abs(proj-line); const q=clamp(n(dataQuality)??0,0,1); const unc=Math.max(0,n(projectionUncertainty)??14);
 const ev=p*(price>0?price/100:100/Math.abs(price))-(1-p);
 const conf=clamp(Math.round(100*(0.42*clamp((p-be)/0.08,0,1)+0.20*q+0.18*clamp(edge/7,0,1)+0.10*clamp(1-unc/20,0,1)+0.10*clamp((actionConfirmation+1)/2,0,1))),0,100);
 return {ok:true,projectionMargin:proj,marketLine:line,edge,price,breakEvenProbability:be,calibratedWinProbability:p,expectedValuePerUnit:ev,confidence:conf,
  decision:(p>be&&ev>0)?"RESEARCH_CANDIDATE":"PASS",trajectory:buildCfbMarketTrajectory(trajectory)};
}
