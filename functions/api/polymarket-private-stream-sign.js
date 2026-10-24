import {authorizeHarvest} from "../lib/auth.js";
import {signedPolymarketUsHeaders} from "../lib/polymarketUsSignedWs.js";
const json=(body,status)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store","x-robots-tag":"noindex","x-content-type-options":"nosniff"}});
/** Private-order socket ONLY. No browser token, trading endpoint, REST account proxy,
 * arbitrary path signing or credential disclosure. Require existing harvest backend identity.
 */
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json({ok:false,code:"UNAUTHORIZED"},403);
 if(!env.POLYMARKET_US_KEY_ID||!env.POLYMARKET_US_SECRET_KEY)
   return json({ok:false,code:"ACCOUNT_CREDENTIALS_NOT_CONFIGURED"},503);
 try{
  const path="/v1/ws/private";
  const headers=await signedPolymarketUsHeaders({keyId:env.POLYMARKET_US_KEY_ID,
    secretKey:env.POLYMARKET_US_SECRET_KEY,path,timestamp:Date.now()});
  return json({ok:true,path,headers,expiresInMs:10000},200);
 }catch{return json({ok:false,code:"PRIVATE_WS_SIGN_FAILED"},503);}
}
export async function onRequestGet(){return json({ok:false,code:"METHOD_NOT_ALLOWED"},405);}
