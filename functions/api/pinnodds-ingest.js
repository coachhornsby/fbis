import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {preparePinnoddsSnapshot,consumePinnoddsSnapshot,reconcilePinnoddsSnapshot,rematchPinnoddsSnapshot} from '../lib/pinnoddsIngestion.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 try{const body=await request.json();let result;
  if(body.operation==='inspect'){
    if(!/^[a-z0-9-]{1,180}$/i.test(body.snapshotId||''))return json({ok:false,error:'INVALID_SNAPSHOT'},400);
    const obj=await env.ARCHIVE.get('market-sources/pinnodds/receipts/'+body.snapshotId+'.json');
    const receipt=await obj?.json();if(!receipt?.rawKey)return json({ok:false,error:'RECEIPT_UNAVAILABLE'},404);
    const raw=await (await env.ARCHIVE.get(receipt.rawKey))?.json();
    const events=(raw?.events||[]).filter(e=>!e.special&&!e.special_category&&(body.sportScope==='all'||/nfl|ncaa|college/i.test(e.league_name||'')));
    return json({ok:true,snapshotId:body.snapshotId,collectedAt:receipt.collectedAt,
      events:events.map(e=>({id:e.event_id,league:e.league_name,home:e.home,away:e.away,start:e.starts})),paidProviderCalls:0});
  }
  if(body.operation==='prepare')result=await preparePinnoddsSnapshot(env,body);
  else if(body.operation==='consume')result=await consumePinnoddsSnapshot(env,body);
  else if(body.operation==='reconcile')result=await reconcilePinnoddsSnapshot(env,body);
  else if(body.operation==='rematch')result=await rematchPinnoddsSnapshot(env,body);
  else return json({ok:false,error:'INVALID_OPERATION'},400);
  return json(result,result.ok?200:409);
 }catch(error){return json({ok:false,error:String(error?.message||error),canAuthorizeWager:false},502);}
}
