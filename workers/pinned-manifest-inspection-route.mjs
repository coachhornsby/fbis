import {inspectPinnedManifest} from '../services/archive/inspectPinnedManifest.mjs';
export const INSPECTION_PATH='/api/archive/inspect-pinned-manifest';
const response=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function handlePinnedManifestInspection(request,env){
 const url=new URL(request.url);
 if(url.pathname!==INSPECTION_PATH)return null;
 // No OAuth/JWKS fallback, remote auth lookup, body parse, or dynamic source input.
 if(env.FBIS_PINNED_INSPECTION_ENABLED!=='true')return response(404,{error:'PINNED_INSPECTION_DISABLED'});
 if(request.method!=='POST'||url.search||request.body!==null)return response(400,{error:'PINNED_INSPECTION_REQUEST_INVALID'});
 const control=env.ORCH_CONTROL_TOKEN,header=request.headers.get('authorization')||'';
 if(typeof control!=='string'||control.length<32||control.length>256||header.length>263||header!=='Bearer '+control)return response(401,{error:'unauthorized'});
 try{return response(200,await inspectPinnedManifest(env));}
 catch(error){const code=/^(PINNED_INSPECTION_[A-Z0-9_]+|JOB_[A-Za-z0-9_]+|[A-Z0-9_]+)$/.test(error?.message||'')?error.message:'PINNED_INSPECTION_FAILED';return response(503,{error:code});}
}
