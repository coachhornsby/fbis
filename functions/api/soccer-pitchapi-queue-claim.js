import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequestPost(context){
  const auth=authorizeSoccerWorker(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);
  const now=new Date(),nowIso=now.toISOString(),leaseUntil=new Date(now.getTime()+5*60*1000).toISOString();
  const candidate=await db.prepare(`SELECT * FROM soccer_pitchapi_backfill_queue
    WHERE (status='PENDING' OR (status='LEASED' AND (lease_until IS NULL OR lease_until<?)))
    AND attempts<6
    ORDER BY CASE heritage_key
      WHEN 'eng.1' THEN 1
      WHEN 'eng.2' THEN 2
      WHEN 'ger.1' THEN 3
      WHEN 'esp.1' THEN 4
      WHEN 'ita.1' THEN 5
      WHEN 'fra.1' THEN 6
      WHEN 'uefa.champions' THEN 7
      WHEN 'uefa.europa' THEN 8
      WHEN 'usa.1' THEN 9
      WHEN 'mex.1' THEN 10
      WHEN 'ned.1' THEN 11
      WHEN 'por.1' THEN 12
      WHEN 'arg.1' THEN 13
      WHEN 'bra.1' THEN 14
      ELSE 100
    END, updated_at,id LIMIT 1`).bind(nowIso).first();
  if(!candidate)return json({ok:true,empty:true});
  const update=await db.prepare(`UPDATE soccer_pitchapi_backfill_queue
    SET status='LEASED',attempts=attempts+1,lease_until=?,updated_at=?
    WHERE id=? AND (status='PENDING' OR (status='LEASED' AND (lease_until IS NULL OR lease_until<?)))`)
    .bind(leaseUntil,nowIso,candidate.id,nowIso).run();
  if(!update?.meta?.changes)return json({ok:true,empty:false,contended:true},409);
  return json({ok:true,empty:false,item:{id:candidate.id,heritageName:candidate.heritage_name,leagueKey:candidate.heritage_key,pitchLeagueId:candidate.pitch_league_id,season:candidate.season,offset:candidate.offset,pageSize:candidate.page_size,leaseUntil}});
}
