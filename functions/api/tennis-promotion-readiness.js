// Read-only Tennis v2 prospective promotion certificate.
// Fail closed: actual official results, source rights, priced economic evidence,
// tour coverage and formal release approval must ALL pass before a wager cutover.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const finite=x=>x!=null&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const validDate=v=>Number.isFinite(Date.parse(v||''));
export function classifyTennisPromotion(rows=[],licenses=[],economic=[],{
 now=new Date(),minGradedPerTour=200,minEconomicPerTour=100
}={}){
 const sample={atp:[],wta:[]},counts={atp:{snapshots:0},wta:{snapshots:0}};
 const out={missingOutcome:0,afterStartSnapshot:0,unverifiedSource:0,unmatchedPlayerIdentity:0,duplicateEvent:0};
 for(const row of rows){
  if(!sample[row.tour])continue;
  counts[row.tour].snapshots++;
  if(!validDate(row.decision_timestamp)||!validDate(row.event_start_time)||
   Date.parse(row.decision_timestamp)>=Date.parse(row.event_start_time)||
   Date.parse(row.event_start_time)>+now){out.afterStartSnapshot++;continue}
  const v=finite(row.pure_p1);
  if(!(v>0&&v<1)){out.unverifiedSource++;continue}
  if(row.source!==(row.tour==='wta'?'WTA_OFFICIAL':'ATP_OFFICIAL')||
     row.completion_state!=='FINAL'||row.result_reason!=='OFFICIAL_COMPLETED_SETS'||
     !String(row.raw_artifact_key||'').startsWith('tennis/wta/official-results/raw/')||
     !row.source_winner_id||!row.winner_id){out.missingOutcome++;continue}
  const p1=row.canonical_p1,p2=row.canonical_p2;
  if(!p1||!p2||row.player1!==p1||row.player2!==p2||
     !validDate(row.graded_at)||row.result_winner!==(row.winner_id===row.player1_id?p1:
     row.winner_id===row.player2_id?p2:null)){
   out.unmatchedPlayerIdentity++;continue
  }
  const actual=row.winner_id===row.player1_id?1:row.winner_id===row.player2_id?0:null;
  if(actual===null){out.unmatchedPlayerIdentity++;continue}
  const p=Math.min(.999999,Math.max(.000001,v));
  sample[row.tour].push({brier:(p-actual)**2,
   logLoss:-(actual*Math.log(p)+(1-actual)*Math.log(1-p)),
   hit:Number((p>=.5?1:0)===actual)});
 }
 const cohorts={};
 for(const tour of ['atp','wta']){
  const s=sample[tour];
  const market=economic.find(e=>e.tour===tour)||{};
  const clv=Number(market.clvRows||0),profit=Number(market.profitRows||0);
  const priced=clv>=minEconomicPerTour&&profit>=minEconomicPerTour&&
    Number(market.positiveClvRate)>.52&&Number(market.roi)>0;
  cohorts[tour]={
   pregameSnapshots:counts[tour].snapshots,verifiedSettledMatches:s.length,
   prospectiveSampleRequired:minGradedPerTour,
   matchBrier:mean(s.map(x=>x.brier)),matchLogLoss:mean(s.map(x=>x.logLoss)),
   winnerAccuracy:mean(s.map(x=>x.hit)),
   economicSamples:{clv,pricedResults:profit},
   sampleGate:s.length>=minGradedPerTour,economicGate:priced
  };
 }
 const restricted=licenses.filter(x=>/CC\s*BY-NC-SA|NONCOMMERCIAL|RESEARCH_ONLY/i.test(String(x.source_license||'')));
 const rightsRows=restricted.reduce((n,x)=>n+Number(x.rows||0),0);
 const profileRows=licenses.reduce((n,x)=>n+Number(x.rows||0),0);
 const gates={
  bothToursProspectiveSample:cohorts.atp.sampleGate&&cohorts.wta.sampleGate,
  bothToursPositiveProspectiveEconomics:cohorts.atp.economicGate&&cohorts.wta.economicGate,
  productionProfileRights:profileRows>0&&rightsRows===0,
  prospectiveV2CalibrationVsBenchmark:false, // independent, preregistered champion test not yet complete
  manualReleaseApproval:false,
 };
 const reasons=Object.entries(gates).filter(([,pass])=>!pass).map(([gate])=>gate);
 return {asOf:now.toISOString(),modelId:'TENNIS-FBIS-v2-CONTEXT',
  status:'SHADOW_RESEARCH',promotionReady:false,commercialWagerAuthorization:false,
  independentOfMarkets:true,cohorts,
  sourceRights:{profileRows,noncommercialRestrictedRows:rightsRows,clearedForCommercialUse:false},
  validationExclusions:out,gates,blockedReasons:reasons,
  frozenRules:{minimumGradedPerTour:minGradedPerTour,minimumEconomicPerTour:minEconomicPerTour,
   positiveClvThreshold:.52,roiMustBePositive:true},
  verifiedOutcomesOnly:true,canAuthorizeWager:false,productionWrites:0};
}
export async function buildTennisPromotionReadiness(db,now=new Date()){
 const rows=(await db.prepare(`SELECT d.canonical_event_id,d.tour,d.pure_model_id,d.pure_p1,
    d.player1,d.player2,d.decision_timestamp,d.event_start_time,d.result_winner,d.graded_at,
    m.source,m.completion_state,m.result_reason,m.raw_artifact_key,m.source_winner_id,
    m.winner_id,m.player1_id,m.player2_id,
    a.canonical_name canonical_p1,b.canonical_name canonical_p2
    FROM tennis_v2_research_decisions d
    LEFT JOIN tennis_official_matches m ON m.match_id=d.canonical_event_id
    LEFT JOIN tennis_players a ON a.fbis_player_id=m.player1_id
    LEFT JOIN tennis_players b ON b.fbis_player_id=m.player2_id
    WHERE d.snapshot_type='PURE_FIXTURE' AND d.pure_model_id='TENNIS-FBIS-v2-CONTEXT'
      AND d.id=(SELECT e.id FROM tennis_v2_research_decisions e
       WHERE e.canonical_event_id=d.canonical_event_id AND e.snapshot_type='PURE_FIXTURE'
         AND e.pure_model_id='TENNIS-FBIS-v2-CONTEXT'
       ORDER BY e.decision_timestamp ASC,e.id ASC LIMIT 1)
    ORDER BY d.decision_timestamp ASC LIMIT 2000`).all()).results||[];
 const licenses=(await db.prepare(`SELECT tour,source_license,COUNT(*) rows
  FROM tennis_player_profiles_current GROUP BY tour,source_license`).all()).results||[];
 const economic=(await db.prepare(`SELECT tour,
  SUM(CASE WHEN clv IS NOT NULL THEN 1 ELSE 0 END) clvRows,
  SUM(CASE WHEN profit_units IS NOT NULL THEN 1 ELSE 0 END) profitRows,
  CASE WHEN SUM(CASE WHEN clv IS NOT NULL THEN 1 ELSE 0 END)>0
   THEN 1.0*SUM(CASE WHEN clv>0 THEN 1 ELSE 0 END)/
       SUM(CASE WHEN clv IS NOT NULL THEN 1 ELSE 0 END) END positiveClvRate,
  CASE WHEN SUM(CASE WHEN profit_units IS NOT NULL THEN 1 ELSE 0 END)>0
   THEN AVG(CASE WHEN profit_units IS NOT NULL THEN profit_units END) END roi
  FROM tennis_v2_research_decisions WHERE snapshot_type='DECISION' GROUP BY tour`).all()).results||[];
 return classifyTennisPromotion(rows,licenses,economic,{now});
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return json({ok:false,reason:'DB_REQUIRED'},503);
 try{return json({ok:true,...await buildTennisPromotionReadiness(env.DB)})}
 catch{return json({ok:false,reason:'PROMOTION_EVIDENCE_UNAVAILABLE',canAuthorizeWager:false},503)}
}
