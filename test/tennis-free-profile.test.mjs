import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveFreeTennisStatProfile} from '../functions/lib/tennisFreeStatProfile.js';
const row={tour:'atp',surface:'hard',source_date_label:'2026-10-21',
 last_observed_at:'2026-10-24T20:00:00Z',winner_source_id:'A1',
 loser_source_id:'B1',winner_stats_json:JSON.stringify({svpt:70,'1stIn':40,
 '1stWon':27,'2ndWon':17,ace:3,df:2}),
 loser_stats_json:JSON.stringify({svpt:75,'1stIn':49,'1stWon':31,'2ndWon':13,ace:4,df:1})};
test('aggregates authentic serve and opponent-derived return split',()=>{
 const p=deriveFreeTennisStatProfile([row],{tour:'atp',sourcePlayerId:'A1'});
 assert.equal(p.matches,1);
 assert.equal(p.overall.returnPoints,75);
 assert.equal(p.overall.returnWon,31);
 assert.equal(p.overall.firstServeInPct,40/70);
 assert.equal(p.exactMatchDateVerified,false);
 assert.equal(p.contractTradingAuthorized,false);
});
test('player and tour isolation never merges incompatible observations',()=>{
 const p=deriveFreeTennisStatProfile([row,{...row,tour:'wta'}],{tour:'atp',sourcePlayerId:'A1'});
 assert.equal(p.matches,1);
 assert.throws(()=>deriveFreeTennisStatProfile([row],{tour:'atp'}));
});
