import { SOCCER_DESCRIPTIVE_AGGREGATE_SQL, buildSoccerDescriptiveRanks } from '../lib/soccerTeamRankings.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'public, max-age=300'}});
export async function onRequestGet(context){
 const url=new URL(context.request.url),league=String(url.searchParams.get('league')||'');
 if(!league)return json({ok:false,error:'league-required'},400);
 // Validate league before querying the persistent source.
 const empty=buildSoccerDescriptiveRanks([],league);
 if(!empty.ok)return json(empty,400);
 const db=context.env?.DB;
 if(!db?.prepare)return json({ok:false,error:'d1-unbound'},503);
 const asOf=new Date().toISOString().slice(0,10),start=new Date(Date.now()-900*86400000).toISOString().slice(0,10);
 try{
   const r=await db.prepare(SOCCER_DESCRIPTIVE_AGGREGATE_SQL).bind(league,start,asOf,league,start,asOf).all();
   return json({...buildSoccerDescriptiveRanks(r?.results||[],league),asOf,historyStart:start});
 }catch(err){
   return json({ok:false,error:'source-rankings-query-failed',detail:String(err?.message||err)},503);
 }
}
