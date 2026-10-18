import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {fetchEspnScoreboard,mapEvent,todayCT,shiftDateCT} from '../lib/slateEngineCore.js';
import {persistGame} from '../lib/store.js';
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),401);
 const b=await request.json();if(!['nfl','cfb'].includes(b.sport)||!Number.isInteger(b.dayOffset)||b.dayOffset<0||b.dayOffset>8)return json({ok:false,error:'INVALID_SCOPE'},400);
 try{const date=shiftDateCT(todayCT(),b.dayOffset),source=await fetchEspnScoreboard(b.sport,date);
 const results=[];for(const e of source.events||[]){const game=mapEvent(b.sport,e);results.push(await persistGame(env,{...game,sport:b.sport},date));}
 return json({ok:results.every(r=>r.ok),sport:b.sport,date,fixtures:results.length,oddsIngested:0,forecastsChanged:0});
 }catch{return json({ok:false,error:'FOOTBALL_FIXTURES_UNAVAILABLE'},502);}
}
