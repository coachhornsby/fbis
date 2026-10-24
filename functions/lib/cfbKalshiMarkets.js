/**
 * Kalshi CFB public REST game-winner reference overlay.
 * Requires independent FBIS fixture + BOTH verified provider-side labels.
 * No ticker-only alias guess, no mixing event settlement types, no wager authority.
 */
const month={JAN:"01",FEB:"02",MAR:"03",APR:"04",MAY:"05",JUN:"06",JUL:"07",AUG:"08",SEP:"09",OCT:"10",NOV:"11",DEC:"12"};
const clean=x=>String(x||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const ctDate=d=>{
 const t=Date.parse(d||"");if(!Number.isFinite(t))return null;
 const xs=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(t));
 const m=Object.fromEntries(xs.map(v=>[v.type,v.value]));return m.year+"-"+m.month+"-"+m.day;
};
const providerDay=ticker=>{const m=String(ticker||"").match(/^KXNCAAFGAME-(\d{2})([A-Z]{3})(\d{2})[A-Z0-9-]*$/);
 return m&&month[m[2]]?"20"+m[1]+"-"+month[m[2]]+"-"+m[3]:null;};
const teamMatches=(provider,team)=>{
 const n=clean(provider),full=clean(team?.name||team?.fullName||team?.school||""),
  abbr=clean(team?.abbr||"");
 return n.length>=3&&((abbr&&n===abbr)||(full&&(n===full||full.startsWith(n+" "))));
};
const price=n=>Number.isFinite(Number(n))&&Number(n)>0&&Number(n)<1?Number(n):null;
const validClock=(v,now,maxAgeMs)=>{
 const t=Date.parse(v||"");return Number.isFinite(t)&&t<=now&&now-t<=maxAgeMs;
};
export function matchKalshiCfbMoneylines(records=[],games=[],{now=new Date(),maxAgeMs=45*60000}={}){
 const time=now instanceof Date?now.getTime():Date.parse(now);
 const byId=new Map(),rejected={};const fail=reason=>{rejected[reason]=(rejected[reason]||0)+1;};
 if(!Number.isFinite(time))return {byId,matchedGames:0,quotes:0,rejected:{INVALID_CLOCK:1}};
 const groups=new Map();
 for(const r of records){
  if(r?.sport!=="cfb"||r?.seriesTicker!=="KXNCAAFGAME"||r?.status!=="active"
    ||!r?.eventTicker||!r.ticker?.startsWith(r.eventTicker+"-"))continue;
  const quote=price(r.yesAskDollars);
  if(quote==null||!validClock(r.fetchedAt,time,maxAgeMs)){fail("NO_CURRENT_BEST_ASK");continue;}
  // Kalshi published metadata is NOT itself a clock for the orderbook.
  if(!/college football/i.test(String(r.rulesPrimary||""))){fail("SETTLEMENT_MARKET_UNVERIFIED");continue;}
  const label=String(r.yesLabel||"").trim(),rules=clean(r.rulesPrimary);
  if(!label||!rules.includes(clean(label)+" wins")){fail("OUTCOME_RULE_MISMATCH");continue;}
  const a=groups.get(r.eventTicker)||[];a.push(r);groups.set(r.eventTicker,a);
 }
 let count=0;
 for(const [ticker,items] of groups){
  const day=providerDay(ticker);
  if(!day||items.length!==2||clean(items[0].yesLabel)===clean(items[1].yesLabel)){
   fail("UNVERIFIED_PAIRED_EVENT");continue;
  }
  const candidates=games.filter(g=>{
   if(ctDate(g.start)!==day||Date.parse(g.start)<=time)return false;
   const first=teamMatches(items[0].yesLabel,g.home)&&teamMatches(items[1].yesLabel,g.away);
   const second=teamMatches(items[0].yesLabel,g.away)&&teamMatches(items[1].yesLabel,g.home);
   return first||second;
  });
  if(candidates.length!==1){fail("FIXTURE_IDENTITY_AMBIGUOUS_OR_MISSING");continue;}
  const game=candidates[0];
  const knownIds=new Set(items.map(x=>x.ticker));if(knownIds.size!==2){fail("PROVIDER_OUTCOME_ID_DUPLICATED");continue;}
  const eventOffers=items.map(item=>{
   const side=teamMatches(item.yesLabel,game.home)?"home":"away";
   return {source:"Kalshi",sport:"cfb",eventId:String(game.id),marketFamily:"moneyline",
     period:"full_game",side,line:null,contractPrice:price(item.yesAskDollars),
     raw:{bestAsk:price(item.yesAskDollars),quoteProvenance:"PUBLIC_REST_BEST_ASK",rulesPrimaryVerified:true},
     sourceMarketId:item.ticker,sourceOutcomeId:"YES",
     capturedAt:item.fetchedAt,observedAt:null,
     feeVerified:false,settlementVerified:false,executionEligible:false,canQualify:false,canAuthorizeWager:false,
     providerTicker:item.ticker,quoteKind:"PUBLIC_REST_BEST_LEVEL_INDICATIVE",
     availableSizeContracts:Number(item.yesAskSize)>0?Number(item.yesAskSize):null};
  });
  const seenSides=new Set(eventOffers.map(x=>x.side));
  if(seenSides.size!==2){fail("PROVIDER_SIDES_NOT_DISTINCT");continue;}
  byId.set(String(game.id),eventOffers);count+=eventOffers.length;
 }
 return {byId,matchedGames:byId.size,quotes:count,unmatchedPairs:groups.size-byId.size,rejected,
   provider:"Kalshi",researchOnly:true,canAuthorizeWager:false};
}
