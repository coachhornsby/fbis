import {kalshiSignedHeaders,kalshiPrivateKeyPem} from '../lib/kalshiAccount.js';
import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
export const KALSHI_MARKET_SIGN_JOB='functions/api/kalshi-market-stream-sign.js';
const json=(body,status)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-robots-tag':'noindex'}});
export async function onRequestPost({request,env}){
 const got=request.headers.get('x-fbis-kalshi-relay-token')||'',expected=env.FBIS_KALSHI_RELAY_TOKEN;
 if(typeof expected!=='string'||expected.length<40||got.length!==expected.length||got.length>256)return json({ok:false,code:'UNAUTHORIZED'},403);
 const enc=new TextEncoder(),[a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(got)),crypto.subtle.digest('SHA-256',enc.encode(expected))]);
 const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
 if(diff)return json({ok:false,code:'UNAUTHORIZED'},403);
 try{env=await beginJobExecution(env,KALSHI_MARKET_SIGN_JOB);}catch{return json({ok:false,code:'ACCOUNT_BUDGET_STOP'},503);}
 const path='/trade-api/ws/v2';
 try{const headers=await kalshiSignedHeaders({keyId:env.KALSHI_API_KEY_ID,privateKeyPem:kalshiPrivateKeyPem(env),path,method:'GET',timestamp:Date.now()});
 return json({ok:true,path,headers,expiresInMs:10000},200);}catch{return json({ok:false,code:'KALSHI_SIGNING_UNAVAILABLE'},503);}
}
export function onRequestGet(){return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);}
