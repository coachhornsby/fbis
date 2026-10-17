import { harvestSecret } from "../lib/auth.js";

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"private, no-store",
  "x-content-type-options":"nosniff"
}});

/** Authenticated, read-only operational database readiness check. */
export async function onRequestGet({env,request}={}){
  const expected=harvestSecret(env);
  if(!expected || request?.headers?.get("x-harvest-secret")!==expected)
    return json({ok:false,error:"FORBIDDEN"},403);
  if(!env?.OPERATIONS_DB?.prepare)
    return json({ok:false,error:"OPERATIONS_DB_UNBOUND"},503);
  try {
    const result=await env.OPERATIONS_DB.prepare(
      "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='operations_schema_migrations') AS schema_ready, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='operations_job_runs') AS jobs_ready"
    ).first();
    if(result?.schema_ready!==1 || result?.jobs_ready!==1)
      return json({ok:false,error:"OPERATIONS_SCHEMA_NOT_READY"},503);
    return json({ok:true,operationsDb:"ready",schemaReady:true,jobsReady:true});
  } catch {
    return json({ok:false,error:"OPERATIONS_DB_QUERY_FAILED"},503);
  }
}
export async function onRequestPost(){return json({ok:false,error:"METHOD_NOT_ALLOWED"},405)}
