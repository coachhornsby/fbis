import {loadKalshiR2Shadow} from "./kalshiR2Shadow.js";
const key = s => " "+String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()+" ";
const hasName=(text,name)=>name&&key(text).includes(key(name));
/** Research-only; event-title and contract rules must include BOTH full names.
 * No ticker abbreviation guessing, no bookmaker EV, no execution authority.
 */
export function matchKalshiTennisResearch(fixture,rows=[],now=new Date()){
 const tour=String(fixture?.tour||"").toLowerCase();
 const names=[fixture?.away_name,fixture?.home_name];
 const start=Date.parse(fixture?.start||"");
 if(!["atp","wta"].includes(tour)||!Number.isFinite(start)||
    names.some(n=>String(n||"").trim().split(/\s+/).length<2))return [];
 const matched=(rows||[]).filter(row=>{
  if(row?.sport!==tour||row?.status!=="active"&&row?.status!=="open")return false;
  if(!row.eventTicker||!row.ticker?.startsWith(tour==="atp"?"KXATPMATCH-":"KXWTAMATCH-"))return false;
  const text=[row.title,row.rulesPrimary,row.rulesSecondary].filter(Boolean).join(" ");
  if(!names.every(n=>hasName(text,n)))return false;
  const age=+now-Date.parse(row.fetchedAt||"");
  if(!Number.isFinite(age)||age<0||age>90*60000)return false;
  const cutoff=Date.parse(row.closeAt||row.expectedExpirationAt||"");
  if(!Number.isFinite(cutoff)||Math.abs(cutoff-start)>36*3600000)return false;
  return true;
 });
 const events=[...new Set(matched.map(r=>r.eventTicker))];
 if(events.length!==1)return []; // mixed or ambiguous provider events
 return matched.map(r=>({
  provider:"Kalshi",eventTicker:r.eventTicker,ticker:r.ticker,
  title:r.title,yesLabel:r.yesLabel,yesAskDollars:r.yesAskDollars??null,
  yesBidDollars:r.yesBidDollars??null,volumeContracts:r.volumeContracts??null,
  fetchedAt:r.fetchedAt,quoteSourceTime:null,source:"SIGNED_R2_RESEARCH",
  quoteKind:"INDICATIVE_MARKET_TOP_NOT_VERIFIED_FILLABLE",
  canQualify:false,canAuthorizeWager:false,executionEligible:false,
 }));
}
export async function loadKalshiTennisResearch(env,now=new Date()){
 if(!env?.ARCHIVE?.get)return {atp:[],wta:[],status:"R2_UNAVAILABLE"};
 const [a,b]=await Promise.all(["atp","wta"].map(tour=>
  loadKalshiR2Shadow(env,tour,{now,maxAgeMs:90*60000}).catch(()=>null)));
 return {atp:a?.ok&&a.sourceQueryComplete?a.records:[],
  wta:b?.ok&&b.sourceQueryComplete?b.records:[],
  status:a?.ok||b?.ok?"RESEARCH_SNAPSHOT":"NO_FRESH_SNAPSHOT"};
}
