import {kalshiPaged} from "./kalshiAccount.js";
import {polymarketAccountPages} from "./polymarketUsAccount.js";

/** Each account event is identity-stable. Unpriced/incomplete records stay out of approved tickets. */
const safe=(v,n=220)=>v==null?"":String(v).slice(0,n);
const num=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const stamp=v=>v&&Number.isFinite(Date.parse(String(v)))?new Date(v).toISOString():null;
const isoSeconds=v=>{const n=num(v);return n==null?null:stamp(new Date(n>1e12?n:n*1000).toISOString())};
const round=v=>Math.round((v+Number.EPSILON)*10000)/10000;
export function kalshiExecution(f) {
  if(!f||!f.fill_id||!(f.ticker||f.market_ticker))return null;
  const side=safe(f.side||f.outcome_side,8).toUpperCase();
  const action=safe(f.action,8).toUpperCase();
  const qty=num(f.count_fp??f.count);
  const yes=num(f.yes_price_dollars??(f.yes_price==null?null:Number(f.yes_price)/100));
  const no=num(f.no_price_dollars??(f.no_price==null?null:Number(f.no_price)/100));
  const price=side==="YES"?yes:side==="NO"?(no??(yes==null?null:1-yes)):null;
  return {provider:"Kalshi",fillId:safe(f.fill_id),groupId:safe(f.order_id||f.fill_id),
    market:safe(f.ticker||f.market_ticker),marketLabel:safe(f.ticker||f.market_ticker),
    side:["YES","NO"].includes(side)?side:"UNKNOWN",action:["BUY","SELL"].includes(action)?action:"UNKNOWN",
    quantity:qty>0?qty:null,price:price!=null&&price>0&&price<1?price:null,
    fee:num(f.fee_cost??f.fee_cost_dollars),
    at:stamp(f.created_time)||isoSeconds(f.ts)};
}
export function polymarketExecution(row){
  if(row?.type!=="ACTIVITY_TYPE_TRADE"||!row.trade)return null;
  const t=row.trade,market=safe(t.marketSlug),id=safe(t.id);
  if(!id||!market)return null;
  const side=safe(t.outcomeSide||t.side||t.contractSide,10).toUpperCase();
  const action=safe(t.intent||t.action,12).toUpperCase();
  const status=safe(t.state,60).toUpperCase();
  // An explicitly unconfirmed/pending/cancelled activity must not be a wager.
  if(/PENDING|CANCEL|REJECT|FAILED|CREATED|UNFILLED/.test(status))return null;
  const qty=num(t.qtyDecimal??t.qty),price=num(t.price);
  const group=safe(t.orderId||t.orderID||t.id);
  return {provider:"Polymarket US",fillId:id,groupId:group,market,marketLabel:safe(t.marketMetadata?.title||market),
    side:["YES","NO"].includes(side)?side:"UNKNOWN",
    action:["BUY","SELL"].includes(action)?action:"UNKNOWN",
    quantity:qty>0?qty:null,price:price!=null&&price>0&&price<1?price:null,
    fee:num(t.feeAmount??t.fee??t.fees),at:stamp(t.createTime||t.updateTime)};
}
export function ticketFromGroup(group){
  const xs=group.filter(e=>e.action==="BUY"),first=xs[0];
  if(!first||xs.some(x=>x.side!==first.side||x.market!==first.market||x.provider!==first.provider))return null;
  if(xs.some(x=>x.side==="UNKNOWN"||x.quantity==null||x.price==null||!x.at||x.fee==null||x.fee<0))return null;
  const contracts=xs.reduce((n,x)=>n+x.quantity,0);
  const stake=xs.reduce((n,x)=>n+x.quantity*x.price+x.fee,0);
  if(!(contracts>0&&stake>0))return null;
  const unit=xs.reduce((n,x)=>n+x.quantity*x.price,0)/contracts;
  const id=(first.provider==="Kalshi"?"KALSHI:":"PMUS:")+first.groupId+":"+first.side;
  return {id,provider:first.provider,market:first.market,marketLabel:first.marketLabel||first.market,
    side:first.side,contracts:round(contracts),risk:round(stake),toWin:round(contracts-stake),
    fee:round(xs.reduce((n,x)=>n+x.fee,0)),unitPrice:round(unit),
    executedAt:xs.map(x=>x.at).sort()[0],fillCount:xs.length,status:"OPEN",
    settlementSource:null,profit:null};
}
export function groupExecutions(events){
  const groups=new Map();
  for(const e of events){
    if(e.action!=="BUY")continue;
    const key=[e.provider,e.groupId,e.market,e.side].join("|");
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(e);
  }
  return [...groups.values()].map(ticketFromGroup).filter(Boolean);
}
const dbEvent=r=>({provider:r.provider,fillId:r.fill_id,groupId:r.group_id,market:r.market,marketLabel:r.market_label,
  side:r.side,action:r.action,quantity:num(r.quantity),price:num(r.unit_price),fee:num(r.fee_usd),at:r.occurred_at});
export async function readExchangeTickets(db){
  const records=await db.prepare("SELECT * FROM exchange_bet_fills ORDER BY occurred_at DESC LIMIT 3001").all();
  if((records.results||[]).length>3000)throw new Error("EXCHANGE_HISTORY_LIMIT_REQUIRES_PAGINATION");
  const events=(records.results||[]).map(dbEvent);
  const tickets=groupExecutions(events);
  const settle=(await db.prepare("SELECT * FROM exchange_bet_settlements").all()).results||[];
  const sales=new Set(events.filter(e=>e.action==="SELL").map(e=>e.provider+"|"+e.market));
  for(const s of settle){
    if(s.provider!=="Kalshi"||!["YES","NO"].includes(s.outcome)||sales.has(s.provider+"|"+s.market))continue;
    const matching=tickets.filter(t=>t.provider===s.provider&&t.market===s.market);
    // A settlement covers a whole market position, not an individual fill/order.
    // Do not double-grade when multiple entry orders share one position.
    if(matching.length!==1)continue;
    const t=matching[0],settledQty=num(t.side==="YES"?s.yes_contracts:s.no_contracts);
    if(settledQty==null||Math.abs(t.contracts-settledQty)>0.00001)continue;
    t.status=s.outcome===t.side?"WON":"LOST";
    t.profit=round((t.status==="WON"?t.contracts:0)-t.risk);
    t.settledAt=s.settled_at;t.settlementSource="KALSHI_SETTLEMENT";
  }
  // Unknown or incomplete provider fields stay in the journal for reconciliation;
  // never invent a side, risk amount, result, or player identity.
  return {tickets,unresolved:events.filter(e=>e.side==="UNKNOWN"||e.action==="UNKNOWN"||e.price==null||e.quantity==null).length,
    observedFills:events.length};
}
export async function syncExchangeEvents(env,{now=new Date().toISOString()}={}){
  if(!env?.DB?.prepare)return {ok:false,reason:"D1_UNBOUND"};
  const providers={},events=[],settlements=[];
  if(env.KALSHI_API_KEY_ID&&(env.KALSHI_PRIVATE_KEY_PEM1||env.KALSHI_PRIVATE_KEY_PEM)){
    const [fills,settles]=await Promise.all([
      kalshiPaged("fills","fills",env,{maxPages:8}),
      kalshiPaged("settlements","settlements",env,{maxPages:8})
    ]);
    providers.kalshi={ok:fills.ok,complete:fills.complete===true,settlementsOk:settles.ok===true,
      reason:fills.ok?null:fills.code};
    if(fills.ok) events.push(...fills.items.map(kalshiExecution).filter(Boolean));
    if(settles.ok)for(const x of settles.items){
      const market=safe(x.ticker),outcome=safe(x.market_result,10).toUpperCase(),at=stamp(x.settled_time);
      if(market&&["YES","NO","VOID"].includes(outcome)&&at)settlements.push({provider:"Kalshi",
        market,outcome,yes:num(x.yes_count_fp),no:num(x.no_count_fp),at});
    }
  }else providers.kalshi={ok:false,reason:"NOT_CONFIGURED"};
  if(env.POLYMARKET_US_KEY_ID&&env.POLYMARKET_US_SECRET_KEY){
    const acts=await polymarketAccountPages("activities",env,{maxPages:8});
    providers.polymarket={ok:acts.ok,complete:acts.complete===true,reason:acts.ok?null:acts.code};
    if(acts.ok)events.push(...acts.rows.map(polymarketExecution).filter(Boolean));
  }else providers.polymarket={ok:false,reason:"NOT_CONFIGURED"};
  let inserted=0,conflicts=0;
  for(const e of events){
    const prior=await env.DB.prepare("SELECT * FROM exchange_bet_fills WHERE provider=? AND fill_id=?").bind(e.provider,e.fillId).first();
    if(prior){
      if(prior.market!==e.market||prior.group_id!==e.groupId||prior.side!==e.side||prior.action!==e.action||
        (prior.quantity!=null&&e.quantity!=null&&Math.abs(Number(prior.quantity)-e.quantity)>0.000001))conflicts++;
      continue;
    }
    const r=await env.DB.prepare(`INSERT OR IGNORE INTO exchange_bet_fills
      (provider,fill_id,group_id,market,side,action,quantity,unit_price,fee_usd,occurred_at,market_label)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(e.provider,e.fillId,e.groupId,e.market,e.side,e.action,e.quantity,e.price,e.fee,e.at,e.marketLabel).run();
    inserted+=r.meta?.changes||0;
  }
  for(const s of settlements)await env.DB.prepare(`INSERT OR IGNORE INTO exchange_bet_settlements
    (provider,market,outcome,yes_contracts,no_contracts,settled_at) VALUES (?,?,?,?,?,?)`)
    .bind(s.provider,s.market,s.outcome,s.yes,s.no,s.at).run();
  return {ok:Object.values(providers).some(x=>x.ok),providers,observed:events.length,inserted,conflicts,
    at:now,readOnly:true,tradingEnabled:false};
}
