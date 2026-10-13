import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { persistNormalizedMarketBatch } from "../lib/marketObservationLedger.js";
import {
  FBIS_POLY_SPORTS, classifyPolymarketUsLeague, chicagoMarketDay,
  fetchPolymarketUsLeagues, fetchPolymarketUsLeagueEvents,
  matchPolymarketUsEvent, marketEventStart, polymarketUsMarketOffers
} from "../lib/polymarketUs.js";

/**
 * Read-only Polymarket US market intelligence.
 * Authenticated HARVEST_SECRET caller, PUBLIC provider endpoints only.
 * This does not read an operator account, place an order, qualify or promote a model.
 */
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json","cache-control":"no-store"}
});
const utcDay=(value,offset)=>new Date(Date.parse(value+"T12:00:00Z")+offset*86400000).toISOString().slice(0,10);
const num=(x)=>Number.isFinite(Number(x))?Number(x):null;
export async function collectPolymarketUs(db,{date,fetchImpl=fetch,now=new Date(),
  maxLeaguesPerSport=3,maxEventsPerSport=6,maxMarketsPerEvent=8,maxOffers=150,maxOffersPerSport=14
}={}){
 if(!db?.prepare)throw Error("d1-unavailable");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))throw Error("valid-CT-date-required");
 const capturedAt=now.toISOString();
 const next=utcDay(date,1);
 const games=await db.prepare("SELECT id,sport,date,start,home_name,away_name,home_abbr,away_abbr FROM games WHERE date BETWEEN ?1 AND ?2").bind(date,next).all();
 const source=await fetchPolymarketUsLeagues(fetchImpl,{maxPages:8});
 const leagueBySport=new Map(FBIS_POLY_SPORTS.map(s=>[s,[]]));
 for(const league of source.leagues){
  const sport=classifyPolymarketUsLeague(league);
  if(sport)leagueBySport.get(sport).push(league.slug);
 }
 const report={ok:true,source:"POLYMARKET_US_PUBLIC",referenceApi:"https://gateway.polymarket.us",
  date,capturedAt,sourceLeagueCatalogueComplete:source.complete,
  allFbisSports:FBIS_POLY_SPORTS,states:[],attemptedOffers:0,inserted:0,
  matchedOffers:0,unmatchedOffers:0,canQualify:false,canAuthorizeWager:false,
  executeTrade:false,modifiesChampion:false,coverageComplete:false};
 const offers=[];
 const startMs=now.getTime();
 for(const sport of FBIS_POLY_SPORTS){
  const leagues=leagueBySport.get(sport)||[];
  const sportGames=(games.results||[]).filter(g=>String(g.sport).toLowerCase()===sport);
  const selected=leagues.slice(0,maxLeaguesPerSport);
  let nEvents=0,matched=0,unmatched=0,unpriced=0,sourceErrors=[];
  let truncated=leagues.length>selected.length;
  const providerIds=new Set();
  const offersBefore=offers.length;
  // Don't assume an unsupported league has no sport schedule or no market.
  for(const slug of selected){
   if(offers.length>=maxOffers){truncated=true;break}
   let events;
   try{events=await fetchPolymarketUsLeagueEvents(slug,fetchImpl,{limit:70})}
   catch(error){sourceErrors.push(slug+":"+String(error?.message||error));continue}
   let sampled=0;
   for(const event of events){
    if(!event?.id||providerIds.has(String(event.id)))continue;
    const eventStart=marketEventStart(event);
    const eventMs=Date.parse(eventStart||"");
    if(!Number.isFinite(eventMs)||chicagoMarketDay(eventStart)!==date)continue;
    // Skip long-completed games. Later RESULT evidence is separate.
    if(eventMs < startMs-8*60*60*1000)continue;
    if(sampled>=maxEventsPerSport||offers.length>=maxOffers||offers.length-offersBefore>=maxOffersPerSport){truncated=true;break}
    providerIds.add(String(event.id));sampled++;nEvents++;
    const identity=matchPolymarketUsEvent(event,sportGames,sport);
    if(Array.isArray(event.markets)&&event.markets.length>maxMarketsPerEvent)truncated=true;
    const marketOffers=polymarketUsMarketOffers(event,sport,{
      canonicalId:identity.id,capturedAt,maxMarkets:maxMarketsPerEvent
    });
    for(const offer of marketOffers){
      if(offers.length>=maxOffers||offers.length-offersBefore>=maxOffersPerSport){truncated=true;break}
      if(offer.contractPrice===null)unpriced++;
      offers.push({...offer,raw:{...offer.raw,providerLeagueSlug:slug,
        eventMatchStatus:identity.reason,providerPlatform:"POLYMARKET_US",
        sourceObservedAt:null,quoteObservedAt:null}});
      if(identity.id)matched++;else unmatched++;
    }
   }
  }
  const status= !leagues.length?"LEAGUE_UNLISTED":
   sourceErrors.length?"PROVIDER_ERRORS":
   truncated?"SAMPLED_PARTIAL":
   !nEvents?"NO_SAME_DAY_MARKETS_LISTED":
   offers.length===offersBefore?"MARKETS_UNAVAILABLE":
   unpriced===offers.length-offersBefore?"NO_PRICED_MARKETS":"RESEARCH_OBSERVATIONS";
  report.states.push({sport,leagueCount:leagues.length,leaguesVisited:selected,
    gamesInFbis:sportGames.length,providerEvents:nEvents,offers:offers.length-offersBefore,
    matched,unmatched,unpriced,sourceErrors,truncated,status});
 }
 report.attemptedOffers=offers.length;
 report.matchedOffers=report.states.reduce((s,x)=>s+x.matched,0);
 report.unmatchedOffers=report.states.reduce((s,x)=>s+x.unmatched,0);
 if(offers.length){
  const saved=await persistNormalizedMarketBatch(db,offers,{
    snapshotType:"CURRENT",collectedAt:capturedAt,modelProbability:null});
  report.inserted=saved.inserted;
  const read=await db.prepare("SELECT COUNT(*) AS n FROM normalized_market_observations WHERE source='Polymarket US' AND collected_at=?1").bind(capturedAt).first();
  report.readbackRows=num(read?.n);
  report.readbackValidated=report.readbackRows===offers.length;
  if(!report.readbackValidated)report.ok=false;
 }else{report.readbackRows=0;report.readbackValidated=null}
 report.errors=report.states.flatMap(s=>s.sourceErrors.map(e=>s.sport+":"+e));
 if(report.errors.length||!source.complete)report.ok=false;
 report.coverageComplete=false; // No unverified sport/exchange may claim full coverage.
 return report;
}
export async function onRequestPost(context){
 const auth=authorizeHarvest(context.request,context.env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!context.env?.DB)return json({ok:false,error:"durable-d1-unavailable"},503);
 const u=new URL(context.request.url);
 const date=u.searchParams.get("date");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||"")))return json({ok:false,error:"ct-date-required"},400);
 try {
  const result=await collectPolymarketUs(context.env.DB,{date});
  return json(result,result.ok?200:503);
 } catch(error) {
  return json({ok:false,source:"POLYMARKET_US_PUBLIC",error:String(error?.message||error),
    date,canQualify:false,canAuthorizeWager:false},502);
 }
}
export async function onRequestGet(){return json({ok:false,error:"method-not-allowed"},405)}
