import {assessPolymarketOffer} from './polymarketIntelligence.js';
const n=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const cdf=z=>{const x=Math.abs(z)/Math.SQRT2,t=1/(1+.3275911*x),erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return (1+(z<0?-erf:erf))/2;};

/** Research comparison only. No calibration, key-number accuracy or execution permission is inferred. */
export function rankAlternateLines(game,projection,offers=[],{now=new Date(),stake=5}={}){
 const distribution=game?.nflGameMatchup?.final||game?.nflProShadow||game?.cfb||{};
 const meanMargin=n(projection?.home)!=null&&n(projection?.away)!=null?Number(projection.home)-Number(projection.away):null;
 const meanTotal=n(projection?.total),sigmaMargin=n(distribution.sigmaMargin),sigmaTotal=n(distribution.sigmaTotal);
 const chosen=new Map();
 for(const o of offers){
  if(o.period!=='full_game'||!['spread','total'].includes(o.marketFamily)||n(o.line)==null)continue;
  if(o.marketFamily==='spread'&&!['home','away'].includes(o.side)||o.marketFamily==='total'&&!['over','under'].includes(o.side))continue;
  const key=[o.source?.startsWith('Polymarket')?'Polymarket':o.source,o.sourceMarketId,o.side,o.line].join('|');const prior=chosen.get(key);
  if(!prior||Date.parse(o.collectedAt||o.capturedAt)>Date.parse(prior.collectedAt||prior.capturedAt))chosen.set(key,o);
 }
 return [...chosen.values()].map(o=>{
  const sigma=o.marketFamily==='spread'?sigmaMargin:sigmaTotal;
  const mu=o.marketFamily==='spread'?(meanMargin==null?null:(o.side==='home'?meanMargin:-meanMargin)+Number(o.line)):meanTotal==null?null:(o.side==='over'?meanTotal-Number(o.line):Number(o.line)-meanTotal);
  const reasons=['Line-specific probabilities use an uncalibrated research distribution'];
  const integer=Number.isInteger(Number(o.line));
  const win=mu!=null&&sigma>0?1-cdf(((integer ? 0.5 : 0)-mu)/sigma):null;
  const loss=mu!=null&&sigma>0?cdf((-(integer ? 0.5 : 0)-mu)/sigma):null;
  const push=win==null?null:Math.max(0,1-win-loss);
  let ev=null,entry=null,american=null;
  if(o.source==='PinnOdds'){
   const decimal=n(o.decimalOdds);if(decimal>1){entry=1/decimal;american=decimal>=2?(decimal-1)*100:-100/(decimal-1);if(win!=null)ev=win*(decimal-1)-loss;}
   reasons.push('PinnOdds provider quote timestamp is unverified');
  }else{
   const assessment=assessPolymarketOffer(o,win,{now,stake,eventStart:game.start});
   reasons.push(...assessment.reasons);entry=assessment.effectivePrice;american=assessment.askAmerican;
   if(integer)reasons.push('Integer-line settlement requires verification');
   else if(win!=null&&entry>0&&!assessment.reasons.some(r=>!r.includes('Settlement equivalence')))ev=win/entry-1;
  }
  if(win==null)reasons.push('Line-specific model uncertainty unavailable');
  if(Date.parse(game.start||'')<=+now)reasons.push('Pregame market has started');
  const mainOffers=game?.pinnoddsResearch?.offers||[];
  const mainLine=mainOffers.find(q=>q.marketFamily===o.marketFamily&&q.side===o.side&&n(q.line)!=null);
  const lineDistance=mainLine?Math.abs(Number(o.line)-Number(mainLine.line)):null;
  return {source:o.source,marketFamily:o.marketFamily,side:o.side,line:Number(o.line),winProbability:win,pushProbability:push,
    american:american==null?null:Math.round(american),estimatedRoi:ev,entryPrice:entry,state:'VERIFY',reasons:[...new Set(reasons)],
    isAlternative:mainOffers.some(q=>q.marketFamily===o.marketFamily&&q.side===o.side&&n(q.line)!=null&&Number(q.line)!==Number(o.line)),
    lineDistance,canQualify:false,canAuthorizeWager:false,probabilityBasis:'RESEARCH_NORMAL_APPROXIMATION',stake};
 }).sort((a,b)=>(b.estimatedRoi??-Infinity)-(a.estimatedRoi??-Infinity)||(b.winProbability??0)-(a.winProbability??0));
}

/**
 * Pick the next few alternate lines that could realistically hit and are still
 * worth the price — not extreme longshots (+2000 juice / ~10% win estimates).
 */
export function selectCompetitiveAlternatives(ranked=[],{
  limit=3,
  minWin=0.28,
  maxWin=0.78,
  maxAbsAmerican=275,
  maxLineDistance=10.5,
}={}){
 const competitive=(row)=>{
  if(!row?.isAlternative) return false;
  if(row.winProbability==null||row.estimatedRoi==null) return false;
  if(row.winProbability<minWin||row.winProbability>maxWin) return false;
  if(row.american!=null&&Math.abs(Number(row.american))>maxAbsAmerican) return false;
  if(row.lineDistance!=null&&Number(row.lineDistance)>maxLineDistance) return false;
  return true;
 };
 const scored=ranked.filter(competitive).sort((a,b)=>{
  const aPos=Number(a.estimatedRoi>0),bPos=Number(b.estimatedRoi>0);
  if(bPos!==aPos) return bPos-aPos;
  // Prefer better return, then higher (but not extreme) win chance, then closer to main line.
  return (b.estimatedRoi??-Infinity)-(a.estimatedRoi??-Infinity)
    || (b.winProbability??0)-(a.winProbability??0)
    || (a.lineDistance??99)-(b.lineDistance??99);
 });
 // Keep variety: at most one pick per marketFamily+side, then fill remaining slots.
 const out=[], used=new Set();
 for(const row of scored){
  const key=row.marketFamily+'|'+row.side;
  if(used.has(key)) continue;
  used.add(key);
  out.push(row);
  if(out.length>=limit) return out;
 }
 for(const row of scored){
  if(out.includes(row)) continue;
  out.push(row);
  if(out.length>=limit) break;
 }
 return out;
}
