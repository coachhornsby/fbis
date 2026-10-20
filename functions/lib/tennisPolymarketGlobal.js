/**
 * Polymarket INTERNATIONAL Gamma discovery (not Polymarket US).
 * Research-only, bounded read: markets never supply fixture identities,
 * predictions, quote source clocks, executable prices, or betting permission.
 */
const API="https://gamma-api.polymarket.com";
const normalize=s=>" "+String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()+" ";
const matchesName=(str,name)=>normalize(str).includes(normalize(name));
const lastToken=name=>normalize(name).trim().split(/\s+/).at(-1)||"";
const matchesPair=(text,names)=>names.every(n=>matchesName(text,n))||
 (names.every(n=>lastToken(n).length>=5)&&new Set(names.map(lastToken)).size===2&&
  names.every(n=>normalize(text).includes(" "+lastToken(n)+" ")));
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
  if(!matchesPair(title,players))continue;
  const at=Date.parse(e.gameStartTime||e.startTime||e.markets?.[0]?.gameStartTime||"");
  if(!Number.isFinite(at)||Math.abs(at-start)>2*3600000)continue;
  const markets=Array.isArray(e.markets)?e.markets:[];
  for(const m of markets){
   if(m.closed||m.active===false)continue;
   const names=decode(m.outcomes),prices=decode(m.outcomePrices);
   if(names.length!==2||prices.length!==2||!names.every(x=>players.some(p=>matchesName(x,p)||matchesName(p,x)||lastToken(p)===normalize(x).trim())))continue;
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

const SNAPSHOT_KEY="tennis/polymarket-global/research-snapshot-v1.json";
const lastName=name=>String(name||"").trim().split(/\s+/).at(-1)||"";
export async function collectPolymarketGlobalTennis(env,{now=new Date(),fetchImpl=fetch,limit=24}={}){
 if(!env?.DB?.prepare||!env?.ARCHIVE?.put)throw Error("TENNIS_COLLECTION_BINDING_MISSING");
 const at=now.toISOString();
 const q=await env.DB.prepare("SELECT fixture_id AS id,tour,player1_name AS away_name,player2_name AS home_name,match_time AS start,status,fetched_at FROM tennis_external_fixtures WHERE source='ESPN_PUBLIC' AND tour IN ('atp','wta') AND status IN ('SCHEDULED','IN_PROGRESS') AND fetched_at>=? AND match_time BETWEEN ? AND ? ORDER BY ABS(julianday(match_time)-julianday(?)) ASC LIMIT ?")
 .bind(new Date(+now-18*3600000).toISOString(),new Date(+now-8*3600000).toISOString(),new Date(+now+36*3600000).toISOString(),at,Math.min(40,Math.max(1,limit))).all();
 const fixtures=(q?.results||[]).filter(f=>f.id?.startsWith("tennis:espn:"));
 const events=new Map(),errors=[],searches=[];let next=0;
 const worker=async()=>{
  while(next<fixtures.length){
   const fixture=fixtures[next++],queries=[
    [lastName(fixture.away_name),lastName(fixture.home_name)].join(" "),
    lastName(fixture.away_name)];
   for(const term of queries){
    const uri=new URL(API+"/public-search");
    uri.searchParams.set("q",term);uri.searchParams.set("events_status","active");
    uri.searchParams.set("limit_per_type","12");
    try{
     const response=await fetchImpl(uri.toString(),{method:"GET",headers:{accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(7000)});
     if(!response.ok)throw Error("HTTP_"+response.status);
     const payload=await response.json();
     if(!Array.isArray(payload?.events))throw Error("SEARCH_SCHEMA_INVALID");
     searches.push({fixtureId:fixture.id,query:term,hits:payload.events.length});
     const matched=payload.events.filter(e=>matchPolymarketGlobalTennis(fixture,[e],{now,asOf:at}).length);
     for(const e of matched)events.set(String(e.id),e);
     if(matched.length)break;
    }catch(e){errors.push({fixtureId:fixture.id,code:String(e?.message||e).slice(0,60)})}
   }
  }
 };
 await Promise.all(Array.from({length:Math.min(4,fixtures.length)},()=>worker()));
 const snapshot={version:1,source:"POLYMARKET_GLOBAL_GAMMA",asOf:at,
  fixtureCount:fixtures.length,searchCount:searches.length,eventCount:events.size,
  errors,searches,events:[...events.values()],quoteSourceTime:null,
  marketKind:"GAMMA_METADATA_RESEARCH_ONLY",canQualify:false,canAuthorizeWager:false,executionEligible:false};
 await env.ARCHIVE.put(SNAPSHOT_KEY,JSON.stringify(snapshot),{httpMetadata:{contentType:"application/json",cacheControl:"private,max-age=0"}});
 return {ok:errors.length===0,asOf:at,fixtureCount:fixtures.length,matchedEvents:events.size,
  searchCount:searches.length,errors,source:snapshot.source,canQualify:false,canAuthorizeWager:false};
}
export async function loadPolymarketGlobalTennisSnapshot(archive,{now=new Date()}={}){
 try{
  const file=await archive?.get?.(SNAPSHOT_KEY);
  if(!file)return {ok:false,code:"SNAPSHOT_MISSING",events:[]};
  const data=await file.json(),age=+now-Date.parse(data?.asOf||"");
  if(data?.version!==1||data.source!=="POLYMARKET_GLOBAL_GAMMA"||!Array.isArray(data.events)||
    !Number.isFinite(age)||age<0||age>30*60000)
   return {ok:false,code:"SNAPSHOT_STALE_OR_INVALID",events:[]};
  return {ok:true,events:data.events,asOf:data.asOf,source:data.source,
   marketKind:"RESEARCH_ONLY",canQualify:false,canAuthorizeWager:false};
 }catch{return {ok:false,code:"SNAPSHOT_READ_FAILED",events:[]}}
}
