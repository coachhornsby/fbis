import {runCbbDirectoryPhaseB} from "../lib/cbbDirectoryPhaseBRuntime.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}

export async function onRequestGet(context){
  const u=new URL(context.request.url);
  if(u.searchParams.get("control")!=="cbb-phase-b-runtime-v1") return json({ok:false,error:"not-found"},404);
  if(!context.env.CFBD_API_KEY&&!context.env.CBBD_API_KEY) return json({ok:false,error:"college-api-not-configured"},503);
  const existing=await context.env.DB.prepare("SELECT status,observed_at FROM cbb_directory_phase_b_runs ORDER BY observed_at DESC LIMIT 1").first();
  if(existing?.status==="COMPLETE") return json({ok:true,status:"ALREADY_COMPLETE",observedAt:existing.observed_at});
  const result=await runCbbDirectoryPhaseB({
    DB:context.env.DB,
    caches:caches.default,
    CFBD_API_KEY:context.env.CFBD_API_KEY,
    CBBD_API_KEY:context.env.CBBD_API_KEY,
  });
  return json(result,result.ok?200:502);
}
