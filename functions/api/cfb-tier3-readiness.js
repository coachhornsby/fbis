import {authorizeStrategyPost} from "../lib/auth.js";
import {auditCfbTier3ProjectionReadiness} from "../lib/cfbTier3ProjectionReadiness.js";
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export async function onRequestGet({request,env}) {
 if(!authorizeStrategyPost(request,env).ok)return respond({ok:false,error:"unauthorized"},401);
 try{return respond(await auditCfbTier3ProjectionReadiness(env));}
 catch(e){return respond({ok:false,error:String(e.message||e).slice(0,90),canAuthorizeWager:false},503);}
}
