import {harvestSecret} from "../lib/auth.js";

const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"private, no-store"}});
const digest=async(s)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(s)))),v=>v.toString(16).padStart(2,"0")).join("");
const source="Polymarket US WebSocket";
async function read(db,sql,...args){
 const s=db.prepare(sql);const r=await (args.length?s.bind(...args):s).all();
 if(!Array.isArray(r?.results))throw Error("D1_READ_INVALID");
 return r.results;
}
/** Authenticated, read-only check for last 8 canonical WS records. No provider calls. */
export async function onRequestGet({env,request}){
 if(!harvestSecret(env)||request.headers.get("x-harvest-secret")!==harvestSecret(env))
   return reply({ok:false,error:"FORBIDDEN"},403);
 if(!env?.DB?.prepare||!env?.MARKET_HISTORY_DB?.prepare)
   return reply({ok:false,error:"BINDING_UNAVAILABLE"},503);
 try{
  const columns=(await read(env.DB,"PRAGMA table_info(normalized_market_observations)")).map(x=>x.name);
  const shardColumns=(await read(env.MARKET_HISTORY_DB,"PRAGMA table_info(normalized_market_observations)")).map(x=>x.name);
  if(columns.length!==50||JSON.stringify(columns)!==JSON.stringify(shardColumns))throw Error("SCHEMA_DRIFT");
  const latest=await read(env.DB,`SELECT id,* FROM normalized_market_observations
     WHERE source=? ORDER BY rowid DESC LIMIT 8`,source);
  if(latest.length!==8)return reply({ok:false,state:"INSUFFICIENT_SOURCE_ROWS",verified:0,canAuthorizeWager:false},503);
  const ids=latest.map(x=>x.id);
  const matched=await read(env.MARKET_HISTORY_DB,"SELECT * FROM normalized_market_observations WHERE id IN ("+ids.map(()=>"?").join(",")+")",...ids);
  const found=new Map(matched.map(x=>[x.id,x]));
  let verified=0,missing=0,mismatched=0;
  for(const x of latest){
    const y=found.get(x.id);if(!y){missing++;continue;}
    const [a,b]=await Promise.all([digest(JSON.stringify(columns.map(c=>x[c]))),digest(JSON.stringify(columns.map(c=>y[c])))]);
    if(a!==b){mismatched++;continue;}verified++;
  }
  const complete=verified===8&&missing===0&&mismatched===0;
  return reply({ok:complete,state:complete?"RECENT_WS_PARITY_VERIFIED":"SHADOW_LAG_OR_CONTENT_DRIFT",
     checked:8,verified,missing,mismatched,latestSourceCollectedAt:latest[0].collected_at,
     latestSourceObservedAt:latest[0].source_observed_at??null,
     continuousShadowEnabled:env.MARKET_HISTORY_SHADOW_WS==="enabled",
     sourceOfTruth:"PRIMARY_D1",productionRowsDeleted:0,
     readOnly:true,canQualify:false,canAuthorizeWager:false},complete?200:503);
 }catch{
  return reply({ok:false,state:"SHADOW_MONITOR_UNAVAILABLE",canQualify:false,canAuthorizeWager:false},503);
 }
}
export async function onRequestPost(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405)}
