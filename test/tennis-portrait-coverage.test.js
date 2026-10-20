import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequestGet} from '../functions/api/tennis-portrait-coverage.js';
function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE tennis_players(fbis_player_id TEXT PRIMARY KEY,tour TEXT,canonical_name TEXT,active_state TEXT,current_rank INTEGER,official_headshot_url TEXT,official_headshot_source TEXT);
 CREATE TABLE tennis_player_portraits(fbis_player_id TEXT PRIMARY KEY,approval_status TEXT,public_display_allowed INTEGER,display_scope TEXT,rights_evidence_ref TEXT,approved_at TEXT,expires_at TEXT);`);
 db.prepare('INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?)').run('tennis:atp:1','atp','ATP Feed Player','UNKNOWN',7,'https://static.prizepicks.com/image.png','PRIZEPICKS_FEED');
 db.prepare('INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?)').run('tennis:atp:2','atp','ATP Missing Player','UNKNOWN',14,null,null);
 db.prepare('INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?)').run('tennis:wta:1','wta','WTA Licensed Player','RANKED_ACTIVE',2,null,null);
 db.prepare('INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?)').run('tennis:wta:2','wta','WTA Revoked Player','RANKED_ACTIVE',3,null,null);
 db.prepare('INSERT INTO tennis_players VALUES(?,?,?,?,?,?,?)').run('tennis:wta:3','wta','WTA Team Image','RANKED_ACTIVE',4,'https://img0.aiscore.com/v2/team/bogus.png!w80','PRIZEPICKS_FEED');
 db.prepare('INSERT INTO tennis_player_portraits VALUES(?,?,?,?,?,?,?)').run('tennis:wta:1','APPROVED',1,'PUBLIC_WEB','https://creativecommons.org/licenses/by/4.0/','2026-01-01T00:00:00Z',null);
 db.prepare('INSERT INTO tennis_player_portraits VALUES(?,?,?,?,?,?,?)').run('tennis:wta:2','REVOKED',0,'PUBLIC_WEB',null,'2026-01-01T00:00:00Z',null);
 return {prepare(sql){return{bind(...args){return{async all(){return{results:db.prepare(sql).all(...args)}}}}}}};
}
test('coverage distinguishes reviewed R2 images, stored external references and missing profiles',async()=>{
 const res=await onRequestGet({request:new Request('https://fbis.test/api/tennis-portrait-coverage?limit=10'),env:{DB:database()}});
 assert.equal(res.status,200);
 const x=await res.json();
 assert.deepEqual(x.total,{players:5,archivedApproved:1,linkedExternal:1,missing:3});
 assert.equal(x.byTour.find(v=>v.tour==='atp').missing,1);
 assert.equal(x.byTour.find(v=>v.tour==='wta').missing,2);
 assert.deepEqual(x.missingPlayers.map(x=>x.name).sort(),['ATP Missing Player','WTA Revoked Player','WTA Team Image'].sort());
 assert.match(res.headers.get('cache-control'),/no-store/);
});
test('tour filters and invalid tour are deterministic',async()=>{
 const env={DB:database()};
 const res=await onRequestGet({request:new Request('https://fbis.test/api/tennis-portrait-coverage?tour=atp&limit=5'),env});
 const x=await res.json();
 assert.equal(x.byTour.length,1);assert.equal(x.total.players,2);
 assert.deepEqual(x.missingPlayers.map(p=>p.name),['ATP Missing Player']);
 assert.equal((await onRequestGet({request:new Request('https://fbis.test/api/tennis-portrait-coverage?tour=bad'),env})).status,400);
});
