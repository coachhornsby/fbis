import test from 'node:test';import assert from 'node:assert/strict';
import {balancedCbbMarkets,balancedCbbCandidates,balancedDetailEvents} from '../services/polymarket-rest-collector/fairSelection.mjs';
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

test('detail interleaving reaches later pages early and removes duplicate slugs',()=>{const pages=Array.from({length:3},(_,p)=>Array.from({length:4},(_,i)=>({slug:`p${p}-event${3-i}`})));pages[1].push(pages[0][0]);const out=balancedDetailEvents(pages);assert.equal(out.length,12);assert.deepEqual(out.slice(0,3).map(e=>e.slug),['p0-event0','p1-event0','p2-event0']);});
test('recurrence-based detail rotation covers every stable later-page subset without resonance',()=>{const seen=new Set(),base=Array.from({length:40},(_,i)=>({slug:`event-${String(i).padStart(3,'0')}`}));for(let cycle=0;cycle<180;cycle++){const page=2+cycle%3,late=Array.from({length:20},(_,i)=>({slug:`event-${String(page*20+i).padStart(3,'0')}`}));const targets=balancedDetailEvents([base.slice(0,20),base.slice(20),late]);seen.add(targets[Math.floor(cycle/3)%targets.length].slug);}assert.equal(seen.size,100);});
test('oversubscribed roster rotates dropped tail events and preserves verified detail target',()=>{const seen=new Set();for(let recurrence=0;recurrence<4;recurrence++){for(let page=2;page<5;page++){const ids=[...Array.from({length:40},(_,i)=>i),...Array.from({length:20},(_,i)=>page*20+i)];const rows=ids.map(i=>({canonical_event_id:'e'+i,market_family:'moneyline',source_market_id:'m'+i,displayBinding:{period:'full_game'}}));const priority='e'+(page*20+19);const selected=balancedCbbCandidates(rows,{eventRotation:recurrence,priorityEventIds:[priority]});assert.equal(selected.length,50);assert.ok(selected.some(r=>r.canonical_event_id===priority));for(const r of selected)seen.add(r.canonical_event_id);}}assert.equal(seen.size,100);});

test('reserved detailed families survive a roster crowded by sixty moneylines',()=>{const rows=Array.from({length:60},(_,i)=>({canonical_event_id:'e'+i,market_family:'moneyline',source_market_id:'ml'+i,displayBinding:{period:'full_game'}}));for(const family of ['spread','total'])rows.push({canonical_event_id:'e59',market_family:family,source_market_id:family+'59',displayBinding:{period:'full_game'}});const out=balancedCbbCandidates(rows,{priorityEventIds:['e59']});assert.equal(out.length,50);assert.deepEqual(out.slice(0,3).map(r=>r.source_market_id),['ml59','spread59','total59']);});
test('detail family reservation near the fifty-event boundary rotates omitted games',()=>{const rows=Array.from({length:49},(_,i)=>({canonical_event_id:'e'+i,market_family:'moneyline',source_market_id:'ml'+i,displayBinding:{period:'full_game'}}));for(const family of ['spread','total'])rows.push({canonical_event_id:'e48',market_family:family,source_market_id:family+'48',displayBinding:{period:'full_game'}});const seen=new Set();for(let recurrence=0;recurrence<3;recurrence++){const out=balancedCbbCandidates(rows,{priorityEventIds:['e48'],eventRotation:recurrence});assert.equal(out.length,50);assert.ok(out.some(r=>r.source_market_id==='total48'));for(const r of out)seen.add(r.canonical_event_id);}assert.equal(seen.size,49);});
