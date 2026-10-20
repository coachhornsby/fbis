import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {
  isPrizePicksTennisHeadshot,
  persistTennisPrizePicksHeadshots,
  loadStoredTennisPrizePicksHeadshots,
} from '../functions/lib/tennisPrizePicksHeadshots.js';

function db(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE prizepicks_prop_lines(
   run_id TEXT,sport TEXT,league TEXT,player_name TEXT,player_headshot_url TEXT,collected_at TEXT,raw_json TEXT);
 CREATE TABLE tennis_players(
   fbis_player_id TEXT PRIMARY KEY,tour TEXT,canonical_name TEXT,normalized_name TEXT,
   official_headshot_url TEXT,official_headshot_source TEXT,updated_at TEXT);
 CREATE TABLE tennis_player_bank(
   tour TEXT,player_key TEXT,player_name TEXT,headshot_url TEXT,updated_at TEXT,
   profile_json TEXT DEFAULT '{}',source TEXT DEFAULT 'TEST',source_as_of TEXT DEFAULT '2026-10-18',
   PRIMARY KEY(tour,player_key));`);
 const wrap={prepare(q){
  const stmt=sql.prepare(q);
  return {bind(...a){return {
   async all(){return {results:stmt.all(...a)};},
   async run(){stmt.run(...a);return {meta:{changes:1}};},
   async first(){return stmt.get(...a)||null;},
  };}};
 }};
 return {sql,DB:wrap};
}

test('PrizePicks tennis headshots persist onto canonical player cards without overwriting official sources',async()=>{
 assert.equal(isPrizePicksTennisHeadshot('https://cdn.prizepicks.com/player.png'),true);
 assert.equal(isPrizePicksTennisHeadshot('https://cdn.example/images/teams/x.png'),false);
 assert.equal(isPrizePicksTennisHeadshot('https://img0.aiscore.com/v2/team/not-a-player.png!w80'),false);
 const {sql,DB}=db();
 sql.prepare(`INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?)`)
  .run('tennis:wta:1','wta','Sonay Kartal','sonay kartal',null,null,null);
 sql.prepare(`INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?)`)
  .run('tennis:wta:2','wta','Other Player','other player','https://official.example/a.png','WTA_OFFICIAL',null);
 sql.prepare(`INSERT INTO tennis_player_bank(tour,player_key,player_name,headshot_url) VALUES(?,?,?,?)`)
  .run('wta','sonay kartal','Sonay Kartal',null);
 sql.prepare(`INSERT INTO prizepicks_prop_lines VALUES(?,?,?,?,?,?,?)`)
  .run('run1','tennis','WTA','Sonay Kartal','https://cdn.prizepicks.com/kartal.png','2026-10-18T09:00:00Z','{}');
 sql.prepare(`INSERT INTO prizepicks_prop_lines VALUES(?,?,?,?,?,?,?)`)
  .run('run1','tennis','WTA','Other Player','https://cdn.prizepicks.com/other.png','2026-10-18T09:00:00Z','{}');
 const result=await persistTennisPrizePicksHeadshots(DB,{runId:'run1'});
 assert.equal(result.ok,true);
 assert.equal(result.updated,1);
 const kartal=sql.prepare(`SELECT official_headshot_url,official_headshot_source FROM tennis_players WHERE fbis_player_id=?`)
  .get('tennis:wta:1');
 assert.equal(kartal.official_headshot_url,'https://cdn.prizepicks.com/kartal.png');
 assert.equal(kartal.official_headshot_source,'PRIZEPICKS_FEED');
 const other=sql.prepare(`SELECT official_headshot_url,official_headshot_source FROM tennis_players WHERE fbis_player_id=?`)
  .get('tennis:wta:2');
 assert.equal(other.official_headshot_source,'WTA_OFFICIAL');
 assert.equal(other.official_headshot_url,'https://official.example/a.png');
 const bank=sql.prepare(`SELECT headshot_url FROM tennis_player_bank WHERE player_key=?`).get('sonay kartal');
 assert.equal(bank.headshot_url,'https://cdn.prizepicks.com/kartal.png');
 const stored=await loadStoredTennisPrizePicksHeadshots(DB,['tennis:wta:1','tennis:wta:2']);
 assert.equal(stored.get('tennis:wta:1')?.imageSource,'PRIZEPICKS_FEED');
 assert.equal(stored.has('tennis:wta:2'),false);
});
