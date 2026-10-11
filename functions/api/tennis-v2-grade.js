import { authorizeHarvest, unauthorizedBody } from '../lib/auth.js';
import { evaluateTennisSettlement } from '../lib/tennisSettlementEvidence.js';

const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const bounded = (v,fallback,max) => Number.isFinite(Number(v))?Math.max(1,Math.min(max,Math.floor(Number(v)))):fallback;

// Only an explicitly linked OFFICIAL match can settle a decision. Provider or
// athlete names submitted in the request never establish a winner or event.
async function officialMatch(db,d) {
  const matches=(await db.prepare(`SELECT m.* FROM tennis_official_matches m
    WHERE m.match_id=? OR m.match_id IN (
      SELECT canonical_event_id FROM action_event_identity_links
      WHERE match_confidence='EXACT' AND
      (canonical_event_id=? OR (provider_event_id=? AND lower(sport)=?)))`)
    .bind(d.canonical_event_id,d.canonical_event_id,
      String(d.canonical_event_id||'').replace(/^tennis:action:/,''),String(d.tour||'').toLowerCase()).all()).results||[];
  return matches.length===1?matches[0]:null;
}
async function closingMarkets(db,d) {
  return (await db.prepare(`SELECT id,canonical_event_id,tour,player1,player2,market_type,
      player1_no_vig_prob,observed_at,collected_at,snapshot_type
    FROM tennis_market_snapshots
    WHERE canonical_event_id=? AND market_type='moneyline'
      AND observed_at>=? AND observed_at<? AND collected_at<?
    ORDER BY observed_at DESC LIMIT 40`).bind(d.canonical_event_id,
      d.decision_timestamp,d.event_start_time,d.event_start_time).all()).results||[];
}

export async function onRequestPost(context) {
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:'database unavailable'},503);
  const body=await context.request.json().catch(()=>({}));
  if(body.mode!=='official' || body.results!==undefined || body.winner!==undefined)
    return json({ok:false,error:'only mode=official supports source-verified settlement; submitted winners are rejected'},400);
  const eventIds=Array.isArray(body.eventIds)?body.eventIds.filter(x=>typeof x==='string'&&x.length&&x.length<=160).slice(0,100):[];
  const limit=bounded(body.limit,100,200);
  const minEdge=Number.isFinite(Number(body.minEdge))?Math.max(0,Math.min(.25,Number(body.minEdge))):.02;
  const db=context.env.DB;
  let graded=0,blocked=0,unpriced=0,clvMissing=0;
  const details=[];
  try {
    const res=await db.prepare(`SELECT * FROM tennis_v2_research_decisions
      WHERE graded_at IS NULL AND event_start_time IS NOT NULL
        AND event_start_time < ? AND can_qualify=0 AND can_authorize_wager=0
      ORDER BY event_start_time ASC LIMIT ?`).bind(new Date().toISOString(),limit).all();
    for(const d of res?.results||[]) {
      if(eventIds.length && !eventIds.includes(d.canonical_event_id))continue;
      let event,closings;
      try {event=await officialMatch(db,d);closings=event?await closingMarkets(db,d):[];}
      catch(e){blocked++;details.push({decisionId:d.id,reason:'OFFICIAL_EVIDENCE_QUERY_FAILED'});continue;}
      const grade=evaluateTennisSettlement(d,event,closings,{minEdge});
      if(!grade.eligible){blocked++;details.push({decisionId:d.id,eventId:d.canonical_event_id,reason:grade.reason});continue;}
      // Research-only: guard state at write time and do not touch frozen model evidence.
      const update=await db.prepare(`UPDATE tennis_v2_research_decisions
        SET result_winner=?,closing_p1_no_vig=?,clv=?,profit_units=?,graded_at=?
        WHERE id=? AND graded_at IS NULL AND can_qualify=0 AND can_authorize_wager=0`)
        .bind(grade.winner,grade.closingP1,grade.clv,grade.profitUnits,new Date().toISOString(),d.id).run();
      if(Number(update?.meta?.changes??update?.changes??0)!==1){blocked++;details.push({decisionId:d.id,reason:'GRADE_NOT_COMMITTED'});continue;}
      graded++;if(grade.price==null)unpriced++;if(grade.clv==null)clvMissing++;
      details.push({decisionId:d.id,eventId:d.canonical_event_id,officialMatchId:grade.resultEvidence,
        selected:grade.selectedP1===null?'PASS':(grade.selectedP1?d.player1:d.player2),
        outcome:grade.winner,clv:grade.clv,profitUnits:grade.profitUnits,
        closingSnapshotId:grade.marketEvidence});
    }
    return json({ok:true,mode:'official',graded,blocked,unpriced,clvMissing,details,
      governance:{researchOnly:true,canQualify:false,canAuthorizeWager:false,bet:false}});
  }catch(e){return json({ok:false,error:String(e?.message||e)},500);}
}
