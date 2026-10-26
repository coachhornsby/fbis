import test from 'node:test';
import assert from 'node:assert/strict';
import {captureGlobalSportCatalogPage,getGlobalSportCatalog,readGlobalSportCatalogPage} from '../functions/lib/polymarketGlobalSportCatalog.js';
import {onRequestGet as publicRead} from '../functions/api/polymarket-global-sport-research.js';

function archive(){
 const m=new Map();
 return {objects:m,async get(k){return m.has(k)?{json:async()=>JSON.parse(m.get(k))}:null;},
  async put(k,v){m.set(k,String(v));}};
}
const day='2026-10-25';
const event=n=>({id:n,slug:'nba-game-'+n,markets:[
 {id:'p-'+n,slug:'p-'+n,active:true,closed:false,question:'Alex Example: Points O/U 12.5',line:12.5,outcomePrices:'["0.4","0.6"]'},
 {id:'g-'+n,slug:'g-'+n,active:true,closed:false,question:'Chicago to win'}]});
test('Gamma sport catalogue continues beyond one bounded 20-event page',async()=>{
 const env={ARCHIVE:archive()};
 const p0=await captureGlobalSportCatalogPage(env,{sport:'nba',day,offset:0,
  events:Array.from({length:20},(_,i)=>event(i))});
 assert.equal(p0.status,'PARTIAL');
 assert.equal(p0.nextOffset,20);
 assert.equal(p0.markets,40);
 const invalid=await captureGlobalSportCatalogPage(env,{sport:'nba',day,offset:40,events:[event(40)]});
 assert.equal(invalid.ok,false);
 const p1=await captureGlobalSportCatalogPage(env,{sport:'nba',day,offset:20,events:[event(20)]});
 assert.equal(p1.complete,true);
 assert.equal(p1.events,21);
 const saved=await getGlobalSportCatalog(env,{sport:'nba',day});
 assert.equal(saved.pages.length,2);
 const page=await readGlobalSportCatalogPage(env,{sport:'nba',day,page:1});
 assert.equal(page.marketOnly.length,1);
 assert.equal(page.marketOnly[0].line,12.5);
 assert.equal(page.marketOnly[0].purchaseAsk,null);
 assert.equal(page.marketOnly[0].canAuthorizeWager,false);
 assert.equal(page.marketOnly[0].identityVerified,false);
 const publicResp=await publicRead({env,request:new Request('https://fbis.test/api/polymarket-global-sport-research?day='+day+'&sport=nba&page=1')});
 assert.equal(publicResp.status,200);
 assert.equal((await publicResp.json()).marketOnly.length,1);
});
test('out of scope sports, malformed pages, missing storage fail closed',async()=>{
 const env={ARCHIVE:archive()};
 assert.equal((await captureGlobalSportCatalogPage(env,{sport:'soccer',day,offset:0,events:[]})).ok,false);
 assert.equal((await captureGlobalSportCatalogPage(env,{sport:'nfl',day,offset:5,events:[]})).ok,false);
 assert.equal((await captureGlobalSportCatalogPage({}, {sport:'nfl',day,offset:0,events:[]})).ok,false);
 assert.equal((await readGlobalSportCatalogPage(env,{sport:'nfl',day,page:-1})).ok,false);
});
