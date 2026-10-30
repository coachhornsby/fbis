import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
import {POLY_STREAM_SIGN_JOB} from '../../services/account-budget/executionJobs.mjs';
import {signedPolymarketUsHeaders} from "../lib/polymarketUsSignedWs.js";
const json=(body,status)=>new Response(JSON.stringify(body),{status,headers:{
  "content-type":"application/json","cache-control":"no-store, private","x-robots-tag":"noindex"
}});
/**
 * Narrow signing broker for a separate read-only Cloudflare stream Worker.
 * The API key and secret never leave this backend. A short-lived
 * timestamp signature can authenticate ONLY the market-data WebSocket path.
 * Header-token authenticated. No account or order routes. Signatures remain
 * time-limited credentials; the upstream, not this broker, decides replay rules.
 */
export async function onRequestPost({request,env}){
  const got=request.headers.get("x-fbis-stream-token")||"";
  const expected=env?.POLYMARKET_STREAM_PROXY_TOKEN;
  if(typeof expected!=='string'||!expected||got.length!==expected.length||got.length>256)return json({ok:false,error:"unauthorized"},403);
  const enc=new TextEncoder();const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(expected)),crypto.subtle.digest('SHA-256',enc.encode(got))]);
  let diff=0;const left=new Uint8Array(a),right=new Uint8Array(b);for(let i=0;i<left.length;i++)diff|=left[i]^right[i];
  if(diff)return json({ok:false,error:"unauthorized"},403);
  try{env=await beginJobExecution(env,POLY_STREAM_SIGN_JOB);}catch{return json({ok:false,error:'account-budget-stop'},503);}
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
