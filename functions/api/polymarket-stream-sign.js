import {signedPolymarketUsHeaders} from "../lib/polymarketUsSignedWs.js";
const json=(body,status)=>new Response(JSON.stringify(body),{status,headers:{
  "content-type":"application/json","cache-control":"no-store, private","x-robots-tag":"noindex"
}});
/**
 * Narrow signing broker for a separate read-only Cloudflare stream Worker.
 * The API key and secret never leave this backend. A valid one-time-use
 * timestamp signature can authenticate ONLY the market-data WebSocket path.
 * Header-token authenticated. No account, order, balance or signing oracle.
 */
export async function onRequestPost({request,env}){
  const got=request.headers.get("x-fbis-stream-token")||"";
  const expected=env?.POLYMARKET_STREAM_PROXY_TOKEN;
  if(!expected||!got||got!==expected)return json({ok:false,error:"unauthorized"},403);
  if(!env?.POLYMARKET_US_KEY_ID||!env?.POLYMARKET_US_SECRET_KEY)
    return json({ok:false,error:"signing-credentials-unavailable"},503);
  try{
    const headers=await signedPolymarketUsHeaders({
      keyId:env.POLYMARKET_US_KEY_ID,
      secretKey:env.POLYMARKET_US_SECRET_KEY,
      path:"/v1/ws/markets",
      timestamp:Date.now()
    });
    return json({ok:true,path:"/v1/ws/markets",headers,expiresInMs:10000},200);
  }catch{
    return json({ok:false,error:"signature-unavailable"},503);
  }
}
export async function onRequestGet(){return json({ok:false,error:"method-not-allowed"},405)}
