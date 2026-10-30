import {loadBoundedPolymarketSnapshot,selectBoundedPolymarketOffers} from '../lib/boundedPolymarketBoard.js';
import {ROSTER_SPORTS} from '../lib/boundedPolymarketRoster.js';
export async function onRequestGet({env}){
 const snapshot=await loadBoundedPolymarketSnapshot(env),fixtures=snapshot.ok?snapshot.roster.map(r=>({id:r.canonical_event_id,sport:r.sport,start:r.event_start_time})):[];
 const states=ROSTER_SPORTS.map(sport=>{const loaded=selectBoundedPolymarketOffers(snapshot,fixtures.filter(g=>g.sport===sport),sport);return {sport,status:loaded.available?'BOUNDED_RESEARCH_REFERENCE':snapshot.code,displayedPrices:loaded.diagnostics?.displayedOffers||0,observationCount:snapshot.ok?snapshot.quotes.filter(q=>snapshot.roster.some(r=>r.sport===sport&&r.source_market_id===q.marketSlug)).length:0,matchedGames:loaded.byId.size,lastCapture:snapshot.capturedAt||null};});
 return Response.json({ok:snapshot.ok,source:'Polymarket US',readOnly:true,states,stream:{continuous:false,capturedAt:snapshot.capturedAt||null},storageCoverage:{bindings:['ARCHIVE'],countKind:'CURRENT_BOUNDED_SNAPSHOT',complete:false},fullMarketCoverageVerified:false,canQualify:false,canAuthorizeWager:false},{status:snapshot.ok?200:503,headers:{'cache-control':'no-store'}});
}
