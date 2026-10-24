import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {createInhouseRankChallenger,inspectInhouseRankChallenger} from '../lib/tennisInhouseRankChallenger.js';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return json({ok:false,reason:'DB_REQUIRED'},503);
 try{
  return json(await createInhouseRankChallenger(env.DB));
 }catch{
  return json({ok:false,reason:'INHOUSE_RANK_CHALLENGER_UNAVAILABLE',
    canAuthorizeWager:false},503);
 }
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return json({ok:false,reason:'DB_REQUIRED'},503);
 try{return json({ok:true,...await inspectInhouseRankChallenger(env.DB)})}
 catch{return json({ok:false,reason:'CHALLENGER_EVIDENCE_UNAVAILABLE',
    canAuthorizeWager:false},503)}
}
