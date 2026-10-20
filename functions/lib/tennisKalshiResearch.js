import {loadKalshiR2Shadow} from "./kalshiR2Shadow.js";
const key = s => " "+String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()+" ";
const clean=s=>String(s||"").normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const surname=name=>clean(name).split(" ").at(-1)||"";
const same=(a,b)=>clean(a)===clean(b);
const hasSurname=(text,name)=>surname(name).length>=4&&key(text).includes(key(surname(name)));
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
   yesBidDollars:r.yesBidDollars??null,volumeContracts:r.volumeContracts??null,
   fetchedAt:r.fetchedAt,quoteSourceTime:null,source:"SIGNED_R2_RESEARCH",
   providerScheduledAt:new Date(r.scheduled).toISOString(),
   fixtureScheduledAt:new Date(start).toISOString(),
   scheduleStatus:diff>2*3600000?"PROVIDER_START_DIFFERS":"START_WITHIN_TWO_HOURS",
   quoteKind:"INDICATIVE_MARKET_TOP_NOT_VERIFIED_FILLABLE",
   canQualify:false,canAuthorizeWager:false,executionEligible:false};
 });
}
export async function loadKalshiTennisResearch(env,now=new Date()){
 if(!env?.ARCHIVE?.get)return {atp:[],wta:[],status:"R2_UNAVAILABLE"};
 const [a,b]=await Promise.all(["atp","wta"].map(tour=>
  loadKalshiR2Shadow(env,tour,{now,maxAgeMs:90*60000}).catch(()=>null)));
 return {atp:a?.ok&&a.sourceQueryComplete?a.records:[],
  wta:b?.ok&&b.sourceQueryComplete?b.records:[],
  status:a?.ok||b?.ok?"RESEARCH_SNAPSHOT":"NO_FRESH_SNAPSHOT"};
}
