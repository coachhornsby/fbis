import { finitePropNumber as n } from './exchangePlayerProps.js';
/** Fee-adjusted payout arithmetic only after exact contract-specific calibration and cost verification. */
export function evaluatePropEconomics(contract={},model={},fees={}) {
 const reasons=[],p=n(model.probability),ask=n(contract.purchaseAsk),fee=n(fees.perContract);
 const identity=['canonicalEventId','canonicalPlayerId','canonical_market','period','line','side'];
 if(!contract.identityVerified||!identity.every(k=>contract[k]!=null&&contract[k]===model[k])||contract.settlementTerms!==model.settlementTerms)reasons.push('EXACT_MODEL_CONTRACT_SCOPE_REQUIRED');
 if(model.calibrated!==true||!model.modelVersion||p==null||p<0||p>1)reasons.push('CALIBRATED_PROBABILITY_REQUIRED');
 if(!contract.fresh||!contract.priceVerified||ask==null||ask<=0||ask>=1)reasons.push('CURRENT_PURCHASE_ASK_REQUIRED');
 if(fees.verified!==true||fee==null||fee<0)reasons.push('VERIFIED_FEES_REQUIRED');
 if(reasons.length)return {supported:false,reasons,expectedProfitPerContract:null,expectedReturn:null,canAuthorizeWager:false};
 const cost=ask+fee;
 return {supported:true,cost,probabilityAdvantage:p-ask,expectedProfitPerContract:p-cost,expectedReturn:(p-cost)/cost,reasons:[],canAuthorizeWager:false};
}
export function equivalentPropContracts(a,b) {
 const fields=['canonicalEventId','canonicalPlayerId','canonical_market','period','line','statSide','settlementScope','dnpSettlement'];
 return a.identityVerified===true&&b.identityVerified===true&&fields.every(k=>a[k]!=null&&a[k]===b[k])&&a.settlementTerms===b.settlementTerms;
}
