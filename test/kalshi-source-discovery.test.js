import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverKalshiPlayerSeries} from '../functions/lib/propProviderAdapters.js';
import {captureKalshiPlayerProps,loadCapturedKalshiProps} from '../functions/lib/kalshiPlayerPropCollector.js';
const candidate='KXNCAAFPLAYERPASS';
function archive(){
 const data=new Map();
 return {data,async get(k){return data.has(k)?{json:async()=>JSON.parse(data.get(k))}:null;},
  async put(k,v){data.set(k,String(v))},async delete(k){data.delete(k)}};
}
test('catalog discovery includes new college player-stat series but not team or season lines',()=>{
 const got=discoverKalshiPlayerSeries([
  {ticker:candidate,title:'College Football Player Passing Yards'},
  {ticker:'KXNCAAFTEAMTOTAL',title:'College Football Team Points'},
  {ticker:'KXNBAMVP',title:'NBA MVP Award Winner'},
  {ticker:'KXNBAREBMORE',title:'Pro Basketball Player Rebounds'},
  {ticker:'KXNFLPASSYDS',title:'NFL Player Passing Yards'}
 ]);
 assert.deepEqual(got[candidate],['cfb','SOURCE_SERIES_UNVERIFIED']);
 assert.deepEqual(got.KXNBAREBMORE,['nba','SOURCE_SERIES_UNVERIFIED']);
 assert.equal(got.KXNCAAFTEAMTOTAL,undefined);
 assert.equal(got.KXNBAMVP,undefined);
 assert.equal(got.KXNFLPASSYDS,undefined);
});
test('new source series are captured under provider inventory but never assigned synthetic identity or wager authority',async()=>{
 const store=archive();
 const series=[{ticker:'KXNFLPASSYDS',title:'NFL Player Passing Yards'},
  {ticker:candidate,title:'College Football Player Passing Yards'}];
 store.data.set('kalshi/public-shadow/v1/series-catalog.json',JSON.stringify({ok:true,records:series}));
 const now=new Date('2026-10-25T17:00:00Z');
 const seen=[];
 const signedProxy=async url=>{
  const x=new URL(url),ticker=x.searchParams.get('series_ticker');
  seen.push(ticker);
  return Response.json({markets:[{
   ticker:ticker+'-26OCT25-SAMPLE',
   title:'Alex Example 225+ Passing Yards',
   rules_primary:'If Alex Example records 225+ passing yards in Alabama vs LSU professional football game originally scheduled for Oct 25, 2026 at 8:00 PM EDT, then the market resolves to Yes.',
   floor_strike:224.5,strike_type:'greater'
  }],cursor:''});
 };
 const env={ARCHIVE:store};
 const captured=await captureKalshiPlayerProps(env,{now,signedProxy,maxSeries:2,maxPages:1});
 assert.equal(captured.candidateSeries,1);
 assert.equal(captured.knownSeries,1);
 assert.deepEqual(seen.sort(),[candidate,'KXNFLPASSYDS'].sort());
 assert.equal(captured.completeSeries,2);
 const loaded=await loadCapturedKalshiProps(env,{sport:'cfb',now:now.getTime(),games:[],players:[]});
 assert.equal(loaded.rows.length,0);
 assert.equal(loaded.rejected.length,1);
 assert.equal(loaded.rejected[0].reason,'NEW_KALSHI_PROP_SERIES_SETTLEMENT_UNVERIFIED');
 assert.equal(loaded.rejected[0].identityVerified,false);
 assert.equal(loaded.rejected[0].canAuthorizeWager,false);
 assert.equal(loaded.coverage[0].sport,'cfb');
});
