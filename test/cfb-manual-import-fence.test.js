import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script="scripts/guard-cfb-legacy-primary-import.py";
function check(mode) {
 const dir=mkdtempSync(join(tmpdir(),"cfb-import-"));
 try {
  const f=join(dir,"wrangler.toml");
  writeFileSync(f,'[env.production.vars]\nSPORT_DB_MODE_CFB = "'+mode+'"\n');
  return spawnSync("python3",[script,f],{encoding:"utf8"});
 } finally {rmSync(dir,{recursive:true,force:true});}
}
test("legacy CFB manual imports work only while PRIMARY is authoritative",()=>{
 const ok=check("shadow");
 assert.equal(ok.status,0,ok.stderr);
 const denied=check("sport");
 assert.notEqual(denied.status,0);
 assert.match(denied.stderr,/CFB_PRIMARY_IMPORT_BLOCKED_AFTER_SPORT_CUTOVER/);
 const invalid=check("unknown");
 assert.notEqual(invalid.status,0);
});
test("both manual CFB import workflows invoke production-mode guard",()=>{
 for(const path of [".github/workflows/cfb-team-directory-phase-a.yml",".github/workflows/cfb-player-directory-phase-b.yml"]){
  const yml=readFileSync(path,"utf8");
  assert.match(yml,/python3 scripts\/guard-cfb-legacy-primary-import\.py wrangler\.toml/);
 }
});
