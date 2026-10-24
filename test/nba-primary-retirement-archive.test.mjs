import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SPORT_PREFIX_TABLES, workingTablesForSport } from "../functions/lib/sportWorkingCopy.js";

const source=readFileSync(new URL("../scripts/nba-primary-archive.mjs",import.meta.url),"utf8");
const expected=[...workingTablesForSport("nba").map(x=>x.table),...SPORT_PREFIX_TABLES.nba];
test("NBA archival scope is exactly 31 prefix and 7 sport-filtered shared tables",()=>{
 assert.equal(SPORT_PREFIX_TABLES.nba.length,31);
 assert.equal(workingTablesForSport("nba").length,7);
 assert.equal(expected.length,38);
 assert.equal(new Set(expected).size,38);
 assert.match(source,/shared\.has\(table\) \? "sport='nba' AND "/);
 assert.match(source,/SOURCE_DB="b50c724c-903b-4241-8ce1-48d931e7a44c"/);
});
test("archive SOURCE D1 is select-only; release and deletion never granted",()=>{
 assert.match(source,/if\(!\/\^\(SELECT\|PRAGMA\)\\b\/\.test\(sql\)\)/);
 assert.match(source,/retentionReleaseAuthorized:false/);
 assert.match(source,/sourceRowsDeleted:0/);
 assert.match(source,/r2PutAndReadback/);
 assert.match(source,/INDEPENDENT_SQLITE_RESTORE_FAILED/);
 const workflow=readFileSync(new URL("../.github/workflows/nba-primary-archive.yml",import.meta.url),"utf8");
 assert.match(workflow,/Certify all 38 tables, retention closed/);
 assert.doesNotMatch(workflow,/\b(wrangler d1 execute|DELETE FROM|DROP TABLE)\b/i);
});
test("independent isolated SQLite restores full columns and refuses edited rows",()=>{
 const dir=mkdtempSync(join(tmpdir(),"nba-restore-"));
 try{
  const name="nba_fixture_test";
  const schema="CREATE TABLE nba_fixture_test (id TEXT PRIMARY KEY, sport TEXT, payload TEXT, nullable REAL, rank INTEGER)";
  const row={__fbis_rowid:"101",id:"quote'fixture",sport:"nba",payload:'{"unicode":"é","nested":{"a":1}}',nullable:null,rank:0};
  const part=join(dir,"part.json");
  writeFileSync(part,JSON.stringify({table:name,columns:["id","sport","payload","nullable","rank"],rows:[row]}));
  const manifest={table:name,columns:["id","sport","payload","nullable","rank"],schema,sourceFrozenCount:1,
    parts:[{localFile:part,count:1}]};
  const manifestPath=join(dir,"manifest.json");writeFileSync(manifestPath,JSON.stringify(manifest));
  const runner="scripts/lib/nba-primary-archive-restore.py";
  const ok=spawnSync("python3",[runner,manifestPath],{encoding:"utf8"});
  assert.equal(ok.status,0,ok.stderr);
  assert.equal(JSON.parse(ok.stdout).fullFieldParity,true);
  writeFileSync(part,JSON.stringify({table:name,columns:manifest.columns,rows:[{...row,rank:2},{...row,__fbis_rowid:"102"}]}));
  const corrupted=spawnSync("python3",[runner,manifestPath],{encoding:"utf8"});
  assert.notEqual(corrupted.status,0,"bad row count must never certify");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
