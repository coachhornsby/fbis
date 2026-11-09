import {captureOnce} from '../services/pinnodds-restart/once.mjs';
export const CAPTURE_PATH='/api/pinnodds-capture-once';
const reply=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
// Existing operator authentication only. No new credential, OAuth, generic
// operation dispatch, request body or provider destination can be supplied.
export async function handlePinnoddsCapture(request,env,{check=captureOnce}={}){
 const url=new URL(request.url);if(url.pathname!==CAPTURE_PATH)return null;
 if(env.PINNODDS_RESTART_ONCE_ENABLED!=='true')return reply(404,{error:'PINNODDS_CAPTURE_CHECK_DISABLED'});
 if(request.method!=='POST'||url.search||request.body!==null)return reply(400,{error:'PINNODDS_CAPTURE_REQUEST_INVALID'});
 const token=env.ORCH_CONTROL_TOKEN,header=request.headers.get('authorization')||'';
 if(typeof token!=='string'||token.length<32||token.length>256||header.length>263||header!=='Bearer '+token)return reply(401,{error:'unauthorized'});
 try{const {receipt,budget}=await check(env);return reply(200,{ok:true,snapshotId:receipt.snapshotId,collectedAt:receipt.collectedAt,providerEventCount:receipt.providerEventCount,providerRequests:receipt.providerRequests,canAuthorizeWager:false,budget});}
 catch(error){const code=/^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message||'')?error.message:'PINNODDS_CAPTURE_CHECK_FAILED';return reply(503,{error:code});}
}
