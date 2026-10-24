import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTennisCsv,selectCurrentTennisRows,parseTennisCurrentRow}
 from '../functions/lib/tennisFreeCurrentResearch.js';
import {captureFreeTennisCurrentSeason} from '../functions/lib/tennisFreeCurrentCollector.js';
const header='tourney_id,tourney_date,match_num,winner_id,loser_id,winner_name,loser_name,surface,score,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_bpSaved,l_bpFaced';
const record='2026-123,20261021,7,B0BI,MU94,Sebastian Baez,Jaume Munar,Hard,6-4 6-4,1,2,70,40,27,17,2,3,3,2,75,49,31,13,4,8';
const csv=header+'\n'+record+'\n';
test('accepts 2026 original ATP source format and numerical serve splits',()=>{
 const parsed=parseTennisCsv(csv);
 const selected=selectCurrentTennisRows(parsed,{tour:'atp',now:new Date('2026-10-24T20:00:00Z')});
 assert.equal(selected.matches.length,1);
 assert.equal(selected.matches[0].winnerSourceId,'B0BI');
 assert.equal(selected.matches[0].winnerStats.svpt,70);
 assert.equal(selected.matches[0].eventStartVerified,false);
 assert.equal(selected.matches[0].officialResultVerified,false);
 assert.equal(selected.matches[0].contractTradingAuthorized,false);
});
test('rejects nonexistent stats, same-day rows, errors and malformed CSV',()=>{
 const row=parseTennisCsv(csv)[0];
 assert.equal(parseTennisCurrentRow({...row,w_svpt:''},{tour:'atp',asOfDay:'2026-10-24'}),null);
 assert.equal(parseTennisCurrentRow({...row,tourney_date:'20261024'},{tour:'atp',asOfDay:'2026-10-24'}),null);
 assert.equal(parseTennisCurrentRow({...row,score:'RET'},{tour:'atp',asOfDay:'2026-10-24'}),null);
 assert.throws(()=>parseTennisCsv('garbage,not,a,source\n1,2,3,4'));
});
test('controlled collector archives authentic source and writes only TENNIS_DB',async()=>{
 const statements=[],archive=[];
 const tennisDb={prepare(sql){return {bind(...args){statements.push({sql,args});return {run:async()=>({meta:{changes:1}})}}}},
 batch:async qs=>Promise.all(qs.map(q=>q.run()))};
 const env={TENNIS_FREE_RESEARCH_ENABLED:'true',TENNIS_DB:tennisDb,
  ARCHIVE:{put:async(...args)=>archive.push(args)}};
 const response=await captureFreeTennisCurrentSeason(env,{tour:'wta',
  now:new Date('2026-10-24T20:00:00Z'),
  fetchImpl:async()=>new Response(csv,{status:200,headers:{'content-type':'text/csv'}})});
 assert.equal(response.ok,true);assert.equal(response.validatedWithStats,1);
 assert.equal(response.newVersions,1);assert.equal(response.officialSettlementsCreated,0);
 assert.equal(archive.length,1);assert.equal(statements.length,2);
 assert.ok(statements[0].sql.includes('tennis_free_current_observations'));
 assert.ok(statements[1].sql.includes('tennis_free_current_matches'));
});
test('disabled mode cannot make external requests or write DB',async()=>{
 await assert.rejects(captureFreeTennisCurrentSeason({},{
  tour:'atp',fetchImpl:async()=>{throw Error('NETWORK_SHOULD_NOT_RUN')}
 }),/FREE_RESEARCH_DISABLED/);
});
