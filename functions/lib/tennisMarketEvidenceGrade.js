/** Audit-only paired market grading. No live orders or authorization.
 * Quotes MUST be independently stored immutable observations; this function
 * never manufactures historical or closing quotes from later snapshots.
 */
const validTime=x=>Number.isFinite(Date.parse(x||''));
const implied=o=>Number.isFinite(o)&&o>1?1/o:null;
export function evaluateTennisMarketEvidence({forecast,event,quotes=[],winnerId,fees=0}={}){
 const blocked=[];
 const fail=reason=>({ok:false,reason,canAuthorizeWager:false});
 if(!forecast?.id||!event?.id||forecast.eventId!==event.id)return fail('EVENT_ID_MISMATCH');
 if(!['atp','wta'].includes(event.tour)||!event.player1Id||!event.player2Id||
 event.player1Id===event.player2Id)return fail('PLAYER_IDENTITY_INVALID');
 if(!validTime(forecast.createdAt)||!validTime(event.startAt)||
 Date.parse(forecast.createdAt)>=Date.parse(event.startAt))
 return fail('PREGAME_PROVENANCE_INVALID');
 const p=Number(forecast.p1);
 if(!(p>0&&p<1))return fail('PROBABILITY_INVALID');
 if(![event.player1Id,event.player2Id].includes(winnerId))return fail('OFFICIAL_RESULT_UNVERIFIED');
 if(!Number.isFinite(fees)||fees<0)return fail('FEES_INVALID');
 const acceptable=quotes.filter(q=>q.eventId===event.id&&
 ['kalshi','polymarket','pinnodds'].includes(q.venue)&&
 q.playerId===event.player1Id&&validTime(q.observedAt)&&
 Date.parse(q.observedAt)<Date.parse(event.startAt)&&
 Number.isFinite(q.decimalOdds)&&q.decimalOdds>1&&
 q.verifiedSource===true&&q.marketType==='MATCH_WINNER'&&q.executable===true);
 const ordered=acceptable.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
 // Entry quote must be observed no later than the frozen forecast timestamp.
 const entries=ordered.filter(q=>Date.parse(q.observedAt)<=Date.parse(forecast.createdAt));
 if(!entries.length)return fail('CONTEMPORANEOUS_ENTRY_QUOTE_MISSING');
 const entry=entries.at(-1);
 const closes=ordered.filter(q=>q.venue===entry.venue&&q.contractId===entry.contractId&&
 Date.parse(q.observedAt)>=Date.parse(entry.observedAt));
 const close=closes.at(-1);
 if(!close||close.observedAt===entry.observedAt)return fail('INDEPENDENT_CLOSING_QUOTE_MISSING');
 if(!entry.contractId||!close.contractId)return fail('CONTRACT_ID_MISSING');
 const entryP=implied(entry.decimalOdds),closeP=implied(close.decimalOdds);
 if(entryP==null||closeP==null)return fail('ODDS_INVALID');
 const won=Number(winnerId===event.player1Id);
 const unitReturn=won?entry.decimalOdds-1-fees:-1-fees;
 return {ok:true,forecastId:forecast.id,eventId:event.id,venue:entry.venue,
  contractId:entry.contractId,entryAt:entry.observedAt,closeAt:close.observedAt,
  entryOdds:entry.decimalOdds,closeOdds:close.decimalOdds,
  // Positive means entry probability was below closing implied probability.
  clvImpliedProbability:closeP-entryP,
  probabilityEdge:p-entryP,unitReturn,roiPerUnit:unitReturn,
  fees,source:'VERIFIED_CAPTURED_QUOTE_PAIRS',canAuthorizeWager:false};
}
