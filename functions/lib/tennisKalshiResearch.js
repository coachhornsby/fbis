import {loadKalshiR2Shadow} from "./kalshiR2Shadow.js";
import {KALSHI_SHADOW_SERIES} from "./kalshiMarketShadow.js";
export const TENNIS_KALSHI_SPORTS=Object.freeze(["atp","wta","atp_challenger","itf_men","itf_women","atp_doubles","wta_doubles","itf_doubles","itf_women_doubles"]);
const key = s => " "+String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()+" ";
// Provider name disambiguators such as "Kenta (2004) Miyoshi" are not
// part of the athlete name. Keep two full names and event/schedule proof.
const clean=s=>key(String(s||"").replace(/\((?:19|20)\d{2}\)/g,"")).trim();
const surname=name=>clean(name).split(" ").at(-1)||"";
const same=(a,b)=>clean(a)===clean(b);
const hasSurname=(text,name)=>surname(name).length>=2&&key(text).includes(key(surname(name)));
/** Two separately named YES outcomes, identical event ticker, explicit rules
 * with BOTH distinct player surnames, scheduled within three days. Kalshi
 * settlement administrative closeAt is NOT the scheduled match time.
 * Venue/category not inferred; schedule disagreements remain research-only.
 */
export function matchKalshiTennisResearch(fixture,rows=[],now=new Date()){
 const tour=String(fixture?.tour||"").toLowerCase();
 const names=[fixture?.away_name,fixture?.home_name];
 const start=Date.parse(fixture?.start||"");
 if(!["atp","wta"].includes(tour)||!Number.isFinite(start)||
    names.some(n=>clean(n).split(" ").length<2)||same(names[0],names[1])||
    surname(names[0])===surname(names[1]))return [];
 const grouped=new Map();
 for(const row of rows||[]){
  if(row?.sport!==tour||!["active","open"].includes(row.status))continue;
  if(!row.eventTicker||!row.ticker?.startsWith(tour==="atp"?"KXATPMATCH-":"KXWTAMATCH-"))continue;
  const age=+now-Date.parse(row.fetchedAt||"");
  if(!Number.isFinite(age)||age<0||age>90*60000)continue;
  const scheduled=Date.parse(row.expectedExpirationAt||"");
  if(!Number.isFinite(scheduled)||Math.abs(scheduled-start)>72*3600000)continue;
  // Both player surnames are necessary for a provider pair identity.
  const rules=String(row.rulesPrimary||"")+" "+String(row.rulesSecondary||"");
  if(!/professional tennis match/i.test(rules)||!names.every(n=>hasSurname(rules,n)))continue;
  const playerIndex=names.findIndex(n=>same(row.yesLabel,n));
  if(playerIndex<0)continue;
  // A row is never allowed to name both participants as YES.
  if(names.some((n,i)=>i!==playerIndex&&same(row.yesLabel,n)))continue;
  const group=grouped.get(row.eventTicker)||[];
  group.push({...row,playerIndex,scheduled});
  grouped.set(row.eventTicker,group);
 }
 const valid=[...grouped.entries()].filter(([ticker,records])=>
  records.some(r=>r.playerIndex===0)&&records.some(r=>r.playerIndex===1) &&
  new Set(records.map(r=>r.playerIndex)).size===2);
 if(valid.length!==1)return []; // Fail closed on ambiguous Kalshi events.
 return [0,1].map(index=>{
  const values=valid[0][1].filter(r=>r.playerIndex===index)
   .sort((a,b)=>Date.parse(b.fetchedAt)-Date.parse(a.fetchedAt));
  const r=values[0],diff=Math.abs(r.scheduled-start);
  return {provider:"Kalshi",eventTicker:r.eventTicker,ticker:r.ticker,
   title:r.title,yesLabel:r.yesLabel,yesAskDollars:r.yesAskDollars??null,
   yesBidDollars:r.yesBidDollars??null,yesAskSize:r.yesAskSize??null,yesBidSize:r.yesBidSize??null,volumeContracts:r.volumeContracts??null,
   fetchedAt:r.fetchedAt,quoteSourceTime:null,source:"SIGNED_R2_RESEARCH",
   providerScheduledAt:new Date(r.scheduled).toISOString(),
   fixtureScheduledAt:new Date(start).toISOString(),
   scheduleStatus:diff>2*3600000?"PROVIDER_START_DIFFERS":"START_WITHIN_TWO_HOURS",
   quoteKind:"INDICATIVE_MARKET_TOP_NOT_VERIFIED_FILLABLE",
   canQualify:false,canAuthorizeWager:false,executionEligible:false};
 });
}
// A one-page-per-cycle collector can have fresh, still-paginating market rows.
// Accept those rows ONLY as incomplete research observations, with every
// original source capture clock intact. Never mark sourceQueryComplete or wagers.
async function readKalshiTennisProgress(archive,sport,now){
 try{
  const object=await archive.get("kalshi/public-shadow/v1/sports/"+sport+"-progress.json");
  if(!object)return [];
  const p=await object.json();
  if(p?.version!==1||p.sport!==sport||!Array.isArray(p.records)||
    p.records.length>4000||!Number.isInteger(p.pagesFetched)||
    p.pagesFetched<1||p.pagesFetched>12||typeof p.cursor!=="string"||!p.cursor)return [];
  const started=Date.parse(p.startedAt||"");
  if(!Number.isFinite(started)||started>+now||+now-started>8*3600000)return [];
  const series=KALSHI_SHADOW_SERIES[sport]+"-";
  return p.records.filter(r=>{
   const fetched=Date.parse(r?.fetchedAt||"");
   return r?.sport===sport&&typeof r?.ticker==="string"&&
     r.ticker.startsWith(series)&&Number.isFinite(fetched)&&
     +now-fetched>=0&&+now-fetched<=90*60000;
  }).map(r=>({...r,sourceQueryComplete:false,canQualify:false,
    canAuthorizeWager:false,executionEligible:false}));
 }catch{return [];}
}
export async function loadKalshiTennisResearch(env,now=new Date()){
 if(!env?.ARCHIVE?.get)return {atp:[],wta:[],status:"R2_UNAVAILABLE",
  atpStatus:"R2_UNAVAILABLE",wtaStatus:"R2_UNAVAILABLE"};
 const results=await Promise.all(TENNIS_KALSHI_SPORTS.map(async sport=>{
  const complete=await loadKalshiR2Shadow(env,sport,{now,maxAgeMs:90*60000}).catch(()=>null);
  if(complete?.ok&&complete.sourceQueryComplete)return {
   rows:complete.records,status:"COMPLETE_RESEARCH_SNAPSHOT"};
  const rows=await readKalshiTennisProgress(env.ARCHIVE,sport,now);
  return {rows,status:rows.length?"PARTIAL_PAGINATING_RESEARCH_ONLY":
    complete?.code||"NO_FRESH_SNAPSHOT"};
 }));
 const obj={};
 for(let i=0;i<TENNIS_KALSHI_SPORTS.length;i++){
  const sport=TENNIS_KALSHI_SPORTS[i];
  obj[sport]=results[i].rows;obj[sport+"Status"]=results[i].status;
 }
 return {...obj,status:results.some(r=>r.status==="COMPLETE_RESEARCH_SNAPSHOT")?"RESEARCH_SNAPSHOT":
   results.some(r=>r.rows.length)?"PARTIAL_RESEARCH_SNAPSHOT":"NO_FRESH_SNAPSHOT"};
}
