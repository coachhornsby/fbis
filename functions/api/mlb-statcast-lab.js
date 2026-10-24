import {authorizeHarvest} from '../lib/auth.js';
import {buildMlbStatcastLab,MLB_STATCAST_LAB_VERSION} from '../lib/mlbStatcastLab.js';
import {persistLabPacket,readLabPackets} from '../lib/mlbStatcastLabStore.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':status===200?'public,max-age=300':'no-store'}});
export async function onRequestGet({env,request}){
 const q=new URL(request.url).searchParams,playerId=q.get('playerId')||'',role=q.get('role')||'pitcher',season=Number(q.get('season')||new Date().getUTCFullYear()),year=new Date().getUTCFullYear();
 if(!/^\d+$/.test(playerId)||!['pitcher','batter'].includes(role)||!Number.isInteger(season)||season<2024||season>year)return json({ok:false,error:'Invalid official MLB player, role or season'},400);
 const {packets,diagnostics}=await readLabPackets(env,{playerId,role,seasons:Array.from({length:year-2023},(_,i)=>2024+i)});
 const options=Object.fromEntries(['hand','pitchType','pitchGroup','pitchResult','paResult','scope','attackZone'].map(k=>[k,q.get(k)||({scope:'competitive'}[k]||'all')]));
 const data=buildMlbStatcastLab(packets,{season,...options});data.role=role;
 return json({ok:true,canonicalPlayerId:`mlb:mlb:${playerId}`,version:MLB_STATCAST_LAB_VERSION,...data,diagnostics});
}
export async function onRequestPost({env,request}){
 if(!request.headers.get('x-harvest-secret')||!authorizeHarvest(request,env).ok)return json({ok:false,error:'Unauthorized'},403);
 if(Number(request.headers.get('content-length')||0)>20000000)return json({ok:false,error:'Payload too large'},413);
 try{const text=await request.text();if(text.length>20000000)return json({ok:false,error:'Payload too large'},413);return json(await persistLabPacket(env,JSON.parse(text)));}catch(error){return json({ok:false,error:String(error.message)},422);}
}
