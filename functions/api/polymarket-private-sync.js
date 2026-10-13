import {authorizeHarvest} from "../lib/auth.js";
import {signedPolymarketUsAccountGetHeaders} from "../lib/polymarketUsSignedWs.js";

const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"private, no-store","x-robots-tag":"noindex"}});
const num=v=>{const n=Number(v?.value??v);return Number.isFinite(n)?n:null};
const text=v=>v==null?null:String(v).slice(0,240);
async function hash(v){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(v)));
  return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function signedGet(path,env,{cursor=null,limit=100,fetchImpl=fetch}={}){
  const headers=await signedPolymarketUsAccountGetHeaders({
    keyId:env.POLYMARKET_US_KEY_ID,secretKey:env.POLYMARKET_US_SECRET_KEY,path
  });
  const url=new URL(path,"https://api.polymarket.us");
  if(path!=="/v1/account/balances"){
    url.searchParams.set("limit",String(limit));
    if(cursor)url.searchParams.set("cursor",cursor);
  }
  const r=await fetchImpl(url.toString(),{method:"GET",headers,signal:AbortSignal.timeout(18000)});
  if(!r.ok)return {ok:false,status:r.status}; // never return provider raw error/PII
  const body=await r.json();
  return {ok:true,status:r.status,body};
}
async function getPages(path,key,env,{maxPages=4,fetchImpl=fetch}={}){
  const seen=new Set(),items=[];
  let eof=false, pages=0, cursor=null;
  while(pages<maxPages){
    const r=await signedGet(path,env,{cursor,fetchImpl});
    if(!r.ok)return {ok:false,status:r.status,items:[],pages};
    const body=r.body;
    const values=key==="positions"?
      Object.entries(body?.positions||{}).map(([slug,pos])=>({slug,pos})):
      Array.isArray(body?.activities)?body.activities:[];
    if(key==="positions"&&(body?.positions==null||typeof body.positions!=="object"))return{ok:false,status:502,items:[],pages,reason:"contract-changed"};
    if(key==="activities"&&!Array.isArray(body?.activities))return{ok:false,status:502,items:[],pages,reason:"contract-changed"};
    items.push(...values);pages++;
    if(body.eof===true){eof=true;break}
    cursor=body.nextCursor;
    if(!cursor||seen.has(cursor))break;
    seen.add(cursor);
  }
  return {ok:true,items,pages,complete:eof};
}
function sanitizedActivity(a){
  if(!a||typeof a!=="object")return null;
  // Ignore funding/bank records entirely: never store destination accounts.
  if(a.type!=="ACTIVITY_TYPE_TRADE"&&a.type!=="ACTIVITY_TYPE_POSITION_RESOLUTION")return null;
  const t=a.trade||{},p=a.positionResolution||{};
  const market=text(t.marketSlug||p.marketSlug);
  const id=text(t.id||p.tradeId);
  if(!market||!id)return null;
  const isTrade=a.type==="ACTIVITY_TYPE_TRADE";
  return {key:id,type:a.type,market,at:text(t.updateTime||t.createTime||p.updateTime),
    price:isTrade?num(t.price):null,quantity:isTrade?text(t.qtyDecimal||t.qty):null,
    cost:isTrade?num(t.costBasis):null,realized:isTrade?num(t.realizedPnl):num(p.afterPosition?.realized),
    state:isTrade?text(t.state):text(p.side)};
}
function sanitizedPosition(item){
  const p=item?.pos||{};const slug=text(item.slug);
  if(!slug)return null;
  return {slug,quantity:text(p.netPositionDecimal||p.netPosition),cost:num(p.cost),
    realized:num(p.realized),cashValue:num(p.cashValue),expired:p.expired===true?1:0};
}
export async function syncPolymarketUsPrivate(db,env,{fetchImpl=fetch,now=new Date(),maxPages=4}={}){
  if(!db?.prepare)return{ok:false,reason:"database-unavailable"};
  if(!env?.POLYMARKET_US_KEY_ID||!env?.POLYMARKET_US_SECRET_KEY)return{ok:false,reason:"credentials-not-configured"};
  const at=now.toISOString(),runId="pm_sync_"+at.replace(/[^0-9]/g,"");
  const [positions,activities,balances]=await Promise.all([
    getPages("/v1/portfolio/positions","positions",env,{maxPages,fetchImpl}),
    getPages("/v1/portfolio/activities","activities",env,{maxPages,fetchImpl}),
    signedGet("/v1/account/balances",env,{fetchImpl})
  ]);
  // Fail-closed: never persist partial data under a "complete" status.
  if(!positions.ok||!activities.ok||!balances.ok)return{
    ok:false,reason:"private-provider-request-failed",
    statuses:{positions:positions.status,activities:activities.status,balances:balances.status},
    readOnly:true,canAuthorizeWager:false
  };
  if(!Array.isArray(balances.body?.balances))return{ok:false,reason:"balance-contract-changed",readOnly:true};
  let insertedActivities=0,insertedPositions=0;
  const sanitizedA=activities.items.map(sanitizedActivity).filter(Boolean);
  const sanitizedP=positions.items.map(sanitizedPosition).filter(Boolean);
  for(const a of sanitizedA){
    const id="pmact_"+(await hash([a.type,a.key,a.market].join("|"))).slice(0,32);
    const r=await db.prepare(`INSERT OR IGNORE INTO polymarket_us_private_activity
      (id,activity_type,source_trade_id,market_slug,recorded_at,observed_at,price_usd,quantity,cost_basis_usd,realized_pnl_usd,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,a.type,a.key,a.market,a.at,at,a.price,a.quantity,a.cost,a.realized,a.state).run();
    insertedActivities+=r.meta?.changes||0;
  }
  for(const p of sanitizedP){
    const id="pmpos_"+(await hash([p.slug,at].join("|"))).slice(0,32);
    const r=await db.prepare(`INSERT OR IGNORE INTO polymarket_us_private_positions
      (id,market_slug,net_quantity,cost_basis_usd,realized_pnl_usd,cash_value_usd,expired,observed_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .bind(id,p.slug,p.quantity,p.cost,p.realized,p.cashValue,p.expired,at).run();
    insertedPositions+=r.meta?.changes||0;
  }
  const complete=Boolean(positions.complete&&activities.complete);
  await db.prepare(`INSERT OR IGNORE INTO polymarket_us_private_sync_runs
    (id,captured_at,positions_count,activities_count,positions_complete,activities_complete,http_status,status)
    VALUES (?,?,?,?,?,?,200,?)`)
    .bind(runId,at,sanitizedP.length,sanitizedA.length,positions.complete?1:0,activities.complete?1:0,
      complete?"COMPLETE":"BOUNDED_PARTIAL").run();
  return {ok:true,source:"Polymarket US private account",readOnly:true,
    tradingEnabled:false,canQualify:false,canAuthorizeWager:false,
    at,positionsCount:sanitizedP.length,activityCount:sanitizedA.length,
    insertedPositions,insertedActivities,
    positionsComplete:positions.complete,activitiesComplete:activities.complete,
    pages:{positions:positions.pages,activities:activities.pages},
    balanceEndpointVerified:true,balanceCurrencies:balances.body.balances.map(b=>String(b.currency||"")).filter(Boolean).slice(0,5),
    bankDetailsPersisted:false,bankDetailsReturned:false,automaticWagerGrading:false};
}
/** Must carry explicit server-side HARVEST_SECRET or STRATEGY_IMPORT_SECRET in HEADER.
 * Never expose private positions via GET or user-facing game endpoints. */
export async function onRequestPost({request,env}){
  if(!authorizeHarvest(request,env).ok)return json({ok:false,reason:"unauthorized"},403);
  try{
    const result=await syncPolymarketUsPrivate(env.DB,env);
    return json(result,result.ok?200:502);
  }catch{return json({ok:false,reason:"private-sync-internal-error"},502)}
}
export async function onRequestGet(){return json({ok:false,reason:"method-not-allowed"},405)}
