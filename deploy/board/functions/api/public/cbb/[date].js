import {cbbCardSummary} from '../../../../../../functions/lib/cbbCardSummary.js';
const json=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'public, max-age=60','x-content-type-options':'nosniff'}});
export async function onRequestGet({env,params}){
 const date=String(params?.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,state:'INVALID_DATE'},400);
 try{const o=await env.FBIS_PRIVATE_CBB.get('private/cbb/projections/'+date+'.json');if(!o)return json({ok:false,state:'NO_CBB_SNAPSHOT'},404);if(o.size>1048576)return json({ok:false,state:'INVALID_CBB_PACKET'},503);const packet=cbbCardSummary(await o.json(),{date});if(!packet.events.length)return json({ok:false,state:'NO_CBB_SNAPSHOT'},404);return json({ok:true,date,packet});}catch{return json({ok:false,state:'CBB_SUMMARY_UNAVAILABLE'},503);}
}
