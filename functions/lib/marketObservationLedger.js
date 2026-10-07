import { normalizeMarketOffer, priceMarketOffer } from "./normalizedMarket.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const bit=v=>v==null?null:(v?1:0);
async function digest(v){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(v)));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}

export async function persistNormalizedMarketObservation(db,input,{modelProbability=null,pairedAmericanOdds=null,snapshotType="CURRENT",modelId=null,modelVersion=null,collectedAt=null}={}){
 if(!db?.prepare)return {inserted:false,reason:"database-unavailable"};
 const o=priceMarketOffer(normalizeMarketOffer(input),{modelProbability,pairedAmericanOdds});
 const collected=collectedAt||new Date().toISOString(), observed=o.fetchedAt||null;
 const natural=[o.source,o.sourceType,o.sport,o.eventId,o.playerId||o.playerName,o.marketFamily,o.statFamily,o.side,o.line,o.americanOdds,o.contractPrice,o.payoutMultiplier,o.sourceMarketId,o.sourceOutcomeId,observed,collected].join("|");
 const h=await digest(natural),id="nmo_"+h.slice(0,28),raw=JSON.stringify(o.raw??null),rawHash=await digest(raw);
 const res=await db.prepare(`INSERT OR IGNORE INTO normalized_market_observations(
 id,observation_key,source,source_type,sport,league,canonical_event_id,provider_event_id,event_start_time,home_team,away_team,
 canonical_player_id,provider_player_id,player_name,team,opponent,market_family,stat_family,side,line,american_odds,decimal_odds,
 contract_price,payout_multiplier,standard_or_alt,promo,period,source_market_id,source_outcome_id,source_observed_at,collected_at,
 snapshot_type,model_id,model_version,model_probability,fair_american_price,raw_implied_probability,no_vig_market_probability,
 probability_edge,expected_return_per_unit_risk,execution_eligible,decision_eligible,can_qualify,can_authorize_wager,
 raw_payload_json,raw_payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,?,?)`)
 .bind(id,h,o.source,o.sourceType,o.sport,o.league,o.eventId,o.raw?.providerEventId||o.eventId,o.eventStart,o.homeTeam,o.awayTeam,
 o.playerId,o.raw?.providerPlayerId||o.playerId,o.playerName,o.team,o.opponent,o.marketFamily,o.statFamily,o.side,finite(o.line),finite(o.americanOdds),finite(o.decimalOdds),
 finite(o.contractPrice),finite(o.payoutMultiplier),o.standardOrAlt,bit(o.promo),o.period,o.sourceMarketId,o.sourceOutcomeId,observed,collected,
 snapshotType,modelId,modelVersion,finite(o.modelProbability),finite(o.fairAmericanPrice),finite(o.rawImpliedProbability),finite(o.noVigMarketProbability),
 finite(o.probabilityEdge),finite(o.expectedReturnPerUnitRisk),bit(o.executionEligible),raw,rawHash,collected).run();
 return {inserted:Number(res?.meta?.changes||res?.changes||0)>0,id,observation:o};
}
export async function persistNormalizedMarketBatch(db,offers=[],opts={}){
 let inserted=0;const ids=[];for(const o of offers){const r=await persistNormalizedMarketObservation(db,o,opts);inserted+=r.inserted?1:0;ids.push(r.id)}
 return {attempted:offers.length,inserted,ids};
}
export async function linkMarketDecision(db,{decisionId,observationId,role="ENTRY",decisionTimestamp}={}){
 if(!db?.prepare||!decisionId||!observationId||!decisionTimestamp)return {inserted:false};
 const h=await digest([decisionId,observationId,role].join("|")),id="nmdl_"+h.slice(0,28);
 const r=await db.prepare(`INSERT OR IGNORE INTO normalized_market_decision_links(id,decision_id,observation_id,role,decision_timestamp,created_at) VALUES(?,?,?,?,?,?)`)
 .bind(id,decisionId,observationId,String(role).toUpperCase(),decisionTimestamp,new Date().toISOString()).run();
 return {inserted:Number(r?.meta?.changes||r?.changes||0)>0,id};
}
export async function latestVenueOffers(db,{sport,eventId,limit=100}={}){
 if(!db?.prepare||!sport||!eventId)return [];
 const q=await db.prepare(`WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source,market_family,coalesce(stat_family,''),coalesce(player_name,''),coalesce(side,''),coalesce(line,-999999) ORDER BY collected_at DESC,created_at DESC) rn FROM normalized_market_observations WHERE sport=? AND canonical_event_id=?) SELECT * FROM ranked WHERE rn=1 ORDER BY market_family,source,player_name,side LIMIT ?`)
 .bind(sport,eventId,Math.max(1,Math.min(500,Number(limit)||100))).all().catch(()=>({results:[]}));
 return q?.results||[];
}
