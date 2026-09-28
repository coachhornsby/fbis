import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import {
  normalizeAvailabilityRecord,
  buildGameAvailabilityImpact,
} from "../lib/availability.js";
import {
  persistAvailabilityObservations,
  queryAvailabilityObservations,
} from "../lib/store.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
    },
  });
}

function envFrom(context){
  return {DB:context.env.DB,caches:caches.default};
}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  try{
    const body=await context.request.json();
    const source=String(body?.source||"manual").toLowerCase();
    const observedAt=body?.observedAt||new Date().toISOString();
    const input=Array.isArray(body?.records)?body.records:Array.isArray(body)?body:[];
    const rows=input.map((row)=>normalizeAvailabilityRecord(row,{source,observedAt})).filter(Boolean);
    if(!rows.length){
      return json({ok:false,error:"no-valid-availability-records"},400);
    }
    const persisted=await persistAvailabilityObservations(envFrom(context),rows);
    return json({
      ok:persisted.ok,
      source,
      received:input.length,
      normalized:rows.length,
      inserted:persisted.inserted||0,
      already:persisted.already||0,
      failed:persisted.failed||0,
      reason:persisted.reason||null,
      at:new Date().toISOString(),
    },persisted.ok?200:503);
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},400);
  }
}

export async function onRequestGet(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  const url=new URL(context.request.url);
  const sport=String(url.searchParams.get("sport")||"").toLowerCase();
  const teamKey=String(url.searchParams.get("teamKey")||"").toLowerCase();
  const gameId=url.searchParams.get("gameId")||null;
  const since=url.searchParams.get("since")||new Date(Date.now()-7*24*3600000).toISOString();
  if(!sport) return json({ok:false,error:"sport-required"},400);
  const result=await queryAvailabilityObservations(envFrom(context),{
    sport,
    since,
    teamKeys:teamKey?[teamKey]:[],
    gameId,
    limit:Number(url.searchParams.get("limit")||500),
  });
  return json({ok:result.ok,sport,rows:result.rows||[],reason:result.reason||null,at:new Date().toISOString()},result.ok?200:503);
}
