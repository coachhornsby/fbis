import {authorizeSoccerWorker,unauthorizedBody} from '../lib/soccerWorkerAuth.js';
import {reconcileSoccerMarkets} from '../lib/soccerMarketReconcile.js';
import {loadSoccerMarketFixtures} from '../lib/soccerMarketFixtures.js';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeSoccerWorker(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 try{const body=await request.json();if(body.operation==='fixtures'){const d=await loadSoccerMarketFixtures(env,{force:true});return json({ok:d.fixtures.length>0,...d});}
  return json(await reconcileSoccerMarkets(env,{limit:100,afterId:typeof body.cursor==="string"?body.cursor:""}));
 }catch(e){return json({ok:false,error:String(e.message)},502);}
}
