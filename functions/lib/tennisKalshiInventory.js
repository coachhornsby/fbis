/**
 * Kalshi-only Tennis contracts are part of the market inventory even without
 * a matching Polymarket or FBIS projection. Kalshi's expectedExpirationAt is
 * an ADMINISTRATIVE CLOCK; it is never represented as a verified match start.
 * Public signed R2 observations only; no private account or bet permissions.
 */
import {matchKalshiTennisResearch,TENNIS_KALSHI_SPORTS} from "./tennisKalshiResearch.js";
import {KALSHI_SHADOW_SERIES} from "./kalshiMarketShadow.js";
const boardTour=x=>x==="atp_challenger"?"atp":x;
const clean=x=>String(x||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .replace(/\((?:19|20)\d{2}\)/g,"").replace(/[^a-zA-Z0-9]+/g," ").toLowerCase().trim().replace(/\s+/g," ");
const surname=x=>clean(x).split(" ").at(-1)||"";
const ctDate=value=>{
 const d=new Date(value);
 if(!Number.isFinite(+d))return null;
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",
  month:"2-digit",day:"2-digit"}).formatToParts(d);
 const part=type=>parts.find(p=>p.type===type)?.value;
 return [part("year"),part("month"),part("day")].join("-");
};
export function kalshiTennisContractPairs(kalshi={},now=new Date()){
 const matches=[],groups=new Map();
 for(const tour of TENNIS_KALSHI_SPORTS)for(const row of kalshi[tour]||[]){
  if(row?.sport!==tour||!["active","open"].includes(row.status))continue;
  const prefix=KALSHI_SHADOW_SERIES[tour]+"-";
  if(typeof row?.eventTicker!=="string"||!row.eventTicker.startsWith(prefix)||
     typeof row.ticker!=="string"||!row.ticker.startsWith(prefix)||
     !/^[A-Z0-9_.-]{5,180}$/.test(row.eventTicker))continue;
  const at=Date.parse(row.fetchedAt||""),expiry=Date.parse(row.expectedExpirationAt||"");
  const occurrence=Date.parse(row.occurrenceAt||"");
  const marketTime=Number.isFinite(occurrence)?occurrence:expiry;
  if(!Number.isFinite(at)||at>+now||+now-at>90*60000||
    !Number.isFinite(expiry)||!Number.isFinite(marketTime)||
    marketTime<+now-48*3600000||marketTime>+now+7*86400000)continue;
  const name=clean(row.yesLabel);
  if(name.split(" ").length<2||name.length<6)continue;
  const rules=String(row.rulesPrimary||"")+" "+String(row.rulesSecondary||"");
  if(!/tennis match/i.test(rules))continue;
  const index=tour+"|"+row.eventTicker;
  if(!groups.has(index))groups.set(index,[]);
  groups.get(index).push({...row,tour,normalizedName:name,rulesText:clean(rules),expiryMs:expiry,
    marketTimeMs:marketTime,occurrenceAt:Number.isFinite(occurrence)?row.occurrenceAt:null});
 }
 for(const rows of groups.values()){
  // Latest observed quote per full player outcome, never one-sided or a
  // YES+NO inversion. Two distinct full-named YES contracts are required.
  const byPlayer=new Map();
  for(const r of rows){
   const older=byPlayer.get(r.normalizedName);
   if(!older||Date.parse(r.fetchedAt)>Date.parse(older.fetchedAt))byPlayer.set(r.normalizedName,r);
  }
  if(byPlayer.size!==2)continue;
  const sides=[...byPlayer.values()].sort((a,b)=>a.normalizedName.localeCompare(b.normalizedName));
  if(sides[0].ticker===sides[1].ticker||
     Math.abs(sides[0].marketTimeMs-sides[1].marketTimeMs)>2*3600000||
     !sides.every(r=>sides.every(p=>surname(p.yesLabel).length>=2&&
      r.rulesText.split(" ").includes(surname(p.yesLabel)))))continue;
  const expiry=sides[0].expectedExpirationAt;
  const occurred=sides.every(r=>r.occurrenceAt&&
    Math.abs(Date.parse(r.occurrenceAt)-Date.parse(sides[0].occurrenceAt))<=2*3600000);
  const scheduled=occurred?sides[0].occurrenceAt:expiry;
  matches.push({id:"tennis:kalshi:"+sides[0].tour+":"+sides[0].eventTicker,
   tour:boardTour(sides[0].tour),seriesSport:sides[0].tour,
   eventTicker:sides[0].eventTicker,
   player1:sides[0].yesLabel,player2:sides[1].yesLabel,
   providerExpiry:expiry,providerOccurrenceAt:occurred?scheduled:null,
   providerTimeStatus:occurred?"PROVIDER_OCCURRENCE_TIME":"CONTRACT_EXPIRATION_NOT_MATCH_START",
   offers:sides.map(row=>({
    provider:"Kalshi",source:"SIGNED_R2_RESEARCH",eventTicker:row.eventTicker,
    ticker:row.ticker,title:row.title,yesLabel:row.yesLabel,
    yesAskDollars:row.yesAskDollars??null,yesBidDollars:row.yesBidDollars??null,
    fetchedAt:row.fetchedAt,providerScheduledAt:row.occurrenceAt||row.expectedExpirationAt,
    quoteKind:"INDICATIVE_MARKET_TOP_NOT_VERIFIED_FILLABLE",
    canQualify:false,canAuthorizeWager:false,executionEligible:false})),
   canQualify:false,canAuthorizeWager:false});
 }
 return matches;
}
export function mergeKalshiTennisCards(games=[],kalshi={},{
 date,now=new Date()
}={}){
 const output=[...games],added=[],groups=kalshiTennisContractPairs(kalshi,now);
 for(const contract of groups){
  const a=clean(contract.player1),b=clean(contract.player2),players=[a,b].sort().join("|");
  // Match using independently resolved full player names, tour and a bounded
  // provider expiry window. Do not assert the expiry is the fixture start.
  const candidates=output.filter(g=>{
   if(g.sport!=="tennis"||String(g.tour||g.tennisProjection?.tour||"").toLowerCase()!==contract.tour)return false;
   const gnames=[clean(g.home?.fullName||g.home?.name),clean(g.away?.fullName||g.away?.name)].sort().join("|");
   const ms=Date.parse(g.start||"");
   const sourceTime=Date.parse(contract.providerOccurrenceAt||contract.providerExpiry);
   return gnames===players&&Number.isFinite(ms)&&
    Math.abs(ms-sourceTime)<=(contract.providerOccurrenceAt?2:72)*3600000;
  });
  // A single observed provider event cannot be grafted onto ambiguous games.
  if(candidates.length===1){
   const g=candidates[0],t=g.tennisProjection||{};
   const fixture={tour:contract.tour,start:g.start,
    home_name:g.home?.fullName||g.home?.name,
    away_name:g.away?.fullName||g.away?.name};
   const matched=contract.seriesSport===contract.tour?
    matchKalshiTennisResearch(fixture,kalshi[contract.seriesSport]||[],now):contract.offers;
   if(matched.length===2&&matched.every(o=>o.eventTicker===contract.eventTicker)){
    const old=t.kalshiResearchOffers||[];
    const map=new Map([...old,...matched].map(o=>[o.ticker,o]));
    g.tennisProjection={...t,kalshiResearchOffers:[...map.values()],
     kalshiResearchStatus:kalshi[contract.tour+"Status"]||kalshi.status||"RESEARCH_SNAPSHOT"};
    continue;
   }
  }
  // No fabricated scheduled start: the card is explicitly labeled as an
  // administrative expiry listing. No source or model may use it for betting.
  const schedule=contract.providerOccurrenceAt||contract.providerExpiry;
  if(ctDate(schedule)!==date)continue;
  const game={id:contract.id,sport:"tennis",tour:contract.tour,
   start:schedule,startTimeBasis:contract.providerOccurrenceAt?
    "KALSHI_PROVIDER_OCCURRENCE":"KALSHI_CONTRACT_EXPIRATION_ONLY",
   home:{name:contract.player1,fullName:contract.player1},
   away:{name:contract.player2,fullName:contract.player2},
   publicationStatus:"EXCHANGE_MARKET_RESEARCH",canQualify:false,
   canAuthorizeWager:false,qualificationBlocked:true,
   qualificationBlockReason:"UNVERIFIED_MATCH_START_AND_NO_FBIS_PROJECTION",
   model:null,projectionKind:"UNAVAILABLE",pureProjectionAvailable:false,
   market:{reference:{available:false},venueOffers:[],marketAvailable:false},
   tennisProjection:{researchFixture:{verified:true,fixtureId:contract.id,
    source:"KALSHI_PUBLIC_SHADOW",eventTicker:contract.eventTicker,
    timeBasis:contract.providerTimeStatus},
    eventIntegrity:{valid:false,reason:"SCHEDULE_UNVERIFIED"},
    tour:contract.tour,kalshiSeries:contract.seriesSport,
    kalshiResearchOffers:contract.offers,
    kalshiResearchStatus:kalshi[contract.seriesSport+"Status"]||kalshi.status||"RESEARCH_SNAPSHOT",
    polymarketGlobalOffers:[],venueOffers:[],player1WinProb:null,
    player2WinProb:null,blockedReason:"KALSHI_ONLY_RESEARCH_NO_MODEL_AUTHORITY",
    canQualify:false,canAuthorizeWager:false}};
  output.push(game);added.push(game.id);
 }
 return {games:output,added,kalshiEvents:groups.length,status:kalshi.status||"NO_FRESH_KALSHI_SNAPSHOT"};
}
