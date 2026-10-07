import { persistNormalizedMarketObservation } from "./marketObservationLedger.js";
import { normalizeMarketOffer, MARKET_SOURCE_TYPE } from "./normalizedMarket.js";
import { buildSharpMarketPrior, tennisMarketResidualProjection, americanToProb } from "./tennisMarketV2.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const safe=v=>{if(v==null)return null;if(typeof v==="object")return v;try{return JSON.parse(v)}catch{return null}};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

async function hash(text){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
export function noVigAmerican(a,b){
  const pa=americanToProb(a),pb=americanToProb(b);if(pa==null||pb==null)return null;
  const z=pa+pb;if(!(z>0))return null;return {p1:pa/z,p2:pb/z,hold:z-1};
}
function actionBase(row,home,away){
  return {
    canonicalEventId:row.fbis_event_id||`tennis:action:${row.action_game_id}`,
    providerEventId:String(row.action_game_id||""),
    tour:String(row.sport||row.league||"").toLowerCase(),
    player1:home,player2:away,provider:"ACTION_APIFY",sportsbook:"consensus",
    observedAt:row.source_observed_at||row.observed_at||row.collected_at||row.created_at,
    collectedAt:row.collected_at||row.created_at,eventStartTime:row.start_time||null,
    rawPayloadHash:row.raw_payload_hash||null,
  };
}
function splitFields(node={}){
  return {
    publicTicketPct:finite(node.ticketsPercent??node.ticketPercent),
    publicMoneyPct:finite(node.moneyPercent),
    moneyMinusTicketPct:finite(node.moneyMinusTickets??node.moneyTicketGap??node.sharpGap),
  };
}
export function actionObservationToTennisMarkets(row={}){
  const consensus=safe(row.consensus_json)||{},quality=safe(row.market_quality_json)||{};
  const publicBetting=safe(row.public_betting_json)||{},movement=safe(row.line_movement_json)||{};
  const home=String(row.home_team||"").trim(),away=String(row.away_team||"").trim();
  if(!home||!away)return [];
  const base=actionBase(row,home,away),out=[];

  const p1Price=finite(consensus.moneylineHome),p2Price=finite(consensus.moneylineAway);
  const nvMlHome=finite(quality?.noVig?.moneylineHome),nvMlAway=finite(quality?.noVig?.moneylineAway);
  const nvMl=nvMlHome!=null&&nvMlAway!=null?{p1:nvMlHome,p2:nvMlAway,hold:null}:noVigAmerican(p1Price,p2Price);
  if(nvMl)out.push({...base,marketType:"moneyline",player1Price:p1Price,player2Price:p2Price,
    player1NoVig:nvMl.p1,player2NoVig:nvMl.p2,hold:nvMl.hold,...splitFields(publicBetting.moneylineHome||{}),
    lineMovement:movement,publicBetting,marketPayload:{consensus,quality}});

  const p1Line=finite(consensus.spreadHome),p2Line=finite(consensus.spreadAway);
  const p1SpreadPrice=finite(consensus.spreadHomeOdds),p2SpreadPrice=finite(consensus.spreadAwayOdds);
  const nvSpHome=finite(quality?.noVig?.spreadHome),nvSpAway=finite(quality?.noVig?.spreadAway);
  const nvSp=nvSpHome!=null&&nvSpAway!=null?{p1:nvSpHome,p2:nvSpAway,hold:null}:noVigAmerican(p1SpreadPrice,p2SpreadPrice);
  if(p1Line!=null&&(p1SpreadPrice!=null||p2SpreadPrice!=null))out.push({...base,marketType:"spread",
    player1Line:p1Line,player2Line:p2Line??-p1Line,player1Price:p1SpreadPrice,player2Price:p2SpreadPrice,
    player1NoVig:nvSp?.p1??null,player2NoVig:nvSp?.p2??null,hold:nvSp?.hold??null,
    ...splitFields(publicBetting.spreadHome||{}),lineMovement:movement,publicBetting,marketPayload:{consensus,quality}});

  const total=finite(consensus.total),overPrice=finite(consensus.overOdds),underPrice=finite(consensus.underOdds);
  const nvOver=finite(quality?.noVig?.over),nvUnder=finite(quality?.noVig?.under);
  const nvTot=nvOver!=null&&nvUnder!=null?{p1:nvOver,p2:nvUnder,hold:null}:noVigAmerican(overPrice,underPrice);
  if(total!=null&&(overPrice!=null||underPrice!=null))out.push({...base,marketType:"total",
    player1Line:total,player2Line:total,overPrice,underPrice,overNoVig:nvTot?.p1??null,underNoVig:nvTot?.p2??null,
    hold:nvTot?.hold??null,...splitFields(publicBetting.over||{}),lineMovement:movement,publicBetting,
    marketPayload:{consensus,quality}});
  return out;
}
export function actionObservationToTennisMarket(row={}){
  return actionObservationToTennisMarkets(row).find(x=>x.marketType==="moneyline")||null;
}

export async function persistTennisVenueOffer(db,m={}){
 const marketType=String(m.marketType||"moneyline").toLowerCase(),collectedAt=m.collectedAt||new Date().toISOString();
 const base={source:String(m.sportsbook||m.provider||"unknown").toLowerCase(),sourceType:MARKET_SOURCE_TYPE.SPORTSBOOK,
  sport:"tennis",league:m.tour||"tennis",eventId:m.canonicalEventId,eventStart:m.eventStartTime,homeTeam:m.player1,awayTeam:m.player2,
  marketFamily:marketType,period:"full_game",fetchedAt:m.observedAt||collectedAt,executionEligible:false,
  raw:{provider:m.provider||null,providerEventId:m.providerEventId||null,marketPayload:m.marketPayload||null}};
 const rows=[];
 if(marketType==="moneyline"){
   rows.push({...base,side:"home",team:m.player1,americanOdds:m.player1Price},{...base,side:"away",team:m.player2,americanOdds:m.player2Price});
 }else if(marketType==="spread"){
   rows.push({...base,side:"home",team:m.player1,line:m.player1Line,americanOdds:m.player1Price},{...base,side:"away",team:m.player2,line:m.player2Line,americanOdds:m.player2Price});
 }else if(marketType==="total"){
   rows.push({...base,side:"over",line:m.player1Line,americanOdds:m.overPrice},{...base,side:"under",line:m.player1Line,americanOdds:m.underPrice});
 }
 const valid=rows.filter(x=>x.americanOdds!=null||x.line!=null);
 const ids=[];for(const row of valid){const paired=row.side==="home"?m.player2Price:row.side==="away"?m.player1Price:row.side==="over"?m.underPrice:m.overPrice;
   const r=await persistNormalizedMarketObservation(db,normalizeMarketOffer(row),{pairedAmericanOdds:paired,snapshotType:m.snapshotType||"CURRENT",collectedAt});ids.push(r.id)}
 return {inserted:ids.length,ids};
}

export async function persistTennisMarketSnapshot(db,m={}){
  if(!db?.prepare||!m?.canonicalEventId)return {inserted:false};
  const marketType=String(m.marketType||"moneyline").toLowerCase();
  const key=[m.canonicalEventId,marketType,m.provider,m.sportsbook,m.observedAt,m.player1Line,m.player2Line,m.player1Price,m.player2Price,m.overPrice,m.underPrice].join("|");
  const h=await hash(key),id=`tms_${h.slice(0,28)}`;
  const res=await db.prepare(
    `INSERT OR IGNORE INTO tennis_market_snapshots(
      id,canonical_event_id,tour,player1,player2,market_type,provider,sportsbook,
      player1_price,player2_price,player1_no_vig_prob,player2_no_vig_prob,hold,
      observed_at,collected_at,event_start_time,snapshot_type,traded_volume,public_ticket_pct,public_money_pct,
      money_minus_ticket_pct,line_velocity,raw_payload_hash,decision_eligible,can_qualify,
      can_authorize_wager,created_at,player1_line,player2_line,over_price,under_price,
      over_no_vig_prob,under_no_vig_prob,market_payload_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,?,?,?,?,?,?,?)`
  ).bind(
    id,m.canonicalEventId,m.tour||"tennis",m.player1,m.player2,marketType,m.provider||"UNKNOWN",m.sportsbook||null,
    finite(m.player1Price),finite(m.player2Price),finite(m.player1NoVig),finite(m.player2NoVig),finite(m.hold),
    m.observedAt||new Date().toISOString(),m.collectedAt||new Date().toISOString(),m.eventStartTime||null,m.snapshotType||"CURRENT",
    finite(m.tradedVolume),finite(m.publicTicketPct),finite(m.publicMoneyPct),finite(m.moneyMinusTicketPct),
    finite(m.lineVelocity),m.rawPayloadHash||null,new Date().toISOString(),finite(m.player1Line),finite(m.player2Line),
    finite(m.overPrice),finite(m.underPrice),finite(m.overNoVig),finite(m.underNoVig),JSON.stringify(m.marketPayload||null)
  ).run();
  const inserted=Number(res?.meta?.changes||res?.changes||0)>0;
  await persistTennisVenueOffer(db,m).catch(()=>null);
  return {inserted,id};
}

export async function persistTennisContexts(db,{eventId,tour,players=[],contexts=[],source="FBIS_CONTEXT"}={}){
  if(!db?.prepare)return 0;let inserted=0;
  for(let i=0;i<Math.min(players.length,contexts.length);i++){
    const p=players[i]||{},c=contexts[i]||{},cutoff=c.sourceAsOf||new Date().toISOString();
    const h=await hash([eventId,p.id||p.name,cutoff,source,JSON.stringify(c)].join("|"));
    const res=await db.prepare(
      `INSERT OR IGNORE INTO tennis_context_snapshots(
        id,canonical_event_id,canonical_player_id,player_name,tour,tournament,surface,indoor,altitude_m,
        court_speed_index,hours_since_last_match,minutes_last_3_days,minutes_last_7_days,
        games_last_3_days,games_last_7_days,sets_last_3_days,sets_last_7_days,travel_km_7_days,
        time_zones_crossed_7_days,injury_status,days_since_injury_return,days_since_retirement_or_mto,
        recent_serve_speed_delta_kph,serve_style_score,return_style_score,source,source_as_of,collected_at,
        feature_cutoff_timestamp,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      `tcs_${h.slice(0,28)}`,eventId,p.id?String(p.id):null,p.name||"",tour||"tennis",
      c.tournament||null,c.surface||null,c.indoor==null?null:(c.indoor?1:0),finite(c.altitudeM),
      finite(c.courtSpeedIndex),finite(c.hoursSinceLastMatch),finite(c.minutesLast3Days),finite(c.minutesLast7Days),
      finite(c.gamesLast3Days),finite(c.gamesLast7Days),finite(c.setsLast3Days),finite(c.setsLast7Days),
      finite(c.travelKm7Days),finite(c.timeZonesCrossed7Days),c.injuryStatus||null,finite(c.daysSinceInjuryReturn),
      finite(c.daysSinceRetirementOrMto),finite(c.recentServeSpeedDeltaKph),finite(c.serveStyleScore),
      finite(c.returnStyleScore),source,c.sourceAsOf||null,new Date().toISOString(),cutoff,new Date().toISOString()
    ).run();
    inserted+=Number(res?.meta?.changes||res?.changes||0)>0?1:0;
  }
  return inserted;
}
export async function persistTennisV2Decision(db,{eventId,tour,player1,player2,pureModelId,pureP1,market,actionIntel,context,eventStartTime,decisionTimestamp=null,snapshotType="DECISION"}={}){
  if(!db?.prepare)return {inserted:false};
  const prior=market?.p1;
  const proj=tennisMarketResidualProjection({fundamentalP1:pureP1,market,actionIntel,contextDifferential:context?.differential||0});
  if(proj.p1==null)return {inserted:false,reason:proj.reason||"projection-unavailable"};
  const ts=decisionTimestamp||new Date().toISOString();
  const h=await hash([eventId,ts,snapshotType,pureP1,prior,proj.p1].join("|"));
  const id=`tvd_${h.slice(0,28)}`;
  const res=await db.prepare(
    `INSERT OR IGNORE INTO tennis_v2_research_decisions(
      id,canonical_event_id,tour,player1,player2,pure_model_id,market_model_id,pure_p1,market_prior_p1,
      market_v2_p1,market_residual,model_edge,context_json,action_json,market_json,decision_timestamp,
      event_start_time,snapshot_type,decision_eligible,can_qualify,can_authorize_wager,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`
  ).bind(
    id,eventId,tour,player1,player2,pureModelId||"TENNIS-FBIS-v2-CONTEXT",proj.modelId,pureP1,prior,proj.p1,
    proj.marketResidual,proj.p1-prior,JSON.stringify(context||null),JSON.stringify(proj.action||actionIntel||null),
    JSON.stringify(market||null),ts,eventStartTime||null,snapshotType,ts
  ).run();
  return {inserted:Number(res?.meta?.changes||res?.changes||0)>0,id,projection:proj};
}
function payout(price){
  const o=finite(price);if(o==null||o===0)return null;return o>0?o/100:100/Math.abs(o);
}
export function profitUnits({selectedP1,wonP1,price}={}){
  const pay=payout(price);if(pay==null)return null;
  return Boolean(selectedP1)===Boolean(wonP1)?pay:-1;
}
export function buildTennisV2Validation(rows=[]){
  const graded=rows.filter(r=>r.graded_at!=null);
  const withClv=graded.filter(r=>finite(r.clv)!=null);
  const withUnits=graded.filter(r=>finite(r.profit_units)!=null);
  const positiveClv=withClv.filter(r=>Number(r.clv)>0).length;
  const units=withUnits.reduce((s,r)=>s+Number(r.profit_units),0);
  const roi=withUnits.length?units/withUnits.length:null;
  const byTour={};
  for(const tour of ["atp","wta"]){
    const rr=withUnits.filter(r=>String(r.tour).toLowerCase()===tour);
    byTour[tour]={n:rr.length,units:rr.reduce((s,r)=>s+Number(r.profit_units),0),roi:rr.length?rr.reduce((s,r)=>s+Number(r.profit_units),0)/rr.length:null};
  }
  return {
    n:rows.length,graded:graded.length,clvN:withClv.length,positiveClvRate:withClv.length?positiveClv/withClv.length:null,
    betN:withUnits.length,units,roi,byTour,
    gates:{
      minimumProspectiveN:500,
      enoughSample:withUnits.length>=500,
      positiveClv:withClv.length>=200&&positiveClv/withClv.length>.52,
      positiveRoi:withUnits.length>=500&&roi>0,
      canAuthorizeWager:false,
    },
    status:withUnits.length>=500&&roi>0&&withClv.length>=200&&positiveClv/withClv.length>.52?"PROMOTION_REVIEW":"RESEARCH_ONLY"
  };
}
