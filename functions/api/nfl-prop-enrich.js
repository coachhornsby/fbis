import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { canonicalizeProPlayerPropMarket } from "../lib/proPlayerProps.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
}
function norm(v){
  return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function key(player,market){return norm(player)+"|"+String(market||"").toLowerCase();}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}

export async function onRequest(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  if(context.request.method!=="POST")return json({ok:false,error:"method-not-allowed"},405);
  if(!context.env?.DB)return json({ok:false,error:"database-unavailable"},503);

  const url=new URL(context.request.url);
  const resolved=resolveSlateDate(url.searchParams.get("date")||"",{maxPast:2,maxFuture:3});
  if(!resolved.ok)return json({ok:false,error:resolved.error},400);

  const env={
    PARLAY_API_KEY:context.env.PARLAY_API_KEY,
    THEODDS_API_KEY:context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
    DB:context.env.DB,
    ARCHIVE:context.env.ARCHIVE,
    caches:caches.default,
    parlayCacheOnly:true,
    cfbdScheduleFallback:false,
  };

  const slate=await buildSlate("nfl",resolved.date,env);
  const candidates=new Map();
  for(const game of slate.games||[]){
    for(const p of game.playerProjectionRows||[]){
      const market=canonicalizeProPlayerPropMarket("nfl",p.market)||p.market;
      if(!p.playerName||!market||p.fbisProjection==null)continue;
      const k=key(p.playerName,market);
      if(!candidates.has(k))candidates.set(k,{
        eventId:String(game.id||game.eventId||""),
        projection:finite(p.fbisProjection),
        sigma:finite(p.fbisSigma),
        roleConfidence:finite(p.roleConfidence),
        snapShare:finite(p.snapShare),
        propGate:String(p.propGate||"CLEAR").toUpperCase(),
        eligibleForCard:p.eligibleForCard!==false,
        featureEvidence:p.featureEvidence||null,
        source:p.source||null,
        modelVersion:game.playerProjectionStatus?.version||game.playerProjectionStatus?.model||null,
      });
    }
  }

  const rows=(await context.env.DB.prepare(
    "SELECT id,player_name,canonical_market,stat_type,line FROM prizepicks_prop_lines WHERE run_id IN (SELECT run_id FROM prizepicks_daily_acquisitions WHERE state='COMPLETE') AND julianday(collected_at) BETWEEN julianday('now','-24 hours') AND julianday('now') AND lower(sport)='nfl' AND substr(start_time,1,10)=?"
  ).bind(resolved.date).all())?.results||[];

  // Fail closed: erase prior model enrichment for this slate before attaching the
  // current target-role model. A player who lost QB1/RB1/WR1/WR2/TE1 status
  // must never retain a stale projection from an earlier run.
  await context.env.DB.prepare(
    "UPDATE prizepicks_prop_lines SET fbis_projection=NULL,fbis_sigma=NULL,delta_fbis_minus_line=NULL,candidate_side=NULL,role_confidence=NULL,snap_share=NULL,prop_gate=NULL,eligible_for_card=NULL,feature_evidence_json=NULL,model_source=NULL,model_version=NULL WHERE lower(sport)='nfl' AND substr(start_time,1,10)=?"
  ).bind(resolved.date).run();

  const statements=[];
  let matched=0;
  for(const row of rows){
    const market=canonicalizeProPlayerPropMarket("nfl",row.canonical_market||row.stat_type)||row.canonical_market||row.stat_type;
    const c=candidates.get(key(row.player_name,market));
    if(!c||c.projection==null)continue;
    const line=finite(row.line);
    const delta=line==null?null:c.projection-line;
    const side=delta==null||Math.abs(delta)<1e-9?null:(delta>0?"MORE":"LESS");
    statements.push(context.env.DB.prepare(
      "UPDATE prizepicks_prop_lines SET fbis_event_id=?,fbis_projection=?,fbis_sigma=?,delta_fbis_minus_line=?,candidate_side=?,role_confidence=?,snap_share=?,prop_gate=?,eligible_for_card=?,feature_evidence_json=?,model_source=?,model_version=? WHERE id=?"
    ).bind(
      c.eventId||null,c.projection,c.sigma,delta,side,
      c.roleConfidence,c.snapShare,c.propGate,c.eligibleForCard?1:0,
      c.featureEvidence?JSON.stringify(c.featureEvidence):null,
      c.source,c.modelVersion,row.id
    ));
    matched++;
  }

  let updated=0;
  for(let i=0;i<statements.length;i+=200){
    const res=await context.env.DB.batch(statements.slice(i,i+200));
    updated+=res.reduce((n,x)=>n+Number(x?.meta?.changes||0),0);
  }

  return json({
    ok:true,date:resolved.date,games:(slate.games||[]).length,
    playerProjectionCandidates:candidates.size,
    nflPrizePicksRows:rows.length,matched,updated,
  });
}
