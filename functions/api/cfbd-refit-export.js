import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { cfbdGet } from "../lib/collegeApi.js";

const ALLOWED = new Set([
  "/ratings/sp","/ratings/fpi","/ratings/srs","/ratings/elo","/ratings/core",
  "/ppa/teams","/ppa/games","/ppa/players/season",
  "/stats/season/advanced","/stats/game/advanced",
  "/talent","/player/returning","/player/usage","/recruiting/teams",
  "/venues","/coaches","/games","/lines"
]);
const QUERY_KEYS = new Set(["year","week","seasonType","position","category","team","conference","classification"]);

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  const url=new URL(context.request.url);
  const endpoint=String(url.searchParams.get("endpoint")||"").trim();
  if(!ALLOWED.has(endpoint)) return json({ok:false,error:"endpoint-not-allowed"},400);
  const query={};
  for(const [k,v] of url.searchParams.entries()){
    if(k==="endpoint"||!QUERY_KEYS.has(k)||v==="") continue;
    query[k]=["year","week"].includes(k)?Number(v):v;
  }
  const env={
    CFBD_API_KEY:context.env.CFBD_API_KEY,
    caches:globalThis.caches?.default,
    DB:context.env.DB
  };
  const res=await cfbdGet(endpoint,env,{query,skipCache:false});
  if(!res.ok) return json({message:res.reason||"cfbd-refit-export-failed",status:res.status||0},res.status>=400?res.status:502);
  // Return the native CFBD payload shape only. The credential is never serialized.
  return json(res.data,200);
}
