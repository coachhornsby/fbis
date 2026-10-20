/**
 * Read-only Kalshi fill reconciliation. No journal/database writes.
 * A provider fill is not automatically one wager: orders can produce multiple
 * partial fills; settlements and deposits require separate accounting.
 */
export function auditKalshiFillReconciliation(fills=[],trackedBets=null) {
 const journalCompared=Array.isArray(trackedBets);
 const unique=new Map(),invalid=[];
 for(const f of Array.isArray(fills)?fills:[]){
  const id=typeof f?.id==="string"?f.id.trim():"";
  const ticker=typeof f?.ticker==="string"?f.ticker.trim():"";
  if(!id||!ticker){invalid.push("MISSING_EXCHANGE_ID");continue;}
  const key="kalshi|"+id;
  if(!unique.has(key))unique.set(key,{id,ticker,at:f.filledAt||null,
    side:f.side||null,action:f.action||null});
 }
 const verified=new Set((Array.isArray(trackedBets)?trackedBets:[])
  .filter(b=>b && String(b.exchange||b.provider||"").toLowerCase()==="kalshi"
    && typeof b.exchangeFillId==="string" && b.exchangeFillId.length>0)
  .map(b=>"kalshi|"+b.exchangeFillId));
 const recognized=[...unique.entries()].filter(([key])=>verified.has(key)).length;
 return {
  source:"KALSHI_PRIVATE_FILLS_ONLY",readOnly:true,
  recentUniqueFills:unique.size,invalidFillRows:invalid.length,
  reconciledByExactFillId:journalCompared?recognized:null,
  notMatchedToFbisBets:journalCompared?unique.size-recognized:null,
  journalCompared,
  journalComparisonStatus:journalCompared?"EXACT_FILL_ID_COMPARISON_ONLY":"JOURNAL_NOT_LOADED",
  matchRule:"EXACT_EXCHANGE_FILL_ID_AND_VENUE_ONLY",
  fillHistoryComplete:false,
  // No bankroll/performance math from partial fills, unmatched trades, or cash changes.
  verifiedLifetimeProfit:false,verifiedWinRate:false,
  ledgerWrites:0,canSettleBets:false,canQualify:false,
  blockers:["FULL_FILL_HISTORY_NOT_VERIFIED","EXACT_JOURNAL_CROSSWALK_REQUIRED",
    "FEES_AND_SETTLEMENT_REQUIRED","FUNDING_RECONCILIATION_REQUIRED"],
 };
}
