// Operator-only readback for the source-locked 1,074-player private portrait scope.
// Rights and access must be proven before any restricted image can be imported.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return send(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return send({ok:false,reason:'D1_BINDING_REQUIRED'},503);
 try{
  const runs=(await env.DB.prepare(`SELECT cohort_id,tour,report_date,source_hash,player_count,locked_at
   FROM tennis_private_portrait_cohort_runs
   WHERE cohort_id='tennis-elo-private-20261019-1074' ORDER BY tour`).all()).results||[];
  const cohorts=(await env.DB.prepare(`SELECT tour,COUNT(*) roster,
   SUM(CASE WHEN identity_status='MATCHED' THEN 1 ELSE 0 END) matched,
   SUM(CASE WHEN identity_status='UNMATCHED' THEN 1 ELSE 0 END) unmatched,
   SUM(CASE WHEN identity_status='AMBIGUOUS' THEN 1 ELSE 0 END) ambiguous,
   SUM(CASE WHEN portrait_stage='NOT_ACQUIRED' THEN 1 ELSE 0 END) not_acquired
   FROM tennis_private_portrait_cohort_members WHERE cohort_id='tennis-elo-private-20261019-1074'
   GROUP BY tour ORDER BY tour`).all()).results||[];
  const policy=(await env.DB.prepare(`SELECT tour,media_source,
   rights_verification,access_verification,activation_state,display_scope,
   public_display_allowed,CASE WHEN rights_evidence_ref IS NULL OR trim(rights_evidence_ref)='' THEN 0 ELSE 1 END AS evidence_on_file
   FROM tennis_private_portrait_policy ORDER BY tour`).all()).results||[];
  const valid=runs.length===2&&cohorts.length===2&&policy.length===2&&
   runs.every(r=>Number(r.player_count)===(r.tour==='atp'?559:515))&&
   cohorts.every(c=>Number(c.roster)===(c.tour==='atp'?559:515))&&
   cohorts.every(c=>Number(c.roster)===Number(c.matched)+Number(c.unmatched)+Number(c.ambiguous))&&
   policy.every(p=>p.display_scope==='PRIVATE_ONLY'&&Number(p.public_display_allowed)===0);
  return send({ok:valid,cohortId:'tennis-elo-private-20261019-1074',
   targetPlayers:1074,rosterFrozen:valid,runs,byTour:cohorts,rightsAndPrivacy:policy,
   projectPrivateStatus:'NOT_ATTESTED_BY_THIS_ENDPOINT',
   restrictedImportAllowed:policy.every(p=>p.activation_state==='PRIVATE_IMPORT_ALLOWED')&&valid,
   imagesImportedByThisPhase:0},valid?200:409);
 }catch{return send({ok:false,reason:'PRIVATE_ROSTER_SCHEMA_OR_DATA_UNAVAILABLE'},503);}
}
