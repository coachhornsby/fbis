import {authorizeStrategyPost} from "../lib/auth.js";
import {tier3ShadowProjection,pairedTier3ShadowAudit,TIER3_SHADOW_VERSION} from "../lib/cfbTier3EpaShadow.js";
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const query=async(db,sql)=>{if(!db?.prepare)throw Error("PRIVATE_SPORT_DB_UNBOUND");const r=await db.prepare(sql).all();if(!Array.isArray(r?.results))throw Error("READ_FAILED");return r.results;};
export async function onRequestGet({request,env}) {
 if(!authorizeStrategyPost(request,env).ok)return reply({ok:false,error:"unauthorized"},401);
 try{
  const raw=await query(env.TIER3_DB,`SELECT g.game_id gameId,g.identity_status identityStatus,
   g.home_canonical_id homeCanonicalId,g.away_canonical_id awayCanonicalId,
   g.kickoff_literal kickoff,s.received_at receivedAt,s.snapshot_id snapshotId,
   json_extract(g.features_json,'$.home_adjusted_passing_epa') homePassOff,
   json_extract(g.features_json,'$.home_adjusted_rushing_epa') homeRushOff,
   json_extract(g.features_json,'$.away_adjusted_passing_epa') awayPassOff,
   json_extract(g.features_json,'$.away_adjusted_rushing_epa') awayRushOff,
   json_extract(g.features_json,'$.home_adjusted_passing_epa_allowed') homePassDef,
   json_extract(g.features_json,'$.home_adjusted_rushing_epa_allowed') homeRushDef,
   json_extract(g.features_json,'$.away_adjusted_passing_epa_allowed') awayPassDef,
   json_extract(g.features_json,'$.away_adjusted_rushing_epa_allowed') awayRushDef
   FROM cfb_tier3_training_games g JOIN cfb_tier3_training_snapshots s USING(snapshot_id)
   WHERE g.season=2026 AND s.received_at<g.kickoff_literal
    AND g.authority='research_only' AND s.status='research_only'
    AND s.can_influence_projection=0 AND s.can_authorize_wager=0
   ORDER BY s.received_at DESC LIMIT 300`);
  if(raw.length>300)throw Error("TIER3_COHORT_TRUNCATED");
  const snapshots=await query(env.CFB_DB,`SELECT game_id gameId,id baselineSnapshotId,proj_home baselineHome,
    proj_away baselineAway,frozen_at baselineFrozenAt
    FROM prediction_snapshots WHERE sport='cfb' AND model_version='CFB-FBIS-v2'
    AND projection_kind='FBIS' AND proj_home IS NOT NULL AND proj_away IS NOT NULL
    AND frozen_at<'2026-12-31T23:59:59Z'
    ORDER BY frozen_at DESC LIMIT 5000`);
  if(snapshots.length===5000)throw Error("BASELINE_COHORT_TRUNCATED");
  const byId=new Map();
  for(const s of snapshots){const k=String(s.gameId);if(!byId.has(k))byId.set(k,[]);byId.get(k).push(s);}
  const results=raw.map(r=>{
   const b=(byId.get(String(r.gameId))||[]).find(x=>Date.parse(x.baselineFrozenAt)<Date.parse(r.kickoff));
   return tier3ShadowProjection({...r,...b,baselineSnapshotId:b?.baselineSnapshotId});
  });
  const accepted=results.filter(x=>x.ok);
  const rejected={};for(const x of results)if(!x.ok)rejected[x.reason]=(rejected[x.reason]||0)+1;
  const finals=await query(env.CFB_DB,`SELECT game_id gameId,actual_home home,actual_away away,
    verified_against_game verified FROM cfb_drive_verified_games WHERE verified_against_game=1
    AND period_scope='REGULATION_ONLY' LIMIT 1000`);
  const report=pairedTier3ShadowAudit(accepted,finals.map(x=>({...x,verified:x.verified===1})));
  return reply({ok:true,version:TIER3_SHADOW_VERSION,source:"CFBD_TIER3_RECEIPT",
    sourceClock:"FBIS_RECEIPT_ONLY",candidateRows:raw.length,eligible:accepted.length,rejected,
    paired:report,claim:"UNTRAINED_FEATURE_ABLATION_HYPOTHESES_NOT_PREDICTIVE_VALIDATION",
    canQualify:false,canAuthorizeWager:false,changesProductionChampion:false,providerCalls:0});
 }catch(e){return reply({ok:false,error:String(e.message||e).slice(0,100),canAuthorizeWager:false},503)}
}
