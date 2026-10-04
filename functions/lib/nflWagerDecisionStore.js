import { NFL_WAGER_DECISION_VERSION } from "./nflWagerDecision.js";

function safe(v){return v==null?null:JSON.stringify(v);}
function keyPart(v){return String(v??"").replace(/[^a-zA-Z0-9._:-]/g,"_").slice(0,120);}

export async function persistNflWagerDecisionSnapshot(db,game={}){
  if(!db?.prepare)return{ok:false,reason:"db-unavailable",inserted:0};
  const packet=game.nflWagerDecision;
  const eventId=String(game.id||game.eventId||game.gameId||"");
  if(!eventId||!packet?.ok)return{ok:false,reason:"decision-unavailable",inserted:0};
  const evaluatedAt=packet.wagerIntelligence?.current?.observedAt||game.market?.observedAt||new Date().toISOString();
  let inserted=0;
  for(const c of packet.candidates||[]){
    if(c.line==null||c.americanPrice==null)continue;
    const id=[
      "nflwd",keyPart(eventId),keyPart(c.market),keyPart(c.selection),
      keyPart(c.book||"market"),keyPart(evaluatedAt),keyPart(c.line),keyPart(c.americanPrice)
    ].join(":");
    try{
      const res=await db.prepare(
        `INSERT OR IGNORE INTO nfl_wager_decisions
        (id,event_id,sport,evaluated_at,model_id,model_version,decision_version,
         market_type,selection,sportsbook,offered_line,american_price,
         break_even_probability,model_probability,probability_edge,
         expected_value_per_unit_risk,uncertainty_sigma,raw_confidence_score,
         confidence_score,confidence_validated,decision,stake_units,
         projection_json,decomposition_json,wager_intelligence_json,reasons_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id,eventId,"nfl",evaluatedAt,packet.modelId||null,packet.modelVersion||null,
        packet.version||NFL_WAGER_DECISION_VERSION,c.market,c.selection,c.book||null,
        c.line,c.americanPrice,c.breakEvenProbability,c.probability,c.probabilityEdge,
        c.expectedValuePerUnitRisk,c.uncertaintySigma,c.rawConfidenceScore,
        c.confidenceScore,c.confidenceValidated?1:0,c.decision,c.stakeUnits,
        safe(packet.independentProjection),safe(packet.decomposition),
        safe(packet.wagerIntelligence),safe(c.reasons||[])
      ).run();
      inserted+=Number(res?.meta?.changes||0);
    }catch(err){
      if(!String(err?.message||err).includes("no such table"))return{ok:false,reason:String(err?.message||err),inserted};
    }
  }
  return{ok:true,inserted,evaluatedAt};
}

export async function persistNflWagerDecisionSnapshots(db,games=[]){
  let inserted=0,attempted=0;
  for(const game of games||[]){
    if(String(game?.sport||"").toLowerCase()!=="nfl")continue;
    attempted+=1;
    const r=await persistNflWagerDecisionSnapshot(db,game);
    inserted+=Number(r.inserted||0);
  }
  return{ok:true,attempted,inserted};
}
