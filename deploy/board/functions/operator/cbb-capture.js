import {captureCbbProviders} from '../../../../functions/lib/cbbOperatorCapture.js';
export async function onRequest({request,env}){
 try{return await captureCbbProviders(request,env);}
 catch(e){
  let error=String(e?.message||e).slice(0,300);
  for(const key of ['CFBD_API_KEY','CBBD_API_KEY','KENPOM_API_KEY'])if(env[key])error=error.split(String(env[key])).join('[REDACTED]');
  try{const lease=JSON.parse(env.FBIS_CBB_OPERATOR_LEASE||'{}');await env.CBB_DB.prepare("UPDATE cbb_provider_capture_runs SET status='failed',summary_json=? WHERE run_id=?").bind(JSON.stringify({fatal:error}),lease.id).run();}catch{}
  return Response.json({ok:false,error},{status:500,headers:{'Cache-Control':'no-store'}});
 }
}
