import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
export async function onRequestGet(context){
  const auth=authorizeSoccerWorker(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);
  const row=await db.prepare(`SELECT heritage_name,heritage_key,pitch_match_count,advanced_rows,advanced_coverage,last_validation_at,validation_status
    FROM soccer_competition_coverage
    WHERE discovery_status='MATCHED' AND model_eligible=1 AND pitch_match_count>=120
    ORDER BY CASE WHEN last_validation_at IS NULL THEN 0 ELSE 1 END,last_validation_at,heritage_name LIMIT 1`).first();
  return json({ok:true,target:row||null});
}
export async function onRequestPost(context){
  const auth=authorizeSoccerWorker(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);
  let b={};try{b=await context.request.json();}catch{return json({ok:false,error:"invalid-json"},400);}
  const k=String(b.heritageKey||""),name=String(b.heritageName||""),m=String(b.modelVersion||"SOCCER-FBIS-v3.1");
  if(!k||!name)return json({ok:false,error:"competition-required"},400);
  const n=Math.max(0,Number(b.sampleN)||0),now=new Date().toISOString();
  const gate=n>=300&&Number(b.v3Brier)<Number(b.v2Brier)&&Number(b.v3LogLoss)<Number(b.v2LogLoss)&&Number(b.v3Accuracy)>=Number(b.v2Accuracy)-0.005?"HISTORICAL_EVIDENCE_PASS":"RESEARCH";
  const id=k+":"+m;
  await db.prepare(`INSERT INTO soccer_competition_validation(
    id,heritage_name,heritage_key,model_version,sample_n,v2_accuracy,v2_brier,v2_log_loss,v3_accuracy,v3_brier,v3_log_loss,
    delta_accuracy,delta_brier,delta_log_loss,advanced_coverage,historical_gate,can_qualify,can_authorize,evaluated_at,meta_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)
  ON CONFLICT(heritage_key,model_version) DO UPDATE SET
    sample_n=excluded.sample_n,v2_accuracy=excluded.v2_accuracy,v2_brier=excluded.v2_brier,v2_log_loss=excluded.v2_log_loss,
    v3_accuracy=excluded.v3_accuracy,v3_brier=excluded.v3_brier,v3_log_loss=excluded.v3_log_loss,delta_accuracy=excluded.delta_accuracy,
    delta_brier=excluded.delta_brier,delta_log_loss=excluded.delta_log_loss,advanced_coverage=excluded.advanced_coverage,
    historical_gate=excluded.historical_gate,evaluated_at=excluded.evaluated_at,meta_json=excluded.meta_json`).bind(
      id,name,k,m,n,b.v2Accuracy??null,b.v2Brier??null,b.v2LogLoss??null,b.v3Accuracy??null,b.v3Brier??null,b.v3LogLoss??null,
      b.deltaAccuracy??null,b.deltaBrier??null,b.deltaLogLoss??null,b.advancedCoverage??null,gate,now,JSON.stringify(b.meta||{})
    ).run();
  await db.prepare(`UPDATE soccer_competition_coverage SET validation_status=?,last_validation_at=?,validation_n=?,validation_brier=?,validation_log_loss=?,validation_accuracy=?,can_qualify=0,can_authorize=0 WHERE heritage_name=?`)
    .bind(gate,now,n,b.v3Brier??null,b.v3LogLoss??null,b.v3Accuracy??null,name).run();
  return json({ok:true,heritageName:name,heritageKey:k,historicalGate:gate,sampleN:n,canQualify:false,canAuthorize:false});
}
