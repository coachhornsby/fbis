// Read-only, exact-identity NBA Kalshi shadow overlay.
// Research quotes are NOT executable and cannot change frozen projections.
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const teamNames=t=>[t?.fullName,t?.displayName,t?.name].filter(x=>typeof x==="string"&&norm(x).split(" ").length>=2).map(norm);
const stamp=v=>Number.isFinite(Date.parse(v||""))?Date.parse(v):null;
const contains=(sentence,name)=>(" "+sentence+" ").includes(" "+name+" ");
export function matchNbaKalshiResearch(games=[],snapshot={}, {now=new Date()}={}){
 const list=Array.isArray(snapshot?.records)?snapshot.records:[];
 const matched=new Map(),stats={offers:0,matched:0,rejected:0,unverified:0};
 if(snapshot?.ok!==true||snapshot.paginationComplete!==true||snapshot.sport!=="nba"||snapshot.seriesTicker!=="KXNBAGAME")
  return {byGame:matched,stats,status:"SNAPSHOT_UNAVAILABLE"};
 for(const m of list){
  stats.offers++;
  const marketAt=stamp(m.occurrenceAt),observed=stamp(m.fetchedAt);
  if(!/^KXNBAGAME-[A-Z0-9_.-]+$/.test(String(m.ticker||""))||
   !/^KXNBAGAME-[A-Z0-9_.-]+$/.test(String(m.eventTicker||""))||
   !m.ticker.startsWith(m.eventTicker+"-")||marketAt===null||observed===null||
   observed>now.getTime()||now.getTime()-observed>50*60*1000){
    stats.rejected++;continue;
  }
  const title=norm(m.title),yes=norm(m.yesLabel);
  const candidates=games.filter(g=>{
   if(String(g.sport||"").toLowerCase()!=="nba")return false;
   const kickoff=stamp(g.start||g.startTime);
   const h=teamNames(g.home),a=teamNames(g.away);
   return kickoff!==null&&Math.abs(kickoff-marketAt)<=15*60*1000&&
    h.some(n=>contains(title,n))&&a.some(n=>contains(title,n));
  });
  if(candidates.length!==1){stats.unverified++;continue;}
  const game=candidates[0],h=teamNames(game.home),a=teamNames(game.away);
  const home=h.some(n=>n===yes),away=a.some(n=>n===yes);
  if(home===away){stats.unverified++;continue;}
  const price=Number(m.yesAskDollars);
  if(m.yesAskDollars==null||!Number.isFinite(price)||price<=0||price>=1){
   stats.rejected++;continue;
  }
  const id=String(game.id),arr=matched.get(id)||[];
  arr.push({source:"Kalshi",marketFamily:"moneyline",period:"full_game",
    side:home?"home":"away",line:null,ticker:m.ticker,eventTicker:m.eventTicker,
    sourceMarketId:m.ticker,yesAskDollars:price,contractPrice:price,
    observedAt:m.fetchedAt,collectedAt:m.fetchedAt,
    providerTimestampVerified:false,executionEligible:false,
    canQualify:false,canAuthorizeWager:false,
    quoteKind:"PUBLIC_RESEARCH_YES_ASK_NOT_EXECUTABLE",
    identityStatus:"EXACT_TWO_TEAMS_AND_START_RESEARCH_MATCH",
    quoteSourceTime:null,feesVerified:false,settlementVerified:false});
  matched.set(id,arr);stats.matched++;
 }
 return {byGame:matched,stats,status:"RESEARCH_ONLY"};
}
