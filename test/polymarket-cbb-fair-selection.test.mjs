import test from 'node:test';import assert from 'node:assert/strict';
import {balancedCbbMarkets,balancedCbbCandidates} from '../services/polymarket-rest-collector/fairSelection.mjs';
const market=(id,family='total',period='first_half')=>({slug:id,sportsMarketType:`cbb_${period}_${family}`,sportsMarketTypeV2:family.toUpperCase()});
test('twenty-four alternate totals cannot starve other supported families',()=>{
 const totals=Array.from({length:30},(_,i)=>market('h'+i));
 const full=['moneyline','spread','total'].map(f=>market(f,f,'full_game'));
 const chosen=balancedCbbMarkets([...totals,...full]);assert.equal(chosen.length,24);assert.deepEqual(chosen.slice(0,4).map(m=>m.slug),['moneyline','spread','total','h0']);
 assert.deepEqual(chosen.filter(m=>m.slug.startsWith('h')).map(m=>m.slug),totals.slice(0,21).map(m=>m.slug));
});
test('unsupported periods and aliases never get a supported selection bucket',()=>{
 const invalid=[{sportsMarketType:'mystery',sportsMarketTypeV2:'TOTAL'},market('second','total','second_half'),market('team','team_total','full_game'),{sportsMarketType:'cbb_full_game_unknown',sportsMarketTypeV2:'UNKNOWN'}];
 assert.deepEqual(balancedCbbMarkets(invalid),[]);
});
test('fifty-candidate allocation reaches later events and preserves each family order',()=>{
 const rows=[];for(let e=0;e<10;e++)for(const f of ['moneyline','spread','total'])for(let n=0;n<20;n++)rows.push({canonical_event_id:'e'+e,market_family:f,source_market_id:`${e}-${f}-${n}`,displayBinding:{period:'full_game'}});
 const out=balancedCbbCandidates(rows);assert.equal(out.length,50);assert.equal(new Set(out.slice(0,10).map(r=>r.canonical_event_id)).size,10);
 for(let e=0;e<10;e++){const group=out.filter(r=>r.canonical_event_id==='e'+e);assert.deepEqual(group.map(r=>r.market_family),['moneyline','spread','total','moneyline','spread']);assert.equal(group[3].source_market_id,`${e}-moneyline-1`);}
});
