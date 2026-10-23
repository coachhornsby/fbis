import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCandidateIndex,parseCsv,scanSource,summarize,numeric,hasValidTwoSidedServeStats,sources} from '../scripts/lib/tennis-lowtier-source-audit.mjs';

const fixture={
 tourney_id:'123',tourney_date:'20261021',surface:'Hard',tourney_name:'ITF',
 match_num:'1',winner_id:'1234',loser_id:'5678',
 winner_name:'José Demo',loser_name:'Opponent',score:'6-4 6-4',
 w_svpt:'64',w_1stIn:'40',w_1stWon:'29',w_2ndWon:'12',w_ace:'5',w_df:'2',w_SvGms:'10',w_bpSaved:'2',w_bpFaced:'3',
 l_svpt:'65',l_1stIn:'39',l_1stWon:'26',l_2ndWon:'11',l_ace:'3',l_df:'3',l_SvGms:'10',l_bpSaved:'3',l_bpFaced:'5'
};
test('source descriptors cover verified 2024-26 Challenger Futures and ITF files',()=>{
 assert.equal(sources.length,9);
 assert.equal(sources.filter(x=>x.tour==='wta').length,3);
 assert.equal(sources.filter(x=>x.tier==='ATP_QUAL_CHALL').length,3);
 assert.equal(sources.filter(x=>x.tier==='ATP_FUTURES').length,3);
});
test('missing source cells never become zeroes or eligible stats',()=>{
 assert.equal(numeric(''),null);
 assert.equal(numeric('  '),null);
 assert.equal(numeric(null),null);
 assert.equal(numeric('0'),0);
 assert.equal(hasValidTwoSidedServeStats({...fixture,w_svpt:''}),false);
 assert.equal(hasValidTwoSidedServeStats({...fixture,l_SvGms:'0'}),false);
 assert.equal(hasValidTwoSidedServeStats({...fixture,w_1stWon:'44'}),false);
 assert.equal(hasValidTwoSidedServeStats(fixture),true);
});
test('audit captures only historical matches and dedupes matched appearances; never writes production',()=>{
 const idx=makeCandidateIndex([{tour:'wta',playerName:'Jose Demo',playerKey:'jose demo',
  missingHard:1,missingClay:1,missingGrass:1}]);
 const meta={tour:'wta',tier:'WTA_QUAL_ITF'};
 let x=scanSource(idx,meta,[fixture,fixture,{...fixture,tourney_date:'20261023'}],'20261023');
 assert.equal(x.playerAppearances,1);
 assert.equal(x.validTwoSidedServeAppearances,1);
 const summary=summarize(idx,[meta]);
 assert.equal(summary.targets,1);
 assert.equal(summary.players[0].validBySurface.hard,1);
 assert.deepEqual(summary.players[0].candidateSourceIds,['1234']);
 assert.equal(summary.productionWrites,0);
 assert.equal(summary.canAuthorizeWager,false);
 assert.equal(summary.players[0].identityStatus,'NAME_MATCH_UNVERIFIED');
});
test('robust CSV reader supports quoted comma and escaped quotes',()=>{
 const str='tourney_date,winner_id,loser_id,winner_name,loser_name,score\n20261021,10,20,"Last, First","Name ""Junior""",6-4\n';
 const r=parseCsv(str);
 assert.equal(r[0].winner_name,'Last, First');
 assert.equal(r[0].loser_name,'Name "Junior"');
});
