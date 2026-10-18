import {contractPriceToAmerican} from './marketQuoteDisplay.js';
const num=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const probability=v=>{const n=num(v);return n>0&&n<1?n:null;};
export function standardPolymarketFee(price,contracts=1,coefficient=.0695){
 const p=probability(price),q=num(contracts);
 return p==null||q==null||q<=0?null:coefficient*q*p*(1-p);
}
export function maxPolymarketEntry(probabilityValue,{buffer=0,coefficient=.0695}={}){
 const p=probability(probabilityValue);if(p==null)return null;
 let lo=0,hi=1;for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(mid+standardPolymarketFee(mid,1,coefficient)+buffer<=p)lo=mid;else hi=mid;}return lo;
}
/** Re-evaluates each observed quote; never changes model probability or wager authority. */
export function assessPolymarketOffer(offer,modelProbability,{now=new Date(),stake=5,eventStart=null,maxAgeMs=90000}={}){
 const raw=offer?.raw||{},p=probability(modelProbability),ask=probability(raw.bestAsk),bid=probability(raw.bestBid);
 const clock=offer?.providerObservedAt||offer?.sourceObservedAt||null;
 const age=clock?now.getTime()-Date.parse(clock):null;
 const coefficient=num(raw.feeCoefficient);
 const feeCoefficient=coefficient!=null&&coefficient>=0&&coefficient<=1?coefficient:.0695;
 const levels=Array.isArray(raw.offers)?raw.offers:[];
 const budget=num(stake);let remaining=budget>0?budget:5,quantity=0,cost=0,fee=0;
 for(const level of levels){const px=probability(level.price),qty=num(level.quantity);if(px==null||qty==null||qty<=0)continue;
  const per=px+standardPolymarketFee(px,1,feeCoefficient),take=Math.min(qty,remaining/per);
  quantity+=take;cost+=take*px;fee+=standardPolymarketFee(px,take,feeCoefficient);remaining-=take*per;if(remaining<1e-8)break;
 }
 const average=quantity>0?cost/quantity:null;
 const effective=quantity>0?(cost+fee)/quantity:ask==null?null:ask+standardPolymarketFee(ask,1,feeCoefficient);
 const edge=p!=null&&effective!=null?p-effective:null;
 const reasons=[];
 const started=eventStart&&Number.isFinite(Date.parse(eventStart))&&Date.parse(eventStart)<=now.getTime();
 if(started)reasons.push('Pregame market has started');
 if(!offer)reasons.push('No matched Polymarket quote');
 if(p==null)reasons.push('Independent FBIS probability unavailable');
 if(age==null||!Number.isFinite(age))reasons.push('Provider quote time unavailable');
 else if(age<0||age>maxAgeMs)reasons.push('Quote needs a fresh market check');
 if(ask==null)reasons.push('No observed buy price');
 if(bid!=null&&ask!=null&&bid>ask)reasons.push('Crossed book');
 if(raw.marketState!=='MARKET_STATE_OPEN')reasons.push('Open market state unverified');
 if(raw.settlementVerified!==true)reasons.push('Settlement equivalence unverified');
 if(!levels.length||remaining>1e-6)reasons.push('Insufficient verified depth for proposed stake');
 const state=reasons.length?'VERIFY':edge<=0?'PASS':edge<.02?'WATCH':'CONSIDER';
 const price=ask??probability(offer?.contractPrice);
 return {state,reasons,stake:budget>0?budget:5,buyPrice:ask,sellPrice:bid,displayPrice:price,
  impliedAmerican:contractPriceToAmerican(price),bidAmerican:contractPriceToAmerican(bid),
  askAmerican:contractPriceToAmerican(ask),spread:bid!=null&&ask!=null?ask-bid:null,
  averageEntry:average,estimatedQuantity:quantity||null,estimatedFee:quantity>0?fee:null,
  effectivePrice:effective,netEdge:edge,maxEntry:maxPolymarketEntry(p,{coefficient:feeCoefficient}),
  quoteAgeMs:age,sourceTime:clock,collectionTime:offer?.collectedAt||null,
  delivery:offer?.deliveryStore||'PRIMARY_D1',feePolicy:coefficient==null?'STANDARD_TAKER_ESTIMATE_NO_REBATE':'PROVIDER_COEFFICIENT_NO_REBATE',
  feeEstimateOnly:true,decisionThresholdPolicy:'RESEARCH_2PP_UNVALIDATED',
  synopsis:reasons.length?reasons.join(' · '):state==='PASS'?'Observed price has no positive value after estimated fees.':
   `Estimated value ${(edge*100).toFixed(1)} pp after fees; recheck price and size before manual entry.`,
  canQualify:false,canAuthorizeWager:false,modelInfluence:'none'};
}
