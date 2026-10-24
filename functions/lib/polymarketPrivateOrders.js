/**
 * Polymarket US PRIVATE order-update executions, not public market trades.
 * A confirmed per-fill execution can reconcile the matching REST tradeId.
 * This module cannot place orders, infer positions, or produce prices.
 */
const number=v=>{
 if(v==null||v==="")return null;
 if(typeof v==="object"){
   if(v.currency!=null&&String(v.currency).toUpperCase()!=="USD")return null;
   v=v.value;
 }
 const n=Number(v);return Number.isFinite(n)?n:null;
};
const ident=v=>typeof v==="string"&&/^[a-zA-Z0-9-]{1,220}$/.test(v)?v:null;
const iso=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const price=v=>{const n=number(v);return n!=null&&n>0&&n<1?n:null;};
const quantity=v=>{const n=number(v);return n!=null&&n>0&&n<10000000?n:null;};
export function privateOrderExecution(envelope){
 const exec=envelope?.orderSubscriptionUpdate?.execution||
   envelope?.order_subscription_update?.execution||null;
 if(!exec||exec.type!=="EXECUTION_TYPE_FILL")return null;
 const o=exec.order||{},intent=String(o.intent||"").toUpperCase();
 // Complete SELL fills are recorded for account reconciliation, never as new bets.
 // Sell activity forces related positions into review instead of pretending OPEN.
 // A single verified, fully filled order is safe for the current sheet ledger.
 // Multi-fill and open/partially-filled orders require a separate cumulative
 // reconciliation design, not a premature full-order P/L claim.
 const filled=quantity(exec.lastShares),cum=quantity(o.cumQuantity);
 const leaves=number(o.leavesQuantity);
 const ordered=quantity(o.quantity);
 if(o.state!=="ORDER_STATE_FILLED"||filled==null||cum==null||ordered==null||
   Math.abs(filled-cum)>0.000001||Math.abs(cum-ordered)>0.000001||
   leaves!==0)return null;

 const intentSide={"ORDER_INTENT_BUY_LONG":"YES","ORDER_INTENT_BUY_SHORT":"NO"}[intent]||null;
 const declared={"OUTCOME_SIDE_YES":"YES","OUTCOME_SIDE_NO":"NO"}[String(o.outcomeSide||"").toUpperCase()]||null;
 const sellSide={"ORDER_INTENT_SELL_LONG":"YES","ORDER_INTENT_SELL_SHORT":"NO"}[intent]||null;
 const outcome=intentSide||sellSide,action=intentSide?"BUY":sellSide?"SELL":null;
 // Outright contradictions require a manual investigation.
 if(declared&&outcome&&declared!==outcome)return null;
 if(!outcome||!action)return null;
 if(o.side&&o.side!=="ORDER_SIDE_"+action)return null;
 const record={
   provider:"Polymarket US",fillId:ident(exec.tradeId),
   groupId:ident(o.id),market:ident(o.marketSlug),
   side:declared||outcome,action,
   quantity:quantity(exec.lastShares),price:price(exec.lastPx),
   fee:exec.commissionNotionalCollected==null?null:number(exec.commissionNotionalCollected),
   at:iso(exec.transactTime),marketLabel:String(o.marketMetadata?.title||o.marketSlug||"").slice(0,220)
 };
 if(!record.fillId||!record.groupId||!record.market||!record.at||
   record.quantity==null||record.price==null||
   (record.fee!=null&&(record.fee<0||record.fee>record.quantity)))return null;
 return record;
}
/** Immutable identity checks before enhancing an existing REST trade. */
export function canEnhanceRestFill(prior,e){
 if(!prior||!e||prior.provider!=="Polymarket US"||e.provider!=="Polymarket US"||
  prior.fill_id!==e.fillId||prior.market!==e.market)return false;
 const qty=number(prior.quantity),px=number(prior.unit_price);
 if(qty==null||Math.abs(qty-e.quantity)>0.000001)return false;
 if(px!=null&&Math.abs(px-e.price)>0.000001)return false;
 if(prior.side!=="UNKNOWN"&&prior.side!==e.side)return false;
 if(prior.action!=="UNKNOWN"&&prior.action!==e.action)return false;
 // Once linked, never change the confirmed order identity or fee.
 if(prior.group_id!==prior.fill_id&&prior.group_id!==e.groupId)return false;
 if(prior.fee_usd!=null&&e.fee!=null&&Math.abs(Number(prior.fee_usd)-e.fee)>0.000001)return false;
 return true;
}
/** One canonical owner writes the same ledger used by REST and Google Sheets.
 * Never expose this function to public HTTP, clients or unauthenticated routes.
 */
export async function persistPrivateExecution(db,e){
 if(!db?.prepare||!e)return {saved:false,reason:"invalid"};
 const prior=await db.prepare("SELECT * FROM exchange_bet_fills WHERE provider='Polymarket US' AND fill_id=?")
    .bind(e.fillId).first();
 if(prior){
  if(!canEnhanceRestFill(prior,e))return {saved:false,reason:"identity-conflict"};
  const update=await db.prepare(`UPDATE exchange_bet_fills
   SET group_id=?,side=?,action=?,unit_price=COALESCE(unit_price,?),
       fee_usd=COALESCE(fee_usd,?),market_label=COALESCE(NULLIF(market_label,''),?)
   WHERE provider='Polymarket US' AND fill_id=? AND market=? AND quantity=?`)
   .bind(e.groupId,e.side,e.action,e.price,e.fee,e.marketLabel,e.fillId,e.market,e.quantity).run();
  return {saved:Number(update.meta?.changes||0)>0,reason:"enriched"};
 }
 const inserted=await db.prepare(`INSERT OR IGNORE INTO exchange_bet_fills
 (provider,fill_id,group_id,market,side,action,quantity,unit_price,fee_usd,occurred_at,market_label)
 VALUES ('Polymarket US',?,?,?,?,?,?,?,?,?,?)`)
 .bind(e.fillId,e.groupId,e.market,e.side,e.action,e.quantity,e.price,e.fee,e.at,e.marketLabel).run();
 return {saved:Number(inserted.meta?.changes||0)>0,reason:"inserted"};
}
