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
const expectedFamilies=(sport,offers=[])=>sport==='tennis'?['moneyline']:
 sport==='soccer'?['moneyline',...(offers.some(o=>family(o)==='spread')?['spread']:[]),'total']:
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
 // Source-timed BBO observations are research market quotes, NEVER
 // executable/wager-authorized orders. Track their freshness independently
 // from the operator's execution market eligibility.
 const safeResearchBbo=o?.source==='Polymarket US WebSocket'&&
  o.observedReferenceCurrent===true&&o.temporal?.status==='CURRENT'&&
  o.executionEligible===false&&o.canAuthorizeWager===false;
 if(!o||o.priceVerified!==true||o.identityVerified===false||
  o.suspended===true||o.active===false||['CLOSED','SUSPENDED','EXPIRED','INACTIVE'].includes(String(o.marketState||o.status||'').toUpperCase())||
  (o.snapshotType&&o.snapshotType!=='CURRENT')||
  (o.marketAvailable!==true&&!safeResearchBbo))return false;
 const provenance=o.providerTimestampVerified===true||
   ['PROVIDER_VERIFIED','SOURCE_VERIFIED','VERIFIED_PROVIDER_TIMESTAMP'].includes(o.quoteClockStatus);
 if(!provenance)return false;
 const asOf=clock(o.sourceObservedAt||o.providerObservedAt||o.observedAt);
 return Number.isFinite(asOf)&&asOf<=now&&now-asOf<=maxAgeMs;
}
const marketPrice=o=>{
 const contract=num(o?.contractPrice??o?.observedAsk??o?.yesAskDollars);
 if(contract!=null&&contract>0&&contract<1)return true;
 const decimal=num(o?.decimalOdds);if(decimal!=null&&decimal>1)return true;
 const american=num(o?.americanOdds);return american!=null&&Math.abs(american)>=100;
};
const side=o=>{
 const s=String(o?.side??o?.statSide??'').trim().toLowerCase();
 if(['home','away','over','under','draw','tie'].includes(s))return s==='tie'?'draw':s;
 return null;
};
const sourceMarketKey=o=>{
 const name=String(o?.source||o?.provider||'');
 const id=String(o?.sourceMarketId||o?.marketId||'');
 return name&&id?name+'|'+id:null;
};
const expectedSides=(family,sport)=>family==='total'?['over','under']:
 family==='moneyline'&&sport==='soccer'?['home','away','draw']:['home','away'];
export function marketFamilyEvidence(offers=[],familyName,{now=Date.now(),maxAgeMs=2*3600000,sport=null}={}){
 const relevant=offers.filter(o=>family(o)===familyName);
 const full=relevant.filter(o=>o.period==='full_game');
 const priced=full.filter(marketPrice);
 const verified=priced.filter(o=>verifiedCurrentQuote(o,now,maxAgeMs));
 const grouped=new Map();
 for(const offer of verified){
  const mk=sourceMarketKey(offer),direction=side(offer);
  if(!mk||!direction)continue;
  const line=num(offer.line);
  if(familyName!=='moneyline'&&line===null)continue;
  // Opposing spread selections have opposite signs. Totals share one
  // positive threshold; taking abs(total) would hide malformed lines.
  if(familyName==='total'&&line<=0)continue;
  const threshold=familyName==='moneyline'?'none':
   (familyName==='spread'?(direction==='away'?-line:line):line).toFixed(3);
  const key=mk+'|'+threshold;
  if(!grouped.has(key))grouped.set(key,new Set());
  grouped.get(key).add(direction);
 }
 let paired=[...grouped.values()].filter(s=>expectedSides(familyName,sport).every(x=>s.has(x))).length;
 let complementaryBinary=false;
 let groupingMethod='MATCHED_TWO_SIDES_SAME_SOURCE_MARKET';
 if(sport==='soccer'&&familyName==='moneyline'){
  // Polymarket US lists HOME, DRAW and AWAY as THREE separate binary contracts
  // under the SAME canonical event (already scoped by assessFixtureCoverage).
  // Require each independent source-book price and distinct market IDs.
  const bySource=new Map();
  for(const o of verified){
   if(!sourceMarketKey(o)||!['home','draw','away'].includes(side(o)))continue;
   const key=String(o.source||o.provider||'');
   if(!bySource.has(key))bySource.set(key,new Map());
   const m=bySource.get(key);m.set(side(o),o.sourceMarketId);
  }
  paired=[...bySource.values()].filter(m=>['home','draw','away'].every(x=>m.has(x))&&
   new Set(m.values()).size===3).length;
  groupingMethod='THREE_INDEPENDENT_BINARY_CONTRACTS_SAME_CANONICAL_GAME';
 }
 if(sport==='soccer'&&familyName==='total'&&!paired){
  // A YES=OVER contract has a live bid AND ask. A NO/UNDER quote is a
  // mathematical complement of YES bid, NOT a separately observed under ask.
  // We certify the binary market receipt only; no derived price is displayed.
  const binary=verified.filter(o=>o.source==='Polymarket US WebSocket'&&
   o.quoteKind==='OBSERVED_BBO_NOT_GUARANTEED_FILL'&&side(o)==='over'&&
   Number.isFinite(num(o.line))&&o.line!=null&&
   num(o.raw?.bestBid)>0&&num(o.raw?.bestAsk)>0&&
   num(o.raw.bestBid)<=num(o.raw.bestAsk)&&
   o.canAuthorizeWager===false&&o.executionEligible===false);
  if(binary.length){paired=binary.length;complementaryBinary=true;
   groupingMethod='ONE_PROVIDER_TIMED_OVER_BINARY_BID_ASK_UNDER_NOT_OBSERVED';}
 }
 const state=paired?(complementaryBinary?'PROVIDER_TIMED_BINARY_OVER_BOOK':'VERIFIED_CURRENT_PAIR'):!relevant.length?'NO_REFERENCE':
  !full.length?(relevant.every(o=>!o.period||o.period==='unspecified')?'SETTLEMENT_PERIOD_UNVERIFIED':'PERIOD_NOT_FULL_GAME'):
  !priced.length?'NO_NUMERIC_PRICE':
  !verified.length?'PROVIDER_CLOCK_OR_PRICE_UNVERIFIED':'UNPAIRED_CURRENT_MARKET';
 return {state,referenceOutcomes:relevant.length,fullGameOutcomes:full.length,
  verifiedOutcomes:verified.length,verifiedPairs:paired,available:paired>0,
  verificationMethod:groupingMethod,underPriceIndependentlyObserved:!complementaryBinary};
};
export function independentlyProjectedGame(g){
 const kind=String(g?.projectionKind||'').toUpperCase();
 const prob=num(g?.tennisProjection?.player1WinProb),other=num(g?.tennisProjection?.player2WinProb);
 if(g?.sport==='tennis')return g.tennisProjection?.eventIntegrity?.valid===true&&
  prob!=null&&other!=null&&prob>=0&&prob<=1&&other>=0&&other<=1&&
  Math.abs(prob+other-1)<0.015;
 return kind==='FBIS'&&num(g.projHome)!=null&&num(g.projAway)!=null&&
  g.projectionUnavailable!==true;
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
  // Each family requires its own verified, full-game, two-sided market.
  // One moneyline is never evidence of a spread or total.
  const families=Object.fromEntries(expectedFamilies(g.sport,offers).map(name=>[
   name,marketFamilyEvidence(offers,name,{now,maxAgeMs:quoteMaxAgeMs,sport:g.sport})]));
  const missingFamilies=Object.keys(families).filter(k=>!families[k].available);
  const current=missingFamilies.length===0;
  const byFamily={moneyline:0,spread:0,total:0};
  for(const [key,result] of Object.entries(families))byFamily[key]=result.verifiedPairs;
  const projectionGood=independentlyProjectedGame(g);
  if(missingFamilies.length)findings.push(issue('GAME_ODDS',g.sport,g.id,
    hasReference?'CURRENT_MARKET_FAMILY_INCOMPLETE':'CURRENT_GAME_MARKET_MISSING',
    {missingFamilies,families,offers:offers.length,hasReference,
      phase:Date.parse(g.start)<=now?'LIVE':'PREGAME'}));
  if(!projectionGood)findings.push(issue('MODELS',g.sport,g.id,'FBIS_GAME_PROJECTION_MISSING_OR_UNVERIFIED'));
  games.push({sport:g.sport,eventId:String(g.id),start:g.start,status:g.status,
   currentOdds:current,currentQuoteCount:verified.length,referenceOnly:hasReference&&!current,
   modelAvailable:projectionGood,marketOffers:offers.length,verifiedFamilies:byFamily,missingFamilies,families});
 }
 return {games,findings,counts:{activeGames:games.length,currentMarketGames:games.filter(g=>g.currentOdds).length,
  referenceOnlyGames:games.filter(g=>g.referenceOnly).length,modelGames:games.filter(g=>g.modelAvailable).length,
  marketFamilies:Object.fromEntries(['moneyline','spread','total'].map(k=>[k,{
    required:games.filter(g=>g.families[k]).length,
    complete:games.filter(g=>g.families[k]?.available===true).length,
    incomplete:games.filter(g=>g.families[k]?.available===false).length,
    capturedReferences:games.reduce((sum,g)=>sum+(g.families[k]?.referenceOutcomes||0),0)
  }]))}};
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
