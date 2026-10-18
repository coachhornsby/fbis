/** Completeness is reconciled against explicit event and contract identities, never row counts. */
export function reconcilePolymarketCoverage({fixtures=[],pages=[],discoveryComplete=false,errors=[],stream={}}={}){
 const inventory=new Map(),matched=new Set(),ready=new Set(),enumerated=new Set();
 for(const page of pages){for(const id of page.matchedEventRefs||[])matched.add(String(id.eventId));for(const m of page.inventory||[]){inventory.set(m.market,m);if(page.operation==='markets')enumerated.add(m.market);}
  for(const batch of page.quotes||[])for(const m of batch.marketResults||[])if(m.status==='READY')ready.add(m.market);}
 const subscribed=new Set(stream.subscribedMarketIds||[]);
 const missingEvents=fixtures.filter(g=>!matched.has(String(g.id))).map(g=>({...g,reason:discoveryComplete?'NO_UNIQUE_MATCHED_PROVIDER_EVENT':'DISCOVERY_NOT_EXHAUSTED'}));
 const missingMarketEnumeration=[...inventory.values()].filter(m=>!enumerated.has(m.market));
 const missingBooks=[...inventory.values()].filter(m=>!ready.has(m.market));
 const missingSubscriptions=[...inventory.values()].filter(m=>!subscribed.has(m.market));
 const inventoryComplete=discoveryComplete&&errors.length===0&&missingMarketEnumeration.length===0;
 const marketCoverageComplete=inventoryComplete&&missingBooks.length===0&&missingSubscriptions.length===0&&(!inventory.size||stream.connected===true)&&Number(stream.uncoveredCount||0)===0&&stream.initializing!==true;
 return {scope:'INDEPENDENTLY_FORECAST_TEAM_GAMES_NEXT_48_HOURS_MONEYLINE_SPREAD_TOTAL_ALL_PERIODS',
  expectedEvents:fixtures.length,matchedEvents:fixtures.length-missingEvents.length,eligibleContracts:inventory.size,
  booksVerified:[...inventory.keys()].filter(k=>ready.has(k)).length,subscriptionsVerified:[...inventory.keys()].filter(k=>subscribed.has(k)).length,
  discoveryComplete:inventoryComplete,marketCoverageComplete,coverageComplete:marketCoverageComplete&&missingEvents.length===0,
  missingEvents,missingMarketEnumeration,missingBooks,missingSubscriptions,errors,canAuthorizeWager:false};
}
