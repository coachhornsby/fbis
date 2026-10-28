import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';
const require=createRequire(new URL('../services/prizepicks-history-maintenance/package.json',import.meta.url));const {Miniflare}=require(process.env.FBIS_MINIFLARE_MODULE||'miniflare');
const root=new URL('../',import.meta.url);const files=['services/prizepicks-history-maintenance/worker.mjs','functions/lib/prizepicksPayloadArchive.js'];
const modules=await Promise.all(files.map(async path=>({type:'ESModule',path:new URL(path,root).pathname,contents:await readFile(new URL(path,root),'utf8')})));
const id='a'.repeat(64),raw=JSON.stringify({league:'WTA',player_image:'https://example.test/x',padding:'x'.repeat(4000)});
test('real Worker and D1 retain typed fields, replay completed batches without writes, and enforce the global row cap',async()=>{
 const mf=new Miniflare({modules,compatibilityDate:'2026-07-01',d1Databases:{DB:'test-db'},durableObjects:{MIGRATION:{className:'PrizePicksHistoryMigration',useSQLite:true}},bindings:{MIGRATION_ENABLED:'true',MAX_ROWS:'1',ARCHIVE_DRIVE_FILE_ID:'verified_Drive_file',SOURCE_SQL_SHA256:'b'.repeat(64),MAINTENANCE_KEY:'secret'}});
 try{
 const db=await mf.getD1Database('DB');await db.exec('CREATE TABLE prizepicks_prop_lines(id TEXT PRIMARY KEY,raw_json TEXT,fbis_projection REAL)');await db.prepare('INSERT INTO prizepicks_prop_lines VALUES(?,?,?)').bind(id,raw,0).run();
 const request=body=>mf.dispatchFetch('http://local/apply',{method:'POST',headers:{'x-maintenance-key':'secret'},body:JSON.stringify(body)});
 assert.equal((await mf.dispatchFetch('http://local/apply',{method:'POST',body:'{}'})).status,403);
 const batch={afterRowid:0,rows:[{rowid:1,id,oldRaw:raw}]};let r=await request(batch);assert.equal(r.status,200);const first=await r.json();assert.equal(first.updated,1);assert.ok(first.bytesRemoved>3000);
 assert.deepEqual(await (await request(batch)).json(),first);
 assert.equal((await request({afterRowid:1,rows:[{rowid:2,id:'c'.repeat(64),oldRaw:raw}]})).status,409);
 const stored=await db.prepare('SELECT * FROM prizepicks_prop_lines WHERE id=?').bind(id).first();assert.equal(stored.fbis_projection,0);assert.equal(JSON.parse(stored.raw_json).league,'WTA');
 }finally{await mf.dispose();}
});
