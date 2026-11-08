import {authorizeStrategyPost} from "../lib/auth.js";
import {auditTier3ReceiptChallenger} from "../lib/cfbTier3ReceiptChallenger.js";
const response=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
export async function onRequestGet({request,env}){
 if(!authorizeStrategyPost(request,env).ok)return response({ok:false,error:"unauthorized"},401);
 const q=new URL(request.url).searchParams;
 try{return response(await auditTier3ReceiptChallenger(env,{
   season:Number(q.get("season")||2026),week:Number(q.get("week")||8),
   limit:Number(q.get("limit")||80)}));}
 catch(e){return response({ok:false,error:String(e.message||e).slice(0,100),canAuthorizeWager:false},503)}
}
