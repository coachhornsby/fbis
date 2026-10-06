import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}

export async function onRequestPost(context){
  const auth=authorizeSoccerWorker(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;
  if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);

  let body={};
  try{body=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}

  const runId=String(body.runId||"");
  const modelVersion=String(body.modelVersion||"SOCCER-FBIS-v3.1");
  const snapshotId=body.snapshotId==null?null:String(body.snapshotId);
  const codeSha=body.codeSha==null?null:String(body.codeSha);
  const rows=Array.isArray(body.rows)?body.rows:[];
  if(!runId)return json({ok:false,error:"run-id-required"},400);
  if(!rows.length||rows.length>200)return json({ok:false,error:"rows-required-max-200"},400);

  const now=new Date().toISOString();
  let written=0;
  for(const r of rows){
    const heritageKey=r.heritageKey==null?null:String(r.heritageKey);
    const modelVariant=String(r.modelVariant||"UNKNOWN");
    const benchmarkVariant=r.benchmarkVariant==null?null:String(r.benchmarkVariant);
    const marketFamily=String(r.marketFamily||"UNKNOWN");
    const lineKey=r.lineKey==null?null:String(r.lineKey);
    const sampleN=Math.max(0,Number(r.sampleN)||0);
    const id=[runId,heritageKey||"ALL",modelVariant,marketFamily,lineKey||"ALL"].join(":");
    await db.prepare(`INSERT INTO soccer_validation_evidence(
      id,run_id,heritage_key,model_version,model_variant,benchmark_variant,market_family,line_key,sample_n,
      metrics_json,point_in_time,market_used,research_only,can_qualify,can_authorize,evaluated_at,created_at,snapshot_id,code_sha
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,1,0,0,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      sample_n=excluded.sample_n,
      metrics_json=excluded.metrics_json,
      point_in_time=excluded.point_in_time,
      market_used=excluded.market_used,
      research_only=1,
      can_qualify=0,
      can_authorize=0,
      evaluated_at=excluded.evaluated_at,
      snapshot_id=excluded.snapshot_id,
      code_sha=excluded.code_sha`)
      .bind(
        id,runId,heritageKey,modelVersion,modelVariant,benchmarkVariant,marketFamily,lineKey,sampleN,
        JSON.stringify(r.metrics||{}),
        r.pointInTime===false?0:1,
        r.marketUsed===true?1:0,
        now,now,snapshotId,codeSha
      ).run();
    written++;
  }

  return json({
    ok:true,runId,modelVersion,snapshotId,codeSha,written,
    researchOnly:true,canQualify:false,canAuthorize:false,evaluatedAt:now
  });
}
