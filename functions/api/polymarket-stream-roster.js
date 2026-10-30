import {stageBoundedStreamCandidates} from '../lib/boundedPolymarketRoster.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
async function authorized(request,env){
 const expected=env?.POLYMARKET_STREAM_PROXY_TOKEN,got=request.headers.get('x-fbis-stream-token');
 if(typeof expected!=='string'||!expected||typeof got!=='string'||got.length!==expected.length||got.length>256)return false;
 const encoder=new TextEncoder(),[a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(expected)),crypto.subtle.digest('SHA-256',encoder.encode(got))]);
 let diff=0;const left=new Uint8Array(a),right=new Uint8Array(b);for(let i=0;i<left.length;i++)diff|=left[i]^right[i];return diff===0;
}
async function boundedJson(request){
 const reader=request.body?.getReader();if(!reader)throw Error('INVALID_BODY');const chunks=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>131072)throw Error('BODY_TOO_LARGE');chunks.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
/** Bounded producer handoff. No SQL, provider discovery or archive listing.
 * Immutable capture receipts can be republished without refetching a market.
 */
export async function onRequestPost({request,env}){
 if(!await authorized(request,env))return json({ok:false,error:'FORBIDDEN'},403);
 let value;try{value=await boundedJson(request);}catch{return json({ok:false,error:'INVALID_BOUNDED_ROSTER_BODY'},400);}
 try{return json(await stageBoundedStreamCandidates(env,{sport:value?.sport,candidates:value?.candidates}));}
 catch(error){return json({ok:false,error:error.message==='ROSTER_UPDATE_CONFLICT'?'ROSTER_UPDATE_CONFLICT':'ROSTER_STAGE_STOPPED',canAuthorizeWager:false},error.message==='ROSTER_UPDATE_CONFLICT'?409:503);}
}
export async function onRequestGet(){return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);}
