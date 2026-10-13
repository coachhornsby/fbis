import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {capturePolymarketPage,consumePolymarketPage,reconcilePolymarketPage} from '../lib/polymarketCapture.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 try{const body=await request.json();let result;
  if(body.operation==='capture')result=await capturePolymarketPage(env,body);
  else if(body.operation==='consume')result=await consumePolymarketPage(env,body);
  else if(body.operation==='reconcile')result=await reconcilePolymarketPage(env,body);
  else return json({ok:false,error:'INVALID_OPERATION'},400);
  return json(result,result.ok?200:409);
 }catch(error){return json({ok:false,error:String(error?.message||error),canAuthorizeWager:false},502);}
}
export async function onRequestGet(){return json({ok:false,error:'method-not-allowed'},405);}
