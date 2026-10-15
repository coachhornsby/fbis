/** Read-only market research. Never import into independent projection code. */
export const FLOW_VERSION="pm-us-flow-v1-shadow";
export const FLOW_WINDOWS=Object.freeze({"1m":60000,"5m":300000,"15m":900000,"1h":3600000});
const finite=v=>v!=null&&v!==""&&Number.isFinite(Number(v))?Number(v):null;
export function probabilityAmerican(p){p=finite(p);return p>0&&p<1?Math.round(p>=.5?-100*p/(1-p):100*(1-p)/p):null;}
export function tradeIdentity(t){
 // Provider has no documented unique ID. Identical prints can be distinct.
 // Conservative fingerprint deduplication is disclosed; counts are lower bounds.
 return JSON.stringify([t.marketSlug,t.providerTradeId||null,t.at,t.price,t.quantity,t.quantityUnit,t.maker,t.taker]);
}
export function flowSummary({trades=[],quotes=[],now=Date.now(),window="15m",coverageStart=null,gaps=[],truncated=false}={}){
 const duration=FLOW_WINDOWS[window];if(!duration)throw Error("unsupported-flow-window");
 const since=now-duration,seen=new Set(),valid=[];
 for(const t of trades){const at=Date.parse(t.at);if(at<since||at>now||!Number.isFinite(at))continue;
 const id=tradeIdentity(t);if(seen.has(id))continue;seen.add(id);valid.push(t);}
 const units=[...new Set(valid.map(t=>t.quantityUnit))];
 const classified=valid.filter(t=>(t.direction===1||t.direction===-1)&&finite(t.quantity)>0);
 const yes=classified.filter(t=>t.direction===1).reduce((s,t)=>s+t.quantity,0),no=classified.filter(t=>t.direction===-1).reduce((s,t)=>s+t.quantity,0);
 const total=yes+no,latestTrade=valid.map(t=>Date.parse(t.at)).sort((a,b)=>b-a)[0];
 const coverageComplete=Number.isFinite(Date.parse(coverageStart))&&Date.parse(coverageStart)<=since&&!truncated&&!gaps.some(g=>Date.parse(g.end||new Date(now).toISOString())>since&&Date.parse(g.start)<=now);
 const reasons=[];
 if(!coverageComplete)reasons.push("INCOMPLETE_SOURCE_WINDOW");
 if(classified.length<5)reasons.push("FEWER_THAN_5_CLASSIFIED_TRADES");
 if(!total||units.length!==1||units[0]==="UNKNOWN")reasons.push("MISSING_OR_INCONSISTENT_QUANTITY_UNIT");
 if(valid.length&&classified.length/valid.length<.9)reasons.push("DIRECTIONAL_CLASSIFICATION_BELOW_90_PERCENT");
 if(!latestTrade||now-latestTrade>120000)reasons.push("NO_RECENT_TRADE_WITHIN_2_MINUTES");
 const series=quotes.filter(q=>Date.parse(q.at)>=since&&Date.parse(q.at)<=now).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const priced=series.filter(q=>finite(q.lastTrade)!==null);
 const first=priced[0],last=priced.at(-1),delta=first&&last?(last.lastTrade-first.lastTrade)*100:null;
 const movement=first&&last?{kind:"LAST_TRADED_PRICE",start:first.lastTrade,end:last.lastTrade,changePp:delta,startAt:first.at,endAt:last.at,fullWindow:Date.parse(first.at)<=since+30000}:null;
 const share=total?yes/total:null,leader=share===null?null:share>=.5?1:-1;
 let state="INSUFFICIENT DATA";
 if(!reasons.length){state=Math.abs(share-.5)<=.05?"EVENLY DISTRIBUTED":"TRADING PRESSURE";
 if(state==="TRADING PRESSURE"&&delta!==null&&Math.abs(delta)>=1&&Math.sign(delta)!==leader)state="MIXED SIGNALS";}
 return {version:FLOW_VERSION,state,reasons,window,since:new Date(since).toISOString(),until:new Date(now).toISOString(),coverageComplete,
   classifiedTrades:classified.length,observedTrades:valid.length,validQuantity:total,quantityUnit:units.length===1?units[0]:null,
   yesShare:state==="INSUFFICIENT DATA"?null:share,noShare:state==="INSUFFICIENT DATA"?null:no/total,
   lastTradeAt:latestTrade?new Date(latestTrade).toISOString():null,movement,
   largestTrades:[...valid].sort((a,b)=>b.quantity-a.quantity).slice(0,5),
   countLimitation:"Conservative fingerprint deduplication; identical prints may be undercounted",truncated,
   informedFlow:{state:"UNVERIFIED",score:null,reason:"Prospective baseline and economic validation pending"},
   readOnly:true,canQualify:false,canAuthorizeWager:false,modelInfluence:"none"};
}
export function simulateBuy(asks,quantity,{fairProbability=null,feeRule=null,at=Date.now(),quoteAt=null,marketState=null,quantityUnit=null}={}){
 const requested=finite(quantity),p=finite(fairProbability);
 if(!(requested>0)||!Number.isFinite(Date.parse(quoteAt))||at-Date.parse(quoteAt)>120000||at<Date.parse(quoteAt)||marketState!=="MARKET_STATE_OPEN"||quantityUnit!=="CONTRACTS")return {available:false,reason:"QUOTE_STATE_FRESHNESS_OR_UNIT_UNVERIFIED"};
 let remaining=requested,cost=0,fees=0;const fills=[];
 for(const l of [...(asks||[])].sort((a,b)=>a.price-b.price)){
 if(!(l.price>0&&l.price<1&&l.quantity>0))continue;
 const q=Math.min(remaining,l.quantity);cost+=q*l.price;remaining-=q;fills.push({price:l.price,quantity:q});
 if(remaining<=1e-9)break;
 }
 const verifiedFee=feeRule?.verified===true&&at>=Date.parse(feeRule.effectiveFrom)&&at<Date.parse(feeRule.effectiveUntil)&&finite(feeRule.coefficient)>=0;
 // Callers must supply the verified market-specific effective rule. Unknown fees never become zero.
 if(verifiedFee)for(const f of fills)fees+=Math.ceil((feeRule.coefficient*f.quantity*f.price*(1-f.price)-1e-10)*100)/100;
 const filled=requested-remaining;
 return {available:remaining<=1e-9,filled,requested,cost,averagePrice:filled?cost/filled:null,
   unfilled:remaining,fee:verifiedFee?fees:null,feeRounding:"CONSERVATIVE_CENT_CEILING_PER_FILL",
   feeVersion:verifiedFee?feeRule.version:null,
   netExpectedProfit:verifiedFee&&p>0&&p<1&&remaining<=1e-9?p*filled-cost-fees:null,
   simulated:true,canAuthorizeWager:false};
}
