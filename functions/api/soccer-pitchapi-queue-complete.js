import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);
  let body={};try{body=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}
  const id=String(body.id||""),ok=body.ok===true,processed=Math.max(0,Number(body.processed)||0),persisted=Math.max(0,Number(body.persisted)||0),unavailable=Math.max(0,Number(body.analyticsUnavailable)||0),done=body.done===true,err=body.error?String(body.error).slice(0,600):null;
  if(!id)return json({ok:false,error:"id-required"},400);
  const row=await db.prepare("SELECT * FROM soccer_pitchapi_backfill_queue WHERE id=?").bind(id).first();
  if(!row)return json({ok:false,error:"queue-item-not-found"},404);
  const now=new Date().toISOString();
  if(!ok){
    const terminal=Number(row.attempts||0)>=6;
    await db.prepare("UPDATE soccer_pitchapi_backfill_queue SET status=?,last_error=?,lease_until=NULL,updated_at=? WHERE id=?")
      .bind(terminal?"FAILED":"PENDING",err||"sync-failed",now,id).run();
    return json({ok:true,status:terminal?"FAILED":"PENDING",retryable:!terminal});
  }
  await db.prepare(`UPDATE soccer_pitchapi_backfill_queue SET status='DONE',matches_seen=matches_seen+?,matches_persisted=matches_persisted+?,
    analytics_unavailable=analytics_unavailable+?,last_error=NULL,lease_until=NULL,updated_at=?,completed_at=? WHERE id=?`)
    .bind(processed,persisted,unavailable,now,now,id).run();
  let nextId=null;
  if(!done&&processed>0){
    const nextOffset=Number(row.offset)+processed;
    nextId=String(row.pitch_league_id)+":"+String(row.season)+":"+nextOffset;
    await db.prepare(`INSERT OR IGNORE INTO soccer_pitchapi_backfill_queue(
      id,heritage_name,heritage_key,pitch_league_id,season,offset,page_size,status,attempts,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,'PENDING',0,?,?)`).bind(nextId,row.heritage_name,row.heritage_key,row.pitch_league_id,row.season,nextOffset,row.page_size,now,now).run();
  }
  await db.prepare(`UPDATE soccer_competition_coverage SET last_ingested_at=? WHERE heritage_name=?`).bind(now,row.heritage_name).run();
  return json({ok:true,status:"DONE",nextId,done});
}
