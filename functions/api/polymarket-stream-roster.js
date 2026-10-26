import {hydrateCutoverApprovals} from '../lib/databaseTopology.js';
import {routedPolymarketFixtureReport} from '../lib/polymarketBootstrap.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
/** Internal canonical eligibility only. No provider calls, prices, or wager authority. */
export async function onRequestPost({env,request}){
 const token=request.headers.get('x-fbis-stream-token');
 if(!env.POLYMARKET_STREAM_PROXY_TOKEN||!token||token!==env.POLYMARKET_STREAM_PROXY_TOKEN)return json({ok:false,error:'FORBIDDEN'},403);
 try{
  await hydrateCutoverApprovals(env);
  const report=await routedPolymarketFixtureReport(env);
  return json({ok:true,checkedAt:new Date().toISOString(),horizonHours:168,
   fixtures:report.fixtures.map(g=>({sport:g.sport,id:String(g.id),start:g.start})),
   errors:report.errors,complete:report.errors.length===0,canAuthorizeWager:false});
 }catch{return json({ok:false,error:'AUTHORITATIVE_ROSTER_UNAVAILABLE',canAuthorizeWager:false},503);}
}
export async function onRequestGet(){return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);}
