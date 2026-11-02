/** Private current-provider lookup; no network calls or PRIMARY fallback. */
export async function loadCbbCurrentProviderInput(env,{season,teamId,provider}={}){
 if(!env?.CBB_DB?.prepare)return{ok:false,reason:'CBB_DB_UNBOUND'};
 if(!Number.isInteger(season)||!/^cbb-\d+$/.test(String(teamId))||!['kenpom','cbbd','torvik'].includes(provider))return{ok:false,reason:'INVALID_PROVIDER_INPUT_KEY'};
 const row=await env.CBB_DB.prepare('SELECT payload_json,source_sha256,capture_run_id FROM cbb_current_provider_inputs WHERE season=? AND provider=? AND team_id=?').bind(season,provider,teamId).first();
 if(!row)return{ok:false,reason:'CURRENT_PROVIDER_INPUT_MISSING'};
 const data=JSON.parse(row.payload_json);
 if(data.season!==season||data.canonicalId!==teamId)return{ok:false,reason:'PROVIDER_INPUT_IDENTITY_MISMATCH'};
 return{ok:true,data,sourceSha256:row.source_sha256,captureRunId:row.capture_run_id,projectionReady:false,canAuthorizeWager:false};
}
