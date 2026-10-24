/**
 * CFB-owned hot market quotes. This is a bounded, source-labeled READ MODEL,
 * not a second tick-history store and never a wager-execution authority.
 * The source history remains immutable in R2 / partitioned market D1.
 */
const number=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const validFamily=new Set(["moneyline","spread","total"]);
const validSide=new Set(["home","away","over","under"]);
const validProvider=new Set(["PinnOdds","Polymarket US","Kalshi"]);
const validId=v=>typeof v==="string"&&v.length>0&&v.length<=180&&/^[a-zA-Z0-9:_-]+$/.test(v);
const clock=v=>Number.isFinite(Date.parse(v||""))?new Date(v).toISOString():null;
const decimalFromAmerican=a=>a>0?1+a/100:1+100/Math.abs(a);
const americanFromDecimal=d=>d>=2?Math.round((d-1)*100):-Math.round(100/(d-1));
const money=p=>p!=null&&p>0&&p<1?p:null;
const toHex=buffer=>[...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function keyFor(parts){return "cfbm_"+toHex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(parts)))).slice(0,32);}

export function normalizeCfbMarketQuote(o,{capturedAt=null}={}){
 const source=o?.source==="Polymarket US WebSocket"?"Polymarket US":String(o?.source||"");
 if(!validProvider.has(source)||String(o?.sport||"cfb").toLowerCase()!=="cfb")return null;
 const gameId=String(o?.eventId||o?.canonical_event_id||"");
 const marketFamily=String(o?.marketFamily||o?.market_family||"").toLowerCase();
 const side=String(o?.raw?.canonicalSide||o?.side||"").toLowerCase();
 const period=String(o?.period||"full_game").toLowerCase();
 if(!validId(gameId)||!validFamily.has(marketFamily)||!validSide.has(side)||period!=="full_game")return null;
 if(marketFamily==="moneyline"&&!["home","away"].includes(side))return null;
 if(marketFamily==="spread"&&!["home","away"].includes(side))return null;
 if(marketFamily==="total"&&!["over","under"].includes(side))return null;
 const line=number(o?.line);
 if(marketFamily!=="moneyline"&&(line==null||Math.abs(line)>300))return null;
 const american=number(o?.americanOdds??o?.american_odds);
 const decimal=number(o?.decimalOdds??o?.decimal_odds)??(american!=null&&Math.abs(american)>=100?decimalFromAmerican(american):null);
 const impliedDecimal=decimal!=null&&decimal>1&&decimal<101?decimal:null;
 const rawAsk=number(o?.raw?.bestAsk);
 const contract=money(rawAsk)??money(number(o?.contractPrice??o?.contract_price));
 const priced=source==="PinnOdds"?impliedDecimal!=null:contract!=null;
 if(!priced)return null;
 const collected=clock(capturedAt||o?.capturedAt||o?.collectedAt||o?.collected_at);
 if(!collected)return null;
 const observed=clock(o?.sourceObservedAt||o?.providerObservedAt||o?.source_observed_at);
 const marketId=String(o?.sourceMarketId||o?.source_market_id||"").slice(0,220);
 const outcomeId=String(o?.sourceOutcomeId||o?.source_outcome_id||"").slice(0,220);
 return {source,gameId,marketFamily,side,line:marketFamily==="moneyline"?null:line,
   americanOdds:source==="PinnOdds"?american:contract!=null?americanFromDecimal(1/contract):null,
   decimalOdds:source==="PinnOdds"?impliedDecimal:contract!=null?1/contract:null,
   contractAsk:source==="PinnOdds"?null:contract,sourceMarketId:marketId,sourceOutcomeId:outcomeId,
   collectedAt:collected,observedAt:observed,period,
   priceBasis:source==="PinnOdds"?"SPORTSBOOK_CAPTURE_UNVERIFIED_SOURCE_CLOCK":
     source==="Kalshi"?"PUBLIC_REST_BEST_ASK_INDICATIVE":
     rawAsk!=null?"REST_OR_WS_BEST_ASK_CAPTURE":"EXCHANGE_CONTRACT_REFERENCE"};
}

export async function persistCfbMarketQuotes(env,offers,{capturedAt=null}={}){
 if(!env?.CFB_DB?.prepare)return {ok:false,reason:"CFB_DB_UNBOUND",stored:0};
 if(!Array.isArray(offers))return {ok:false,reason:"INVALID_OFFERS",stored:0};
 const normalized=offers.map(o=>normalizeCfbMarketQuote(o,{capturedAt})).filter(Boolean).slice(0,400);
 if(!normalized.length)return {ok:true,attempted:0,stored:0};
 let stored=0;
 for(let start=0;start<normalized.length;start+=40){
  const chunk=normalized.slice(start,start+40);
  const stmts=await Promise.all(chunk.map(async x=>{
   const id=await keyFor([x.source,x.gameId,x.marketFamily,x.side,x.line,x.period,x.sourceMarketId,x.sourceOutcomeId]);
   return env.CFB_DB.prepare(`INSERT INTO cfb_current_market_quotes
    (quote_key,provider,game_id,market_family,side,line,american_odds,decimal_odds,contract_ask,
     source_market_id,source_outcome_id,provider_observed_at,captured_at,price_basis,period,can_authorize_wager,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
    ON CONFLICT(quote_key) DO UPDATE SET
      american_odds=excluded.american_odds,decimal_odds=excluded.decimal_odds,
      contract_ask=excluded.contract_ask,provider_observed_at=excluded.provider_observed_at,
      captured_at=excluded.captured_at,price_basis=excluded.price_basis,updated_at=excluded.updated_at
    WHERE excluded.captured_at>=cfb_current_market_quotes.captured_at`)
    .bind(id,x.source,x.gameId,x.marketFamily,x.side,x.line,x.americanOdds,x.decimalOdds,x.contractAsk,
      x.sourceMarketId,x.sourceOutcomeId,x.observedAt,x.collectedAt,x.priceBasis,x.period,new Date().toISOString());
  }));
  const result=env.CFB_DB.batch?await env.CFB_DB.batch(stmts):await Promise.all(stmts.map(x=>x.run()));
  stored+=result.reduce((n,r)=>n+Number(r?.meta?.changes||0),0);
 }
 return {ok:true,attempted:normalized.length,stored,readOnlyWagerAuthority:true};
}
export async function readCfbMarketQuotes(env,games,{now=new Date(),maxAgeMs=45*60000}={}){
 if(!env?.CFB_DB?.prepare||!games?.length)return {byGame:new Map(),rows:0,reason:"CFB_DB_OR_GAMES_UNAVAILABLE"};
 const ids=[...new Set(games.map(g=>String(g.id||"")).filter(validId))].slice(0,120);
 const time=now instanceof Date?now.getTime():Date.parse(now);
 if(!ids.length||!Number.isFinite(time))return {byGame:new Map(),rows:0,reason:"GAME_ID_OR_CLOCK_MISSING"};
 const start=new Date(time-maxAgeMs).toISOString(),end=new Date(time).toISOString();
 const byGame=new Map();let total=0;
 for(let n=0;n<ids.length;n+=40){
  const chunk=ids.slice(n,n+40),placeholders=chunk.map(()=>"?").join(",");
  const r=await env.CFB_DB.prepare(`SELECT * FROM cfb_current_market_quotes
   WHERE game_id IN (${placeholders}) AND captured_at BETWEEN ? AND ?
   AND can_authorize_wager=0 ORDER BY captured_at DESC LIMIT 2000`).bind(...chunk,start,end).all();
  for(const row of r?.results||[]){
   const quote={source:row.provider,marketFamily:row.market_family,side:row.side,line:row.line,
    period:row.period,americanOdds:row.american_odds,decimalOdds:row.decimal_odds,
    contractPrice:row.contract_ask,sourceMarketId:row.source_market_id,
    sourceOutcomeId:row.source_outcome_id,collectedAt:row.captured_at,
    providerObservedAt:row.provider_observed_at,priceBasis:row.price_basis,
    executionEligible:false,canQualify:false,canAuthorizeWager:false};
   const entries=byGame.get(String(row.game_id))||[];
   entries.push(quote);byGame.set(String(row.game_id),entries);total++;
  }
 }
 return {byGame,rows:total,reason:total?"CFB_LIVE_MARKET_STATE":"NO_FRESH_CFB_MARKET_STATE"};
}
