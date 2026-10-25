/** Cross-sport FBIS completeness contract. Read-only; never manufactures odds or projections. */
const positive=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const clock=v=>Date.parse(String(v||''));
const sportOf=g=>String(g?.sport||'').toLowerCase();
const projection=g=>[g?.model?.projTotal,g?.model?.projHome,g?.model?.projAway,
 g?.model?.homeScore,g?.model?.awayScore,g?.model?.spread,g?.model?.total,
 g?.projTotal,g?.projHome,g?.projAway,g?.nbaFbisV1?.total,
 g?.researchProjection?.total,g?.cfb?.projTotal,g?.tennisProjection?.winProbability,
 g?.projection?.total,g?.projection?.home].some(positive)||
 Boolean(g?.prediction?.modelVersion&&g?.prediction?.value!=null);
const market=(g,now)=>{
 const m=g?.market||{},p=g?.pinnoddsResearch||{};
 const hasLine=[m.spread,m.total,m.moneylineHome,m.moneylineAway,
 m.homeMoneyline,m.awayMoneyline,m.homeML,m.awayML,
 p.spread,p.total,p.moneyline,p.homeMoneyline,p.awayMoneyline].some(positive)||
 Boolean(p?.markets&&Object.values(p.markets).some(v=>v&&
 [v.line,v.home,v.away,v.total,v.spread].some(positive)));
 const captured=[p.collectedAt,p.capturedAt,p.asOf,p.observedAt,
 m.collectedAt,m.capturedAt,m.sourceObservedAt,m.asOf].map(clock).find(Number.isFinite);
 // No timestamp means a historical reference cannot masquerade as current.
 return hasLine&&Number.isFinite(captured)&&captured<=now&&now-captured<=6*3600000;
};
export function assessFbisCoverage({board={},models={},contracts={},now=Date.now(),horizonHours=36}={}){
 const games=Array.isArray(board.games)?board.games:[];
 const incidents=[],summary={games:0,missingGameMarkets:0,missingGameProjections:0,
  props:0,missingPropProjections:0,missingPropPrices:0};
 const inWindow=g=>{const t=clock(g.start||g.start_time||g.dateTime);
  return Number.isFinite(t)&&t>now&&t<=now+horizonHours*3600000;};
 for(const g of games.filter(inWindow)){
  summary.games++;const sport=sportOf(g),id=String(g.id||g.gameId||'');
  if(!projection(g)){summary.missingGameProjections++;incidents.push({code:'GAME_PROJECTION_MISSING',sport,eventId:id});}
  if(!market(g,now)){summary.missingGameMarkets++;incidents.push({code:'GAME_CURRENT_MARKET_UNVERIFIED',sport,eventId:id});}
 }
 const sports=Object.keys(models);
 for(const sport of sports){
  const result=models[sport],lines=contracts[sport];
  if(!result?.ok){incidents.push({code:'PROP_MODEL_API_FAILED',sport});continue;}
  if(!lines?.ok){incidents.push({code:'PROP_EXCHANGE_API_FAILED',sport});continue;}
  const modelKeys=new Set((result.rows||[]).filter(r=>r.independent===true&&positive(r.fbis_projection))
   .map(r=>[r.canonicalEventId,r.canonicalPlayerId,r.canonical_market,r.period].join('|')));
  const offerings=(lines.rows||[]).filter(r=>r.identityVerified===true&&inWindow(r)&&r.contractId);
  const seen=new Set();
  for(const r of offerings){
   const key=[r.provider,r.contractId,r.side].join('|');if(seen.has(key))continue;seen.add(key);
   summary.props++;
   const identity=[r.canonicalEventId,r.canonicalPlayerId,r.canonical_market,r.period].join('|');
   if(!modelKeys.has(identity)){summary.missingPropProjections++;incidents.push({code:'PROP_PROJECTION_MISSING',sport,eventId:r.canonicalEventId,playerId:r.canonicalPlayerId,stat:r.canonical_market,provider:r.provider});}
   const sourceTime=clock(r.observedAt||r.sourceObservedAt);
   const captured=clock(r.collectedAt);
   const quoteTime=Number.isFinite(sourceTime)?sourceTime:captured;
   // Captured Gamma display probabilities and unverified Kalshi quotes are not
   // authenticated current executable prices. Record the gap; never relabel.
   if(r.priceVerified!==true||r.marketAvailable!==true||!Number.isFinite(quoteTime)||quoteTime>now||now-quoteTime>15*60000){
    summary.missingPropPrices++;incidents.push({code:'PROP_CURRENT_ODDS_UNVERIFIED',sport,eventId:r.canonicalEventId,playerId:r.canonicalPlayerId,stat:r.canonical_market,provider:r.provider});
   }
  }
 }
 return {ok:incidents.length===0,asOf:new Date(now).toISOString(),horizonHours,summary,incidents,
  canAuthorizeWager:false,canChangeModels:false,canFabricateMarketData:false};
}
