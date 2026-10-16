/**
 * Bounded, read-only PinnOdds → board research bridge.
 *
 * No alternative bookmaker, cached legacy odds, historical fixture rematch or
 * inferred provider clock may feed current pricing. The provider's quote time
 * is not supplied by this data feed; an FBIS collection time is NOT a quote
 * timestamp. No execution, CLV, EV or wagering eligibility is inferred.
 */
const validSport=new Set(["mlb","nfl","cfb","cbb","nba","wnba","nhl","soccer","tennis","npb","kbo"]);
const numeric=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
function freshRecord(row,clock){
 const capture=Date.parse(String(row.collected_at||""));
 const kickoff=Date.parse(String(row.event_start_time||""));
 return Number.isFinite(capture)&&Number.isFinite(kickoff)&&Number.isFinite(clock)
   &&capture<=clock&&capture<kickoff&&clock-capture<=24*3600000;
}
function asOffer(row){
 return {source:"PinnOdds",marketFamily:row.market_family,period:row.period,
  side:row.side,line:numeric(row.line),decimalOdds:numeric(row.decimal_odds),
  americanOdds:numeric(row.american_odds),capturedAt:row.collected_at,
  providerObservedAt:row.source_observed_at||null,
  eventStart:row.event_start_time,sourceMarketId:row.source_market_id,
  sourceOutcomeId:row.source_outcome_id,sourceType:"sportsbook",
  standardOrAlt:row.standard_or_alt||"unknown",
  providerTimestampVerified:false,executionEligible:false,
  decisionEligible:false,canQualify:false,canAuthorizeWager:false};
}
const pairKey=o=>o.sourceMarketId|| (o.marketFamily==="moneyline"?"moneyline":Math.abs(o.line??0).toFixed(3));
export function selectPinnoddsBoardOffers(rows=[],{now=new Date().toISOString()}={}){
 const clock=Date.parse(String(now));const byGame={};
 for(const row of rows){
  if(row.source!=="PinnOdds"||!row.canonical_event_id||row.period!=="full_game"
   ||!["moneyline","spread","total"].includes(row.market_family)
   ||!["home","away","over","under"].includes(row.side)
   ||numeric(row.decimal_odds)<=1||!freshRecord(row,clock)
   ||row.source_observed_at)continue; // Current ledger receipts lack validated provider timestamp.
  const id=String(row.canonical_event_id),o=asOffer(row);
  const game=byGame[id]||{source:"PinnOdds",status:"CAPTURE_CLOCK_ONLY",
   providerTimestampVerified:false,canQualify:false,canAuthorizeWager:false,
   matchedCanonicalEventId:id,offers:[],latestCapturedAt:null};
  // Never call this an executable or best-value offer.
  game.offers.push(o);
  if(!game.latestCapturedAt||game.latestCapturedAt<o.capturedAt)game.latestCapturedAt=o.capturedAt;
  byGame[id]=game;
 }
 for(const game of Object.values(byGame)){
  const selected=[];
  for(const family of ["moneyline","spread","total"]){
   const members=game.offers.filter(o=>o.marketFamily===family);
   const buckets=new Map();
   for(const item of members){
    const k=pairKey(item);
    const b=buckets.get(k)||new Map();
    const prev=b.get(item.side);
    if(!prev||String(item.capturedAt)>String(prev.capturedAt))b.set(item.side,item);
    buckets.set(k,b);
   }
   const required=family==="total"?["over","under"]:["home","away"];
   const paired=[...buckets.values()].filter(m=>required.every(k=>m.has(k)))
     .map(m=>required.map(k=>m.get(k)))
     .filter(pair=> {
       const [a,b]=pair;
       if(a?.line!=null&&b?.line!=null&&a.marketFamily==="spread"&&Math.abs(a.line+b.line)>0.00001)return false;
       if(a?.line!=null&&b?.line!=null&&a.marketFamily==="total"&&Math.abs(a.line-b.line)>0.00001)return false;
       if(Math.abs(Date.parse(a.capturedAt)-Date.parse(b.capturedAt))>60000)return false;
       return true;
     })
     .sort((a,b)=>{
      // No claim of official main-market status: prioritize price pairs nearest
      // to a balanced two-way market and most recent capture, deterministically.
      const score=x=>x.reduce((sum,v)=>sum+Math.abs(v.decimalOdds-1.91),0);
      const main=x=>x.every(q=>q.standardOrAlt==="standard");
      return Number(main(b))-Number(main(a))||score(a)-score(b)||String(b[0].capturedAt).localeCompare(String(a[0].capturedAt));
     });
   if(paired.length)selected.push(...paired[0]);
  }
  game.offers=selected;
  game.pairedMarkets=[...new Set(selected.map(o=>o.marketFamily))];
  game.status=selected.length?"RESEARCH_REFERENCE_ONLY":"NO_PAIRED_QUOTES";
 }
 return byGame;
}
export async function loadPinnoddsBoardResearch(db,{sport,games=[],now=new Date().toISOString()}={}){
 if(!db?.prepare||!validSport.has(sport))return {byGame:{},rows:0,source:"PinnOdds",reason:"NO_DB_OR_SPORT"};
 // Canonical IDs can be opaque (soccer slugs and tennis official IDs), not just ESPN digits.
 // Only IDs carried by the already-verified board games are queried via bound SQL parameters.
 const ids=[...new Set(games.map(g=>String(g?.id||"").trim())
  .filter(x=>x.length>0&&x.length<=180&&/^[a-zA-Z0-9:_-]+$/.test(x)))].slice(0,120);
 if(!ids.length)return {byGame:{},rows:0,source:"PinnOdds",reason:"NO_VERIFIED_EVENT_IDS"};
 const clock=Date.parse(String(now));
 if(!Number.isFinite(clock))return {byGame:{},rows:0,source:"PinnOdds",reason:"INVALID_TIME"};
 const since=new Date(clock-24*3600000).toISOString(),until=new Date(clock).toISOString();
 try{
  const placeholders=ids.map(()=>"?").join(",");
  const q=await db.prepare(`SELECT source,canonical_event_id,market_family,period,side,line,decimal_odds,american_odds,
   collected_at,source_observed_at,event_start_time,source_market_id,source_outcome_id,standard_or_alt
   FROM normalized_market_observations
   WHERE source='PinnOdds' AND sport=? AND canonical_event_id IN (${placeholders})
     AND period='full_game' AND market_family IN ('moneyline','spread','total')
     AND collected_at BETWEEN ? AND ? AND event_start_time > ?
     AND decimal_odds>1
   ORDER BY collected_at DESC LIMIT 2500`)
   .bind(sport,...ids,since,until,now).all();
  const rows=q?.results||[];
  return {byGame:selectPinnoddsBoardOffers(rows,{now}),rows:rows.length,
   source:"PinnOdds",reason:rows.length?"SOURCE_CAPTURE_PRESENT":"NO_PINNODDS_OBSERVATIONS",
   canQualify:false,canAuthorizeWager:false};
 }catch(error){return {byGame:{},rows:0,source:"PinnOdds",
   reason:"PINNODDS_READ_FAILED",error:String(error?.message||error).slice(0,180),
   canQualify:false,canAuthorizeWager:false};}
}
