/**
 * Research-only explorer of the signed Kalshi daily Sports series catalog.
 * Fully R2-backed: NEVER fetches upstream per user request and never reads
 * Kalshi account credentials, fee schedules, or executable quotes.
 */
const SOURCE="kalshi/public-shadow/v1/series-catalog.json";
const response=(body,status=200)=>Response.json(body,{status,
  headers:{"cache-control":status===200?"public, max-age=60":"no-store",
    "x-robots-tag":"noindex","x-content-type-options":"nosniff"}});
export async function loadKalshiSeriesCatalog(env,{query="",offset=0,limit=40}={}){
 const raw=typeof query==="string"?query.trim().slice(0,60).toLowerCase():"";
 const start=Math.min(10000,Math.max(0,Math.floor(Number(offset)||0)));
 const count=Math.min(50,Math.max(1,Math.floor(Number(limit)||40)));
 let object=null;
 try{object=await env?.ARCHIVE?.get?.(SOURCE);}catch{}
 if(!object)return{ok:false,code:"KALSHI_SERIES_CATALOG_NOT_READY",
   canQualify:false,canAuthorizeWager:false};
 let catalog=null;
 try{catalog=await object.json();}catch{}
 if(!catalog?.ok||!Array.isArray(catalog.records))
   return {ok:false,code:"KALSHI_SERIES_CATALOG_INVALID",
     canQualify:false,canAuthorizeWager:false};
 const filtered=catalog.records.filter(row=>{
  if(typeof row?.ticker!=="string")return false;
  if(!raw)return true;
  return [row.ticker,row.title,row.category,
    ...(Array.isArray(row.categories)?row.categories:[]),
    ...(Array.isArray(row.tags)?row.tags:[])].join(" ").toLowerCase().includes(raw);
 });
 const rows=filtered.slice(start,start+count).map(r=>({
  ticker:String(r.ticker).slice(0,120),
  title:String(r.title||"").slice(0,180),
  category:String(r.category||"").slice(0,100),
  tags:Array.isArray(r.tags)?r.tags.slice(0,12).map(x=>String(x).slice(0,80)):[],
  categories:Array.isArray(r.categories)?r.categories.slice(0,12)
    .map(x=>String(x).slice(0,80)):[],
  contractVerified:false,leagueMappingVerified:false,
  canQualify:false,executionEligible:false,
 }));
 return{ok:true,provider:"Kalshi",query:raw,offset:start,limit:count,
  totalMatches:filtered.length,records:rows,
  nextOffset:start+count<filtered.length?start+count:null,
  reportedSeries:Number.isInteger(catalog.reportedSeries)?catalog.reportedSeries:null,
  storedSeries:Number.isInteger(catalog.storedSeries)?catalog.storedSeries:catalog.records.length,
  truncated:catalog.truncated===true,
  observedAt:catalog.observedAt||null,
  coverage:"SPORTS_SERIES_DISCOVERY_ONLY",
  canQualify:false,canAuthorizeWager:false,
  canChangeCORE:false,canPublishMarketOdds:false};
}
export async function onRequestGet({request,env}){
 const u=new URL(request.url);
 const d=await loadKalshiSeriesCatalog(env,{
  query:u.searchParams.get("q")||"",
  offset:u.searchParams.get("offset")||"0",
  limit:u.searchParams.get("limit")||"40",
 });
 return response(d,d.ok?200:503);
}
export async function onRequestPost(){return response({ok:false,code:"READ_ONLY"},405);}
