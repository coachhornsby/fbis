/**
 * Kalshi Phase-2 coverage audit. Records explicit observable evidence and
 * missing prerequisites WITHOUT creating an executable bet, model prediction,
 * or an inferred canonical team/game identifier.
 */
import {KALSHI_SHADOW_SERIES} from "./kalshiMarketShadow.js";
import {classifyKalshiSportContract,verifyKalshiEventIdentity} from "./kalshiContractIdentity.js";

const prefix="kalshi/public-shadow/v1/";
const SPORTS=["nfl","cfb"];
const safeStamp=s=>{const t=Date.parse(s||"");return Number.isFinite(t)?t:null;};
const dateStr=s=>typeof s==="string"&&safeStamp(s)!==null?s:null;
const isId=x=>typeof x==="string"&&/^[A-Z0-9_.-]{4,160}$/.test(x);
async function read(bucket,key){
 try{const value=await bucket?.get?.(prefix+key);return value?await value.json():null;}catch{return null;}
}
function sortCounts(map){
 return Object.fromEntries([...map.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
}
/** Exact-event-ticker grouping only; never infer match identity from abbreviations. */
export function auditKalshiMarketRecords(sport,records=[],{
 now=new Date(),snapshotAt=null,
 evidence=[],
}={}){
 const seen=new Set(),groups=new Map(),reasonCounts=new Map();
 const details=[];
 let malformed=0,duplicate=0,staleQuoteRows=0,unverifiedFamilies=0;
 const legal=KALSHI_SHADOW_SERIES[sport];
 const evidenceByTicker=new Map();
 for(const entry of Array.isArray(evidence)?evidence:[]){
  if(!isId(entry?.event?.event_ticker))continue;
  const key=entry.event.event_ticker;
  if(evidenceByTicker.has(key))evidenceByTicker.set(key,null); // ambiguous mapping
  else evidenceByTicker.set(key,entry);
 }
 for(const row of (Array.isArray(records)?records:[]).slice(0,4000)){
  if(!legal||!isId(row?.ticker)||!row.ticker.startsWith(legal+"-")){
   malformed++;continue;
  }
  if(seen.has(row.ticker)){duplicate++;continue;}seen.add(row.ticker);
  const eventTicker=row.eventTicker;
  const eventOk=isId(eventTicker)&&row.ticker.startsWith(eventTicker+"-")
   &&eventTicker.startsWith(legal+"-");
  if(eventOk){
   const arr=groups.get(eventTicker)||[];
   arr.push(row);groups.set(eventTicker,arr);
  }
  const family=classifyKalshiSportContract({
   ticker:row.ticker,title:row.title,
   yes_sub_title:row.yesLabel,rules_primary:row.rulesPrimary,
  }).family;
  if(family!=="game_winner")unverifiedFamilies++;
  const updated=safeStamp(row.fetchedAt||snapshotAt);
  const age=updated===null?null:now.getTime()-updated;
  const recent=age!==null&&age>=0&&age<=50*60*1000;
  if(!recent)staleQuoteRows++;
  const proof=eventOk?evidenceByTicker.get(eventTicker):null;
  const identity=proof?verifyKalshiEventIdentity({
   fixture:proof.fixture,event:proof.event,
   market:{event_ticker:eventTicker},
  }):null;
  const reasons=[];
  if(!eventOk)reasons.push("PROVIDER_EVENT_TICKER_INVALID");
  if(family!=="game_winner")reasons.push("CONTRACT_FAMILY_NOT_GAME_WINNER");
  if(!proof)reasons.push("INDEPENDENT_FIXTURE_AND_EVENT_EVIDENCE_MISSING");
  else if(!identity?.matched)reasons.push(identity?.reason||"FIXTURE_IDENTITY_UNVERIFIED");
  if(!row.rulesPrimary)reasons.push("SETTLEMENT_RULE_TEXT_MISSING");
  // Provider market top of book is indicative, never executable or fee-aware.
  reasons.push("OUTCOME_SIDE_NOT_VERIFIED");
  reasons.push("EXECUTABLE_ORDERBOOK_NOT_VERIFIED");
  reasons.push("FEE_SCHEDULE_NOT_VERIFIED");
  reasons.push("QUOTE_SOURCE_TIME_NOT_VERIFIED");
  if(!recent)reasons.push("QUOTE_SNAPSHOT_STALE");
  for(const code of reasons)reasonCounts.set(code,(reasonCounts.get(code)||0)+1);
  details.push({
   ticker:row.ticker,eventTicker:eventOk?eventTicker:null,
   title:String(row.title||"").slice(0,180),family,
   fixtureCandidate:identity?.matched===true,
   canonicalEventId:identity?.matched===true?identity.canonicalEventId:null,
   quoteAgeSeconds:age!==null&&age>=0?Math.floor(age/1000):null,
   reasons,canQualify:false,executionEligible:false,
  });
 }
 const pairedCandidates=[...groups.values()].filter(rows=>rows.length===2
  &&rows.every(r=>/\bwins?\b/i.test(r.title||""))
  &&String(rows[0].title).toLowerCase()!==String(rows[1].title).toLowerCase()).length;
 const matchedCandidates=details.filter(d=>d.fixtureCandidate).length;
 return {
  sport,recordsReviewed:details.length,invalidRows:malformed,duplicateRows:duplicate,
  uniqueEvents:groups.size,twoOutcomeCandidates:pairedCandidates,
  independentFixtureCandidates:matchedCandidates,
  quoteAgeStaleRows:staleQuoteRows,unverifiedFamilyRows:unverifiedFamilies,
  verifiedExecutableMarkets:0,fullyQualifiedMarkets:0,
  reasons:sortCounts(reasonCounts),
  sample:details.slice(0,40), // bounded read-only audit sample
  identityStandard:"INDEPENDENT_TWO_TEAMS_START_EVENT_TICKER",
  authority:"RESEARCH_ONLY",canQualify:false,canChangeCORE:false,
  canPublishMarketOdds:false,canSettleBets:false,canAuthorizeWager:false,
 };
}
export async function kalshiCoverageReport(env,{now=new Date(),sport=null}={}){
 const sports=SPORTS.filter(s=>!sport||s===sport);
 const result=await Promise.all(sports.map(async s=>{
  const [snapshot,receipt,checkpoint]=await Promise.all([
   read(env?.ARCHIVE,"sports/"+s+".json"),
   read(env?.ARCHIVE,"sports/"+s+"-status.json"),
   read(env?.ARCHIVE,"sports/"+s+"-progress.json"),
  ]);
  const good=snapshot?.ok===true&&snapshot?.sport===s
   &&snapshot?.seriesTicker===KALSHI_SHADOW_SERIES[s]
   &&Array.isArray(snapshot?.records);
  const captured=dateStr(snapshot?.capturedAt);
  const age=captured?now.getTime()-Date.parse(captured):null;
  const snapshotFresh=good&&age!==null&&age>=0&&age<=50*60*1000;
  const audit=auditKalshiMarketRecords(s,good?snapshot.records:[],{
   now,snapshotAt:captured,
  });
  const recordsRecent=audit.quoteAgeStaleRows===0;
  const cursorPresent=typeof checkpoint?.cursor==="string"
   &&checkpoint.cursor.length>0;
  return{
   ...audit,
   seriesTicker:KALSHI_SHADOW_SERIES[s],
   lastSnapshotAt:captured,
   snapshotAgeSeconds:age!==null&&age>=0?Math.floor(age/1000):null,
   snapshotStatus:!good?"NOT_COLLECTED":!snapshotFresh?"STALE":
    !recordsRecent?"PARTIALLY_STALE":"FRESH",
   coverageState:!good?"NOT_COLLECTED":!snapshotFresh?"STALE":
     snapshot.paginationComplete===true&&recordsRecent?"SERIES_QUERY_COMPLETE":
     "PARTIAL_OR_STALE",
   queryPaginationComplete:good&&snapshot.paginationComplete===true,
   completeCurrentQuoteCoverage:!!(snapshotFresh&&recordsRecent&&snapshot?.paginationComplete===true),
   lastAttemptAt:dateStr(receipt?.attemptedAt),
   lastAttemptState:receipt?.status||"NOT_OBSERVED",
   lastAttemptCode:receipt?.code||null,
   recordsInProgress:cursorPresent&&Array.isArray(checkpoint.records)
    ?checkpoint.records.length:0,
   pagesInProgress:cursorPresent?checkpoint.pagesFetched||0:0,
   continuationPending:cursorPresent,
   // No independent fixture/event evidence is present in the public R2 feed.
   providerEventMetadataCollected:false,
   canonicalFixtureFeedJoined:false,
   outcomeSidesVerified:false,feesVerified:false,liquidityVerified:false,
   canQualify:false,canAuthorizeWager:false,
  };
 }));
 return{
  ok:true,provider:"Kalshi",asOf:now.toISOString(),
  scope:"NFL_CFB_SIGNED_PUBLIC_SHADOW_ONLY",
  sports:result,
  governance:{
   fullSportCoverageVerified:false,canQualify:false,
   canChangeCORE:false,canChangePinnOddsGap:false,
   canAuthorizeWager:false,canSettleBets:false,
  },
 };
}
