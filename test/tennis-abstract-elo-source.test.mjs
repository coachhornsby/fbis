import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTennisAbstractElo,fetchTennisAbstractElo,persistTennisAbstractElo} from '../functions/lib/tennisAbstractEloSource.js';
const now=new Date('2026-10-21T20:00:00Z');
const row=i=>[
 String(i),'Player '+i,'24.8',String(2300-i),'','1',String(2100-i),
 '1',String(2050-i),'1',String(1950-i),'',
 String(2320-i),'2026-08','','1','0'
].map(x=>'<td>'+x+'</td>').join('');
const fixture=(date='2026-10-19',count=105,kind='atp')=>
 '<html><title>Tennis Abstract: '+kind.toUpperCase()+' Elo Ratings</title>'+
 '<i>Last update: '+date+'</i><table id="reportable"><thead></thead><tbody>'+
 Array.from({length:count},(_,i)=>'<tr>'+row(i+1)+'</tr>').join('')+'</tbody></table></html>';
test('parse 17-column live Tennis Abstract rating rows and source date',()=>{
 const p=parseTennisAbstractElo(fixture(),'atp',{now});
 assert.equal(p.reportDate,'2026-10-19');
 assert.equal(p.players.length,105);
 assert.equal(p.players[0].playerName,'Player 1');
 assert.equal(p.players[0].overallElo,2299);
 assert.equal(p.players[0].hardElo,2099);
 assert.equal(p.canAuthorizeWager,false);
});
test('source rejects stale reports, missing layout, implausibly small files',()=>{
 assert.throws(()=>parseTennisAbstractElo(fixture('2026-05-25'),'atp',{now}),/STALE/);
 assert.throws(()=>parseTennisAbstractElo(fixture().replace('id="reportable"','id="changed"'),'atp',{now}),/CONTRACT/);
 assert.throws(()=>parseTennisAbstractElo(fixture('2026-10-19',10),'atp',{now}),/COVERAGE/);
});
test('bounded live provider response includes content fingerprint',async()=>{
 const p=await fetchTennisAbstractElo('atp',{now,fetchImpl:async(url)=>{
  assert.equal(new URL(url).hostname,'www.tennisabstract.com');
  return new Response(fixture(),{status:200,headers:{'content-type':'text/html'}});
 }});
 assert.equal(p.sourceHash.length,64);
 assert.equal(p.players.length,105);
 assert.equal(p.retrievedAt,now.toISOString());
});
test('receipt is written after complete player-row parity, with research flags only',async()=>{
 const calls=[];const stored=new Map();let receipt=null;
 const db={
  prepare(sql){return {bind(...values){return {
   async first(){
    if(sql.includes('COUNT(*) n'))return {n:stored.size};
    return receipt?{player_count:receipt.player_count}:null;
   },
   async run(){receipt={player_count:values[4]};calls.push('receipt');return {success:true};}
  };}};},
  async batch(queries){calls.push('players');queries.forEach((q,i)=>stored.set(calls.length+':'+i,{}));
   return queries.map(()=>({success:true}));}
 };
 const p=await fetchTennisAbstractElo('atp',{now,fetchImpl:async()=>Response.json({})}).catch(()=>null);
 // Source and parser are exercised above; verify the complete write protocol here.
 const record={...parseTennisAbstractElo(fixture(),'atp',{now}),sourceHash:'a'.repeat(64),retrievedAt:now.toISOString()};
 const v=await persistTennisAbstractElo(db,record);
 assert.equal(v.players,105);
 assert.equal(calls.at(-1),'receipt');
 assert.equal(calls.filter(v=>v==='players').length,3);
});

test('source 403 activates authenticated Apify relay and preserves original source evidence',async()=>{
 let requests=[];
 const record=await fetchTennisAbstractElo('atp',{now,apifyToken:'dummy-test-token',
  fetchImpl:async(url,opts)=>{
   requests.push({url,opts});
   if(requests.length===1)return new Response('Forbidden',{status:403});
   const input=JSON.parse(opts.body);
   assert.equal(input.url,'https://www.tennisabstract.com/reports/atp_elo_ratings.html');
   assert.deepEqual(input.formats,['raw']);
   assert.equal(opts.headers.authorization,'Bearer dummy-test-token');
   return Response.json([{raw:fixture(),fetch:{httpStatusCode:200,loadedUrl:input.url}}]);
  }});
 assert.equal(requests.length,2);
 assert.equal(record.acquisitionTransport,'APIFY_WEB_FETCH_RELAY');
 assert.equal(record.players.length,105);
 assert.equal(record.canAuthorizeWager,false);
});
test('Apify relay never accepts a redirected or malformed source',async()=>{
 await assert.rejects(()=>fetchTennisAbstractElo('atp',{now,apifyToken:'dummy',
  fetchImpl:async(url,opts)=>opts?.method?
   Response.json([{raw:fixture(),fetch:{httpStatusCode:200,loadedUrl:'https://untrusted.example/test'}}]):
   new Response('',{status:403})}),/ELO_RELAY_SOURCE_EVIDENCE_INVALID/);
});

test('normalized Elo fingerprint ignores volatile HTML markup but detects changed rating',async()=>{
 const html=fixture();
 const fetchOne=async()=>new Response(html,{status:200});
 const fetchTwo=async()=>new Response(html+'<!-- volatile footer 2026-10-21 -->',{status:200});
 const modified=html.replace('<td>2299</td>','<td>2288</td>');
 const fetchChanged=async()=>new Response(modified,{status:200});
 const a=await fetchTennisAbstractElo('atp',{now,fetchImpl:fetchOne});
 const b=await fetchTennisAbstractElo('atp',{now,fetchImpl:fetchTwo});
 const c=await fetchTennisAbstractElo('atp',{now,fetchImpl:fetchChanged});
 assert.equal(a.sourceHash,b.sourceHash,'same parsed report should have the same fingerprint');
 assert.notEqual(a.sourceHash,c.sourceHash,'changed Elo must change fingerprint');
});
