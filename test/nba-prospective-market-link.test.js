import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("prospective market linker rejects null shells and refreshes eligible links idempotently",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nba-market-link-"));
  const projections=path.join(dir,"projections.json"),odds=path.join(dir,"odds.json"),out=path.join(dir,"out.json"),sql=path.join(dir,"out.sql");
  fs.writeFileSync(projections,JSON.stringify([{id:"p1",game_id:"g1",model_id:"NBA-FBIS-v1",model_version:"v",code_sha:"good",prediction_timestamp:"2026-10-06T12:00:00Z",tipoff_timestamp:"2026-10-06T23:00:00Z"}]));
  fs.writeFileSync(odds,JSON.stringify([
    {id:1,game_id:"g1",market:"ml",side:"HOME",price:null,no_vig:null,captured_at:"2026-10-06T10:00:00Z",game_start:"2026-10-06T23:00:00Z",rejected_post_start:0},
    {id:2,game_id:"g1",market:"ml",side:"HOME",price:-120,no_vig:0.53,captured_at:"2026-10-06T11:00:00Z",game_start:"2026-10-06T23:00:00Z",rejected_post_start:0},
    {id:3,game_id:"g1",market:"ml",side:"HOME",price:-130,no_vig:0.55,captured_at:"2026-10-06T22:59:00Z",game_start:"2026-10-06T23:00:00Z",rejected_post_start:0}
  ]));
  execFileSync(process.execPath,["scripts/nba-prospective-market-link.mjs","projections="+projections,"odds="+odds,"out="+out,"sql="+sql],{cwd:process.cwd()});
  const result=JSON.parse(fs.readFileSync(out,"utf8"));
  assert.equal(result.rows,1);
  assert.equal(result.links[0].entry.id,2);
  assert.equal(result.links[0].close.id,3);
  const sqlText=fs.readFileSync(sql,"utf8");
  assert.match(sqlText,/DELETE FROM nba_prospective_market_links/);
  assert.ok(!sqlText.includes("93231"));
});
