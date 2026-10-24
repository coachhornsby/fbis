import {authorizeHarvest} from '../lib/auth.js';
import {readLabPackets} from '../lib/mlbStatcastLabStore.js';
import {persistMlbModelFeatures} from '../lib/mlbModelFeatures.js';
export async function onRequestPost({env,request}){
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 if(!request.headers.get('x-harvest-secret')||!authorizeHarvest(request,env).ok)return reply({ok:false,error:'Unauthorized'},403);
 try{
  const text=await request.text();if(text.length>1000)return reply({ok:false,error:'Payload too large'},413);
  const {playerId,role}=JSON.parse(text);
  if(!/^\d+$/.test(String(playerId))||!['pitcher','batter'].includes(role))return reply({ok:false,error:'Invalid player scope'},400);
  const capturedAt=new Date().toISOString(),year=Number(capturedAt.slice(0,4));
  const {packets,diagnostics}=await readLabPackets(env,{playerId:String(playerId),role,seasons:[year-1,year].filter(y=>y>=2024)});
  if(!packets.length||diagnostics.length)return reply({ok:false,error:'Incomplete source coverage',diagnostics},422);
  return reply(await persistMlbModelFeatures(env,{packets,playerId,role,capturedAt}));
 }catch{return reply({ok:false,error:'Feature capture failed'},422);}
}
