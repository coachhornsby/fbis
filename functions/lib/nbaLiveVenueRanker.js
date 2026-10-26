// Rank current NBA wager alternatives; NO closing-price prerequisite.
// Caller must supply independent model probabilities and verified actionable quotes.
const num=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const allowed=new Set(["Pinnacle","Kalshi","Polymarket"]);
export function nbaNetWagerCandidates({offers=[],now=new Date().toISOString(),maxAgeMinutes=15,minNetEv=0.02}={}){
 const time=Date.parse(now);
 if(!Number.isFinite(time))throw Error("INVALID_DECISION_CLOCK");
 const ranked=[],excluded=[];
 for(const offer of offers){
  const venue=offer.venue,market=String(offer.market||"").toLowerCase();
  const prob=num(offer.modelProbability),decimal=num(offer.decimalOdds),american=num(offer.americanOdds);
  const yesPrice=num(offer.yesPrice),fee=num(offer.feePerUnit),cost=num(offer.otherCostPerUnit);
  const observed=Date.parse(offer.capturedAt||""),tipoff=Date.parse(offer.tipoff||"");
  const reasons=[];
  if(!allowed.has(venue))reasons.push("UNSUPPORTED_VENUE");
  if(!["ml","spread","total"].includes(market))reasons.push("UNSUPPORTED_MARKET");
  if(!offer.outcome||!offer.gameId)reasons.push("IDENTITY_MISSING");
  if(!offer.settlementEquivalent)reasons.push("SETTLEMENT_NOT_MATCHED");
  if(offer.quoteVerified!==true||offer.actionable!==true)reasons.push("UNVERIFIED_OR_NONACTIONABLE_QUOTE");
  if(!Number.isFinite(observed)||!Number.isFinite(tipoff)||observed>=tipoff||time>=tipoff||observed>time||
   (time-observed)/60000>maxAgeMinutes)reasons.push("QUOTE_NOT_FRESH_PREGAME");
  if(prob===null||prob<=0||prob>=1||offer.modelQualified!==true)reasons.push("MODEL_NOT_QUALIFIED");
  if(fee===null||fee<0||cost===null||cost<0)reasons.push("EXECUTION_COSTS_UNVERIFIED");
  if((market==="spread"||market==="total")&&num(offer.line)===null)reasons.push("LINE_MISSING");
  let winProfit=null,loseAmount=1;
  if(venue==="Pinnacle"){
   if(decimal!==null&&decimal>1)winProfit=decimal-1;
   else if(american!==null&&american!==0)winProfit=american>0?american/100:100/Math.abs(american);
   else reasons.push("PRICE_UNAVAILABLE");
  }else{
   if(yesPrice===null||yesPrice<=0||yesPrice>=1)reasons.push("INVALID_CONTRACT_PRICE");
   else {winProfit=(1-yesPrice)/yesPrice;loseAmount=1;}
   if(offer.isYesContract!==true)reasons.push("NON_YES_CONTRACT_NOT_NORMALIZED");
  }
  const netEV=reasons.length===0?prob*(winProfit-fee-cost)-(1-prob)*(loseAmount+fee+cost):null;
  const row={gameId:offer.gameId,venue,market,outcome:offer.outcome,line:num(offer.line),
   modelProbability:prob,netEvPerUnit:netEV,quoteAt:offer.capturedAt,
   feePerUnit:fee,otherCostPerUnit:cost,decision:"NO_WAGER"};
  if(reasons.length){excluded.push({...row,reasons});continue}
  row.decision=netEV>=minNetEv?"CANDIDATE":"BELOW_THRESHOLD";
  ranked.push(row);
 }
 ranked.sort((a,b)=>b.netEvPerUnit-a.netEvPerUnit);
 return {generatedAt:now,ranked,excluded,best:ranked.find(x=>x.decision==="CANDIDATE")||null,
  // Correlated combined wagers require their OWN offered payout and JOINT probability.
  combinationsEnabled:false,closingPriceRequired:false,canAuthorizeWager:false};
}
