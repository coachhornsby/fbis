/**
 * Targeted Pinnodds baseball period and price verification.
 * One full baseball fixtures request + <=3 event-specific market GETs.
 * Does not fetch or mutate user wagers. Does not use market prices as features.
 */
const BASE="https://pinnodds.com";
const positivePrice=x=>{const n=Number(x);return Number.isFinite(n)&&n>1?n:null};
const positiveLine=x=>{const n=Number(x);return Number.isFinite(n)?n:null};
const str=x=>String(x??"").slice(0,140);
const isGame=e=>e&&typeof e==="object"&&!e.special&&!e.special_category&&Number.isSafeInteger(Number(e.event_id));
const isMlb=e=>/^(mlb|.*major league baseball.*|usa.*mlb.*)$/i.test(str(e.league_name).trim());
const copyLimits=x=>{const n=Number(x);return Number.isFinite(n)&&n>=0?n:null};

/**
 * Never guess that num_3 or "Half 3" means three innings.
 * The Pinnacle baseball rule confirms only the 1st Half = first five.
 */
export function classifyBaseballPeriod(number,description){
 const d=str(description).trim().toLowerCase();
 if(number===0||d==="game"||d==="match")return "FULL_GAME";
 if(/\b(?:first|1st)\s*(?:3|three)\s*innings?\b|\b(?:first|1st)\s*3\b|\bf3\b/.test(d))return "F3_CONFIRMED_LABEL";
 if(/\b(?:first|1st)\s*(?:5|five)\s*innings?\b|\b(?:first|1st)\s*5\b|\bf5\b/.test(d))return "F5_CONFIRMED_LABEL";
 if(number===1&&/^(?:half\s*1|(?:1st|first)\s*half|half\s*one)$/.test(d))return "F5_BY_FIRST_HALF_RULE";
 return "UNVERIFIED_PERIOD";
}
export function parseBaseballPeriods(e){
 const raw=e?.periods&&typeof e.periods==="object"?e.periods:{};
 return Object.entries(raw).filter(([id,v])=>/^num_\d+$/.test(id)&&v&&typeof v==="object")
 .map(([key,p])=>{
   const number=Number.isFinite(Number(p.number))?Number(p.number):Number(key.slice(4));
   const money=p.money_line||{};
   const moneyline={home:positivePrice(money.home),away:positivePrice(money.away),draw:positivePrice(money.draw)};
   const spreads=Object.entries(p.spreads||{}).map(([label,line])=>({
     line:positiveLine(line?.hdp??label),home:positivePrice(line?.home),away:positivePrice(line?.away),
     maxRisk:copyLimits(line?.max)
   })).filter(x=>x.line!==null||x.home!==null||x.away!==null).slice(0,30);
   const totals=Object.entries(p.totals||{}).map(([label,line])=>({
     line:positiveLine(line?.points??label),over:positivePrice(line?.over),under:positivePrice(line?.under),
     maxRisk:copyLimits(line?.max)
   })).filter(x=>x.line!==null||x.over!==null||x.under!==null).slice(0,30);
   const teamTotals=(side)=>Object.entries(p.team_totals?.[side]||{}).map(([label,line])=>({
     line:positiveLine(line?.points??label),over:positivePrice(line?.over),under:positivePrice(line?.under),
     maxRisk:copyLimits(line?.max)
   })).slice(0,20);
   const pricedMl=moneyline.home!==null&&moneyline.away!==null;
   const pricedSpreads=spreads.filter(x=>x.home!==null&&x.away!==null).length;
   const pricedTotals=totals.filter(x=>x.over!==null&&x.under!==null).length;
   const primaryTeamTotals=Object.fromEntries(["home","away"].map(side=>{
     const x=p.team_total?.[side];return[side,x?{
       line:positiveLine(x.points),over:positivePrice(x.over),under:positivePrice(x.under)
     }:null]
   }));
   const meta=p.meta||{};
   return {
     key,number,description:str(p.description),classification:classifyBaseballPeriod(number,p.description),
     periodStatus:p.period_status??null,cutoff:p.cutoff||null,
     sourceOpenFlags:Object.fromEntries(["open_money_line","open_spreads","open_totals","open_team_total"]
       .filter(k=>typeof meta[k]==="boolean").map(k=>[k,meta[k]])),
     moneyline,spreads,totals,teamTotals:{home:teamTotals("home"),away:teamTotals("away")},
     primaryTeamTotals,quoted:{moneyline:pricedMl,runLines:pricedSpreads,totals:pricedTotals},
     quoteStatus:pricedMl||pricedSpreads||pricedTotals?"PRICED_MARKET_OBSERVED":"NO_PAIRED_PRICES",
     executableVerified:false // Snapshot has no per-market price timestamp or execution confirmation
   };
 }).sort((a,b)=>a.number-b.number);
}
function periodEvidence(event){
 const p=parseBaseballPeriods(event);
 return{
   eventId:Number(event.event_id),league:str(event.league_name),home:str(event.home),away:str(event.away),
   starts:event.starts||null,providerPeriodCount:p.length,periods:p,
   f5:p.filter(x=>x.classification.startsWith("F5")),
   explicitF3:p.filter(x=>x.classification==="F3_CONFIRMED_LABEL"),
   unverified:p.filter(x=>x.classification==="UNVERIFIED_PERIOD")
 };
}
export async function auditPinnoddsMlbPeriods({apiKey,fetchImpl=fetch,now=new Date()}={}){
 const capturedAt=now.toISOString();
 if(!apiKey)return{ok:false,reason:"CREDENTIAL_UNAVAILABLE",requestsMade:0,capturedAt};
 const get=async(path)=>{
   const response=await fetchImpl(BASE+path,{
     method:"GET",headers:{"x-portal-apikey":apiKey,accept:"application/json"},
     signal:AbortSignal.timeout(21000)
   });
   if(!response.ok)return{ok:false,http:response.status,
     reason:[401,403].includes(response.status)?"AUTH_OR_PLAN_DENIED":response.status===429?"RATE_LIMITED":"UPSTREAM_HTTP_"+response.status};
   const json=await response.json();
   return{ok:true,http:response.status,data:json,status:response.headers.get("x-data-status")||null};
 };
 let n=0;
 try {
   n++;
   const list=await get("/kit/v1/prematch/fixtures?sport_id=6");
   if(!list.ok)return{ok:false,requestsMade:n,capturedAt,source:list.reason,http:list.http,canAuthorizeWager:false};
   if(!Array.isArray(list.data?.events))return{ok:false,requestsMade:n,capturedAt,reason:"BASEBALL_EVENTS_SCHEMA_UNVERIFIED"};
   const selected=list.data.events.filter(e=>isGame(e)&&isMlb(e)).slice(0,3);
   const snapshot=selected.map(periodEvidence);
   const deep=[];
   for(const e of selected){
     n++;
     const v=await get("/kit/v1/prematch/markets?event_id="+Number(e.event_id));
     if(!v.ok){deep.push({eventId:e.event_id,ok:false,reason:v.reason,http:v.http});if([401,403,429].includes(v.http))break;continue}
     let m=Array.isArray(v.data?.events)?v.data.events.find(x=>String(x.event_id)===String(e.event_id)):null;
     if(!m&&String(v.data?.event?.event_id)===String(e.event_id))m=v.data.event;
     if(!m&&String(v.data?.event_id)===String(e.event_id))m=v.data;
     if(!m){deep.push({eventId:e.event_id,ok:false,reason:"DEEP_EVENT_ID_NOT_VERIFIED",keys:Object.keys(v.data||{}).slice(0,20)});continue}
     deep.push({ok:true,http:v.http,...periodEvidence(m)});
   }
   const authoritative=deep.filter(x=>x.ok);
   const effective=authoritative.length?authoritative:snapshot;
   const f5=effective.flatMap(x=>x.f5||[]),f3=effective.flatMap(x=>x.explicitF3||[]);
   const pricedCount=xs=>({moneyline:xs.filter(x=>x.quoted.moneyline).length,
     runLines:xs.reduce((s,x)=>s+x.quoted.runLines,0),
     totals:xs.reduce((s,x)=>s+x.quoted.totals,0)});
   const rateLimited=deep.some(x=>x.reason==="RATE_LIMITED");
   return{
     ok:!rateLimited&&deep.length===selected.length&&deep.every(x=>x.ok),
     audit:"TARGETED_PINNODDS_MLB_PERIOD_MARKETS",capturedAt,requestsMade:n,requestedEvents:selected.length,
     sourceStatus:list.status,baseEventsCount:list.data.events.filter(isGame).length,
     resultAuthority:"ACTUAL_API_RESPONSE_NOT_A_PROVIDER_PERIOD_DICTIONARY",
     f5PeriodCount:f5.length,f3ExplicitlyLabeledCount:f3.length,
     priced:{F5:pricedCount(f5),F3:pricedCount(f3)},
     unknownPeriodCount:effective.flatMap(x=>x.unverified||[]).length,
     snapshotSummary:snapshot.map(x=>({eventId:x.eventId,periods:x.periods.map(p=>({key:p.key,description:p.description,classification:p.classification,quoted:p.quoted}))})),
     verifiedEventDetail:deep,confidence:"SNAPSHOT_ONLY_NOT_EXECUTABLE",
     canQualify:false,canAuthorizeWager:false,modelChanged:false};
 }catch{return{ok:false,reason:"PROVIDER_REQUEST_OR_SCHEMA_ERROR",requestsMade:n,capturedAt,canAuthorizeWager:false}}
}
