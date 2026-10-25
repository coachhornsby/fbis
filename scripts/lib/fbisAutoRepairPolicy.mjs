/**
 * FBIS production reliability invariants — every sport, every displayed fixture.
 * Missing source data is NOT repaired by inventing a quote or projection.
 * Only provider-verified source clocks count as CURRENT.
 */
export const PROP_SPORTS=['nfl','nba','nhl','mlb','cfb','wnba','cbb','tennis','soccer','npb','kbo'];
const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const clock=v=>v?Date.parse(v):NaN;
const gameKey=g=>String(g.sport||'')+'|'+String(g.id||'');
const family=o=>{
 const x=String(o?.marketFamily||o?.marketType||o?.market||o?.type||'').toLowerCase();
 if(/moneyline|h2h|1x2|winner|match_winner|match odds/.test(x))return 'moneyline';
 if(/spread|handicap|run.line|puck.line/.test(x))return 'spread';
 if(/total|over.under|ou_/.test(x))return 'total';
 return null;
};
const expectedFamilies=sport=>sport==='tennis'?['moneyline']:sport==='soccer'?['moneyline','total']:
 ['moneyline','spread','total'];
const stat=v=>v==='pra'?'points_rebounds_assists':v;
export const propKey=r=>[r.sport,r.canonicalEventId,r.canonicalPlayerId,stat(r.canonical_market),r.period].join('|');
const issue=(kind,sport,eventId,reason,details={})=>({kind,sport,eventId:String(eventId||''),reason,...details});
export const isActiveGame=(g,now=Date.now(),horizonMs=36*3600000)=>{
 const start=clock(g.start);
 const live=String(g?.status||'').toLowerCase()==='live';
 return Boolean(g?.sport&&g?.id)&&Number.isFinite(start)&&start<=now+horizonMs&&
  (start>=now-5*3600000||live)&&!['final','postponed','canceled','cancelled','suspended'].includes(String(g.status||'').toLowerCase());
};
export function verifiedCurrentQuote(o,now=Date.now(),maxAgeMs=2*3600000){
 // A local ingestion clock is NOT proof of a provider-side quote time.
 if(!o||o.priceVerified!==true||o.marketAvailable!==true||o.identityVerified===false)return false;
 const provenance=o.providerTimestampVerified===true||
   ['PROVIDER_VERIFIED','SOURCE_VERIFIED','VERIFIED_PROVIDER_TIMESTAMP'].includes(o.quoteClockStatus);
 if(!provenance)return false;
 const asOf=clock(o.sourceObservedAt||o.providerObservedAt||o.observedAt);
 return Number.isFinite(asOf)&&asOf<=now&&now-asOf<=maxAgeMs;
}
export function assessFixtureCoverage(board,{now=Date.now(),horizonMs=36*3600000,quoteMaxAgeMs=2*3600000}={}){
 const all=Array.isArray(board?.games)?board.games:[];
 const included=all.filter(g=>isActiveGame(g,now,horizonMs));
 const findings=[],games=[];
 for(const g of included){
  const offers=Array.isArray(g.market?.venueOffers)?g.market.venueOffers:[];
  const verified=offers.filter(o=>verifiedCurrentQuote(o,now,quoteMaxAgeMs));
  const hasReference=(Array.isArray(g.pinnoddsResearch?.offers)&&g.pinnoddsResearch.offers.length>0)||
    offers.length>0||g.referenceMarketAvailable===true;
  const current=verified.length>0;
  const byFamily={moneyline:0,spread:0,total:0};
  for(const offer of verified){const key=family(offer);if(key)byFamily[key]++;}
  const hasClassified=Object.values(byFamily).some(n=>n>0);
  const missingFamilies=hasClassified?expectedFamilies(g.sport).filter(k=>byFamily[k]===0):[];
  // Active markets without a source-side quote clock are not "current".
  const projectionGood=g.projectionUnavailable===false&&g.projectionKind!=='UNAVAILABLE'||
   (g.projectionUnavailable!==true&&g.pureProjectionAvailable===true);
  if(!current)findings.push(issue('GAME_ODDS',g.sport,g.id,
    hasReference?'MARKET_REFERENCE_ONLY_OR_CLOCK_UNVERIFIED':'CURRENT_GAME_MARKET_MISSING',
    {offers:offers.length,hasReference,phase:Date.parse(g.start)<=now?'LIVE':'PREGAME'}));
  if(current&&hasClassified&&missingFamilies.length)findings.push(issue('GAME_ODDS',g.sport,g.id,
   'CURRENT_MARKET_FAMILY_MISSING',{missingFamilies,verifiedFamilies:byFamily}));
  if(current&&!hasClassified)findings.push(issue('GAME_ODDS',g.sport,g.id,'CURRENT_MARKET_TYPE_UNCLASSIFIED'));
  if(!projectionGood)findings.push(issue('MODELS',g.sport,g.id,'FBIS_GAME_PROJECTION_MISSING_OR_UNVERIFIED'));
  games.push({sport:g.sport,eventId:String(g.id),start:g.start,status:g.status,
   currentOdds:current,currentQuoteCount:verified.length,referenceOnly:hasReference&&!current,
   modelAvailable:projectionGood,marketOffers:offers.length,verifiedFamilies:byFamily,missingFamilies});
 }
 return {games,findings,counts:{activeGames:games.length,currentMarketGames:games.filter(g=>g.currentOdds).length,
  referenceOnlyGames:games.filter(g=>g.referenceOnly).length,modelGames:games.filter(g=>g.modelAvailable).length}};
}
export function assessPropCoverage({sport,games=[],models=[],contracts=[],now=Date.now(),horizonMs=36*3600000,quoteMaxAgeMs=2*3600000}={}){
 const gamesActive=games.filter(g=>g.sport===sport&&isActiveGame(g,now,horizonMs));
 const events=new Set(gamesActive.map(g=>String(g.id)));
 const eligibleModels=models.filter(r=>r.sport===sport&&events.has(String(r.canonicalEventId))&&
  r.independent===true&&r.marketInformed!==true&&num(r.fbis_projection)!=null&&
  r.identityVerified===true&&Boolean(r.modelId)&&Boolean(r.modelVersion));
 const modelIndex=new Set(eligibleModels.map(propKey));
 const validContracts=contracts.filter(c=>c.sport===sport&&events.has(String(c.canonicalEventId))&&
  c.identityVerified===true&&num(c.line)!=null&&Boolean(c.contractId)&&c.period==='full_game');
 const matched=validContracts.filter(c=>modelIndex.has(propKey(c)));
 const current=validContracts.filter(c=>verifiedCurrentQuote(c,now,quoteMaxAgeMs));
 const matchedCurrent=current.filter(c=>modelIndex.has(propKey(c)));
 const unmatched=validContracts.filter(c=>!modelIndex.has(propKey(c)));
 const missingMarkets=eligibleModels.filter(m=>!validContracts.some(c=>propKey(c)===propKey(m)));
 const findings=[];
 if(unmatched.length)findings.push(issue('MODELS',sport,null,'PLAYER_PROP_MODEL_NOT_MATCHED',
  {count:unmatched.length,sample:unmatched.slice(0,8).map(x=>({eventId:x.canonicalEventId,playerId:x.canonicalPlayerId,stat:x.canonical_market}))}));
 if(eligibleModels.length&&missingMarkets.length)findings.push(issue('PLAYER_PROPS',sport,null,'PLAYER_PROP_MARKET_CONTRACT_MISSING',
  {count:missingMarkets.length,models:eligibleModels.length,sample:missingMarkets.slice(0,8).map(m=>({eventId:m.canonicalEventId,playerId:m.canonicalPlayerId,stat:m.canonical_market}))}));
 if(validContracts.length&&!matchedCurrent.length)findings.push(issue('PLAYER_PROPS',sport,null,'PLAYER_PROP_CURRENT_QUOTE_UNVERIFIED',
  {count:validContracts.length,matched:matched.length}));
 if(!validContracts.length&&gamesActive.length)findings.push(issue('PLAYER_PROPS',sport,null,'NO_VERIFIED_PROVIDER_PROP_CONTRACTS',
  {games:gamesActive.length,models:eligibleModels.length}));
 return {sport,findings,counts:{fixtures:gamesActive.length,independentModels:eligibleModels.length,
  validContracts:validContracts.length,matchedContracts:matched.length,unmatchedContracts:unmatched.length,
  currentQuotes:current.length,matchedCurrentQuotes:matchedCurrent.length,
  projectionsWithoutMarket:missingMarkets.length}};
}
export function summarizeReliability(reports,{date,asOf=new Date().toISOString()}={}){
 const findings=reports.flatMap(r=>r.findings||[]);
 const groups={GAME_ODDS:[],PLAYER_PROPS:[],MODELS:[],PIPELINE:[]};
 for(const f of findings)(groups[f.kind]||groups.PIPELINE).push(f);
 return {schemaVersion:1,date,asOf,ok:findings.length===0,groups,
  counts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),
  reports,canAuthorizeWager:false,paidProviderCalls:0};
}
