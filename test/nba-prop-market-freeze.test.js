import test from 'node:test';
import assert from 'node:assert/strict';
import {updateNbaPregameLineLedger,captureNbaPregameMarketLines,readNbaFrozenMarketLines} from '../functions/lib/nbaPropMarketFreeze.js';
const start='2026-10-25T00:00:00Z';
const base={id:'poly:one:yes',sport:'nba',provider:'Polymarket',identityVerified:true,contractId:'one',canonicalEventId:'401909858',
 canonicalPlayerId:'nba:espn:5061568',canonical_market:'points',line:19.5,period:'full_game',side:'yes',start_time:start,
 collectedAt:'2026-10-24T23:30:00Z',observedReferencePrice:.52,canAuthorizeWager:false};
test('NBA freeze selects newest captured pretip quote and preserves it after start',()=>{
 const pre=updateNbaPregameLineLedger([],[base],{provider:'Polymarket',date:'2026-10-24',now:base.collectedAt});
 assert.equal(pre.added,1);
 const later={...base,collectedAt:'2026-10-24T23:50:00Z',observedReferencePrice:.48};
 const next=updateNbaPregameLineLedger(pre.rows,[later],{provider:'Polymarket',date:'2026-10-24',now:later.collectedAt});
 assert.equal(next.rows[0].observedReferencePrice,.48);
 const after=updateNbaPregameLineLedger(next.rows,[{...base,collectedAt:'2026-10-25T00:01:00Z',line:20.5}],{provider:'Polymarket',date:'2026-10-24',now:'2026-10-25T00:01:00Z'});
 assert.equal(after.updated,0);assert.equal(after.rows[0].line,19.5);
 assert.equal(after.rows[0].observedReferencePrice,.48);
});
test('NBA freeze rejects post-tip, later-altered capture clocks, and unidentified contracts',()=>{
 const at='2026-10-24T23:55:00Z';
 const bad=[{...base,identityVerified:false},{...base,collectedAt:'2026-10-25T00:01:00Z'},
 {...base,collectedAt:'2026-10-24T23:10:00Z'}, {...base,canonicalPlayerId:'nba:espn:invalid'}, {...base,line:null}];
 assert.equal(updateNbaPregameLineLedger([],[...bad],{provider:'Polymarket',date:'2026-10-24',now:at}).rows.length,0);
});
test('NBA persisted ledger is research-only and read fails closed for unrecorded pregame contracts',async()=>{
 const objects=new Map();
 const ARCHIVE={get:async k=>objects.has(k)?{json:async()=>objects.get(k)}:null,put:async(k,v)=>objects.set(k,JSON.parse(v))};
 const env={ARCHIVE},date='2026-10-24';
 assert.equal((await readNbaFrozenMarketLines(env,{provider:'Polymarket',date,now:Date.parse(start)})).rows.length,0);
 const captured=await captureNbaPregameMarketLines(env,{provider:'Polymarket',date,rows:[base],now:new Date(base.collectedAt)});
 assert.equal(captured.added,1);
 const prior=await readNbaFrozenMarketLines(env,{provider:'Polymarket',date,now:Date.parse('2026-10-24T23:59:00Z')});
 assert.equal(prior.rows.length,0);
 const final=await readNbaFrozenMarketLines(env,{provider:'Polymarket',date,now:Date.parse(start)});
 assert.equal(final.rows.length,1);
 assert.equal(final.rows[0].lineFrozen,true);assert.equal(final.rows[0].line,19.5);
 assert.equal(final.rows[0].purchaseAsk,null);assert.equal(final.rows[0].marketAvailable,false);
 assert.equal(final.rows[0].sourceCaptureAt,base.collectedAt);
});
