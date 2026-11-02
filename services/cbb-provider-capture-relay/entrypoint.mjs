// Manual recovery only. No public endpoint, provider key or recurring deployment.
// The operator must remove the temporary trigger/Worker after its one durable run.
export default {
 async fetch(){return new Response('Disabled',{status:410});},
 async scheduled(controller,env){
  if(!env.EXPIRES_AT||Date.now()>Date.parse(env.EXPIRES_AT))return;
  const id=env.RELAY_RUN_ID;
  const lock=await env.CBB_DB.prepare("INSERT OR IGNORE INTO cbb_provider_capture_runs(run_id,started_at,status) VALUES (?,?,'relay-running')").bind(id,new Date().toISOString()).run();
  if(Number(lock.meta?.changes)!==1)return;
  let httpStatus=0,error=null,responseDiagnostic=null;
  try{
   const r=await fetch('https://fbis-myz.pages.dev/operator/cbb-capture',{
    method:'POST',body:new URLSearchParams({permit:env.PERMIT}),redirect:'manual',signal:AbortSignal.timeout(240000)
   });httpStatus=r.status;
   if(r.status>=400&&r.body){const reader=r.body.getReader();const first=await reader.read();responseDiagnostic=new TextDecoder().decode((first.value||new Uint8Array()).subarray(0,1024));await reader.cancel();}else await r.body?.cancel();
  }catch(e){error=String(e?.message||e).slice(0,250);}
  await env.CBB_DB.prepare("UPDATE cbb_provider_capture_runs SET status='relay-finished',summary_json=? WHERE run_id=?").bind(JSON.stringify({httpStatus,error,responseDiagnostic}),id).run();
 }
};
