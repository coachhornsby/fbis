export const NBA_QUALIFICATION_POLICY = Object.freeze({
  game: Object.freeze({
    minProbability: 0.56,
    minProbabilityEdge: 0.03,
    minExpectedValue: 0.02,
    maxEntryAgeMinutes: 180,
    requirePairedMarket: true,
    requirePreTip: true,
  }),
  prop: Object.freeze({
    minProbability: 0.58,
    minStandardizedEdge: 0.20,
    maxEntryAgeMinutes: 360,
    requireAvailabilityVerified: true,
    requirePreTip: true,
  }),
  modelPromotion: Object.freeze({
    minGradedGameCandidates: 50,
    minPositiveClvRate: 0.52,
    minRoiPct: 0,
  }),
});

export function americanProfit(price){
  const p=Number(price);
  if(!Number.isFinite(p)||p===0)return null;
  return p>0?p/100:100/Math.abs(p);
}
export function expectedValue(probability,price){
  const p=Number(probability),win=americanProfit(price);
  if(!Number.isFinite(p)||win==null)return null;
  return p*win-(1-p);
}
export function qualificationDecision({probability,marketProbability,price,paired=true,preTip=true,ageMinutes=0}={}){
  const cfg=NBA_QUALIFICATION_POLICY.game;
  const p=Number(probability),m=Number(marketProbability);
  if(!Number.isFinite(p))return {qualified:false,reason:"model_probability_missing",ev:null,edge:null};
  if(cfg.requirePairedMarket&&!paired)return {qualified:false,reason:"paired_market_required",ev:null,edge:null};
  if(cfg.requirePreTip&&!preTip)return {qualified:false,reason:"post_tip_market_rejected",ev:null,edge:null};
  if(Number.isFinite(ageMinutes)&&ageMinutes>cfg.maxEntryAgeMinutes)return {qualified:false,reason:"entry_market_stale",ev:null,edge:null};
  const edge=Number.isFinite(m)?p-m:null;
  const ev=expectedValue(p,price);
  if(p<cfg.minProbability)return {qualified:false,reason:"probability_below_threshold",ev,edge};
  if(edge==null||edge<cfg.minProbabilityEdge)return {qualified:false,reason:"market_edge_below_threshold",ev,edge};
  if(ev==null||ev<cfg.minExpectedValue)return {qualified:false,reason:"ev_below_threshold",ev,edge};
  return {qualified:true,reason:"QUALIFIED",ev,edge};
}
