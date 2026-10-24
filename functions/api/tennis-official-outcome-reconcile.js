import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {captureWtaOfficialResults} from '../lib/tennisOfficialResults.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare||!env?.ARCHIVE?.put)
  return json({ok:false,reason:'DURABLE_SOURCE_EVIDENCE_STORAGE_REQUIRED'},503);
 try{
  const result=await captureWtaOfficialResults(env);
  return json(result,result.ok?200:502);
 }catch(e){
  return json({ok:false,reason:String(e?.message||'WTA_OUTCOME_UNAVAILABLE'),
   researchOnly:true,canAuthorizeWager:false},503);
 }
}
