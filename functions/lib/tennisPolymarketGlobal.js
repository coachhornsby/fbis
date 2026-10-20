/**
 * Polymarket INTERNATIONAL Gamma discovery (not Polymarket US).
 * Research-only, bounded read: markets never supply fixture identities,
 * predictions, quote source clocks, executable prices, or betting permission.
 */
const API="https://gamma-api.polymarket.com";
const normalize=s=>" "+String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()+" ";
const matchesName=(str,name)=>normalize(str).includes(normalize(name));
const decode=v=>{try{return Array.isArray(v)?v:JSON.parse(v)}catch{return []}};
let cache={until:0,events:[],code:"NOT_FETCHED"};
export async function discoverPolymarketGlobalTennis({fetchImpl=fetch,now=new Date(),pages=5}={}){
 if(fetchImpl===fetch&&Date.now()<cache.until)return cache;
 const events=[],seen=new Set();let code="OK",page=0;
 for(;page<Math.min(8,Math.max(1,pages));page++){
  const u=new URL(API+"/events");
  u.searchParams.set("active","true");u.searchParams.set("closed","false");
  u.searchParams.set("limit","100");u.searchParams.set("offset",String(page*100));
  u.searchParams.set("order","id");u.searchParams.set("ascending","false");
  let response;
  try{response=await fetchImpl(u.toString(),{headers:{accept:"application/json"},signal:AbortSignal.timeout(4500),redirect:"error"});}
  catch{code="GAMMA_FETCH_FAILED";break}
  if(!response.ok){code="GAMMA_HTTP_"+response.status;break}
  let rows;try{rows=await response.json()}catch{code="GAMMA_SCHEMA_INVALID";break}
  if(!Array.isArray(rows)){code="GAMMA_SCHEMA_INVALID";break}
  for(const event of rows){
   const slug=String(event?.slug||"");
   if(!/^(atp|wta)-|tennis|marozsan|skatov/i.test([slug,event?.title].join(" ")))continue;
   if(seen.has(String(event.id)))continue;
   seen.add(String(event.id));events.push(event);
  }
  if(rows.length<100)break;
 }
 const result={events,code,source:"POLYMARKET_GLOBAL_GAMMA",pagesFetched:page+1,
  sampledOnly:true,canQualify:false,canAuthorizeWager:false,asOf:now.toISOString()};
 if(fetchImpl===fetch)cache={...result,until:Date.now()+5*60000};
 return result;
}
export function matchPolymarketGlobalTennis(fixture,events=[],{now=new Date(),asOf=now.toISOString()}={}){
 const players=[fixture?.away_name,fixture?.home_name];
 const start=Date.parse(fixture?.start||"");
 if(!Number.isFinite(start)||players.some(n=>String(n||"").trim().split(/\s+/).length<2))return [];
 const tour=String(fixture?.tour||"").toLowerCase();
 if(!["atp","wta"].includes(tour))return [];
 const matched=[];
 for(const e of events){
  const slug=String(e.slug||"").toLowerCase();
  if(!slug.startsWith(tour+"-"))continue;
  const title=String(e.title||"");
  if(!players.every(n=>matchesName(title,n)))continue;
  const at=Date.parse(e.gameStartTime||e.startTime||e.startDate||"");
  if(!Number.isFinite(at)||Math.abs(at-start)>2*3600000)continue;
  const markets=Array.isArray(e.markets)?e.markets:[];
  for(const m of markets){
   if(m.closed||m.active===false)continue;
   const names=decode(m.outcomes),prices=decode(m.outcomePrices);
   if(names.length!==2||prices.length!==2||!names.every(x=>players.some(p=>matchesName(x,p)||matchesName(p,x))))continue;
   const values=prices.map(Number);
   if(values.some(v=>!Number.isFinite(v)||v<=0||v>=1))continue;
   matched.push({provider:"Polymarket.com",marketId:String(m.id),eventId:String(e.id),
     eventSlug:slug,question:m.question||title,outcomes:names,indicativePrices:values,
     capturedAt:asOf,quoteSourceTime:null,priceKind:"GAMMA_METADATA_INDICATIVE_NOT_ORDERBOOK",
     canQualify:false,canAuthorizeWager:false,executionEligible:false});
  }
 }
 if(new Set(matched.map(m=>m.eventId)).size!==1)return [];
 return matched.slice(0,12);
}
