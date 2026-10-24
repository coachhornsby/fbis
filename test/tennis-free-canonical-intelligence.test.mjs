import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reconcileFreeTennisIdentities} from '../functions/lib/tennisFreeIdentity.js';
import {loadCanonicalFreeTennisFeatures} from '../functions/lib/tennisFreeCanonicalFeatures.js';
const sql=new DatabaseSync(':memory:');
sql.exec("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT)");
sql.exec("CREATE TABLE tennis_players (fbis_player_id TEXT PRIMARY KEY,tour TEXT,canonical_name TEXT)");
sql.exec(`CREATE TABLE tennis_free_current_matches(source_event_key TEXT PRIMARY KEY,
 tour TEXT,winner_source_id TEXT,loser_source_id TEXT,winner_name TEXT,
 loser_name TEXT,first_observed_at TEXT)`);
sql.exec(`CREATE TABLE tennis_free_current_observations(observation_key TEXT PRIMARY KEY,
 source_event_key TEXT,observed_at TEXT,parsed_json TEXT)`);
sql.exec(readFileSync(new URL('../migrations/0126_tennis_current_identity_links.sql',import.meta.url),'utf8'));
const wrap={prepare(query){const st=sql.prepare(query);return {bind(...params){return {
 first:async()=>st.get(...params)||null,
 all:async()=>({results:st.all(...params)}),
 run:async()=>({meta:{changes:st.run(...params).changes}})
}}}}};
function match(k,wid,wname,lid,lname,tour='atp'){
 sql.prepare('INSERT INTO tennis_free_current_matches VALUES(?,?,?,?,?,?,?)')
  .run(k,tour,wid,lid,wname,lname,'2026-10-24T20:00:00Z');
}
function observation(k,at,win,lose){
 const data={tour:'atp',surface:'hard',dateLabel:'2026-10-24',
  winnerSourceId:win,loserSourceId:lose,
  winnerStats:{svpt:70,'1stIn':40,'1stWon':30,'2ndWon':16,ace:3,df:1},
  loserStats:{svpt:65,'1stIn':34,'1stWon':24,'2ndWon':18,ace:4,df:2}};
 sql.prepare('INSERT INTO tennis_free_current_observations VALUES(?,?,?,?)')
 .run(k+'|'+at,k,at,JSON.stringify(data));
}
test('only unique exact tour-specific canonical identities are linked',async()=>{
 for(const [id,tour,name] of [['atpA','atp','Player One'],['atpB','atp','Player Two'],
 ['atpC','atp','Ambiguous Name'],['atpD','atp','Ambiguous Name'],
 ['wtaW','wta','WTA Correct']]){
  sql.prepare('INSERT INTO tennis_players VALUES(?,?,?)').run(id,tour,name);
 }
 match('m1','A','Player One','B','Player Two');
 match('m2','C','Ambiguous Name','D','Player One');
 match('m3','W','WTA Correct','Z','No Known Player','wta');
 match('m4','W','WTA Wrong','Y','No Match','wta');
 const out=await reconcileFreeTennisIdentities(wrap,{now:new Date('2026-10-24T21:00:00Z')});
 assert.equal(out.newLinks,2);
 assert.equal(out.tours.find(x=>x.tour==='atp').linkedIds,2);
 assert.equal(out.tours.find(x=>x.tour==='wta').linkedIds,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM tennis_free_player_identity_links').get().n,2);
 assert.throws(()=>sql.exec("UPDATE tennis_free_player_identity_links SET fbis_player_id='wrong'"));
 const second=await reconcileFreeTennisIdentities(wrap,{now:new Date('2026-10-24T21:10:00Z')});
 assert.equal(second.newLinks,0);
});
test('point-in-time research stats exclude evidence observed after the cutoff',async()=>{
 observation('m1','2026-10-24T21:20:00Z','A','B');
 observation('m1','2026-10-24T21:30:00Z','A','B');
 const old=await loadCanonicalFreeTennisFeatures(wrap,{
  playerId:'atpA',asOf:'2026-10-24T21:15:00Z'});
 assert.equal(old.ok,true);assert.equal(old.sourceEvidenceRows,0);
 const mid=await loadCanonicalFreeTennisFeatures(wrap,{
  playerId:'atpA',asOf:'2026-10-24T21:25:00Z'});
 assert.equal(mid.ok,true);assert.equal(mid.sourceEvidenceRows,1);
 assert.equal(mid.researchStats.overall.returnPointsWonPct,23/65);
 const later=await loadCanonicalFreeTennisFeatures(wrap,{
  playerId:'atpA',asOf:'2026-10-24T21:40:00Z'});
 assert.equal(later.sourceEvidenceRows,1);
 assert.equal(later.contractTradingAuthorized,false);
 const missing=await loadCanonicalFreeTennisFeatures(wrap,{
  playerId:'wtaW',asOf:'2026-10-24T21:40:00Z'});
 assert.equal(missing.ok,false);
});
test.after(()=>sql.close());
