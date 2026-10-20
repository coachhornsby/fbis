import test from 'node:test';
import assert from 'node:assert/strict';
import {executedCardId,syncPlayerPropCardSettlements} from '../functions/lib/playerPropCardSettlement.js';
function fixture({risk=3,date='2026-10-04',legResult='LOST'}={}) {
 const card={card_id:'PP-20261004-A',date:'2026-10-04',risk:3,profit:-3,result:'LOST',settled_at:'2026-10-05 01:02:21'};
 const bet={id:'tracker-A',date,risk_amount:risk,result:'OPEN',tracker_metadata_json:JSON.stringify({notes:'Card PP-20261004-A · captured'})};
 const audits=[];
 const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async all(){return {results:sql.includes('FROM player_prop_cards')?[card]:sql.includes('FROM executed_bets')?(bet.result==='OPEN'?[bet]:[]):[{leg_id:'A3',event_id:'verified',actual:13,result:legResult,stat_source:'ESPN_OFFICIAL_BOXSCORE'}]}}}},async batch(stmts){audits.push(stmts[0].args);bet.result=stmts[1].args[0];bet.profit=stmts[1].args[1];return [{meta:{changes:1}},{meta:{changes:1}}]}};
 return {db,bet,audits};
}
test('settled card propagates to tracker mirror once with evidence and original settlement time',async()=>{
 const f=fixture();assert.deepEqual(await syncPlayerPropCardSettlements(f.db),{synchronized:1,conflicts:[]});assert.equal(f.bet.result,'LOST');assert.equal(f.bet.profit,-3);assert.equal(f.audits.length,1);assert.equal(JSON.parse(f.audits[0][0]).settledAt,'2026-10-05 01:02:21');assert.equal((await syncPlayerPropCardSettlements(f.db)).synchronized,0);assert.equal(f.audits.length,1);
});
test('date, stake and unfinished-leg conflicts fail closed',async()=>{
 for(const opts of [{risk:5},{date:'2026-10-05'},{legResult:'OPEN'}]){const f=fixture(opts);assert.deepEqual(await syncPlayerPropCardSettlements(f.db),{synchronized:0,conflicts:['tracker-A']});assert.equal(f.bet.result,'OPEN');assert.equal(f.audits.length,0)}
});
test('card identity uses explicit identity or bounded tracker note',()=>{
 assert.equal(executedCardId({external_ticket_id:'PP-20261004-A'}),'PP-20261004-A');assert.equal(executedCardId({tracker_metadata_json:'{invalid'}),null);assert.equal(executedCardId({tracker_metadata_json:JSON.stringify({notes:'Card PP-20261004-A2 · details'})}),'PP-20261004-A2');
});

// The current board requests a bounded ledger; historical readers retain the full ledger.
import {onRequestGet as readLedger} from '../functions/api/player-prop-learning.js';
test('current prop ledger filters cards, legs and totals together without deleting history',async()=>{
 const cards=[{card_id:'old',date:'2026-10-04',sport:'nfl'},{card_id:'today',date:'2026-10-19',sport:'nfl'},{card_id:'mlb',date:'2026-10-19',sport:'mlb'}];
 const legs=cards.map(c=>({card_id:c.card_id,actual:1,result:'WON',hit:1,absolute_error:2,projection_error:2}));
 const calls=[];
 const db={prepare(sql){calls.push(sql);return {args:[],bind(...args){this.args=args;return this},async all(){
   if(sql.includes('player_prop_calibration'))return {results:[]};
   const selected=cards.filter(c=>(!sql.includes('date=?')||c.date===this.args[0])&&(!sql.includes('LOWER(sport)=?')||c.sport===this.args.at(-1)));
   return {results:sql.startsWith('SELECT * FROM player_prop_legs')?legs.filter(l=>selected.some(c=>c.card_id===l.card_id)):selected};
 }}}};
 const current=await (await readLedger({env:{DB:db},request:new Request('https://example.test/api/player-prop-learning?date=2026-10-19&sport=nfl')})).json();
 assert.deepEqual(current.cards.map(c=>c.card_id),['today']);assert.equal(current.summary.cards,1);assert.equal(current.summary.gradedLegs,1);assert.equal(current.summary.hitRate,1);
 const history=await (await readLedger({env:{DB:db},request:new Request('https://example.test/api/player-prop-learning')})).json();
 assert.equal(history.cards.length,3);assert.equal(history.summary.gradedLegs,3);assert.ok(calls.every(sql=>sql.startsWith('SELECT')));
 for(const date of ['2026-02-30','not-a-date'])assert.equal((await readLedger({env:{DB:db},request:new Request('https://example.test/?date='+date)})).status,400);
});
