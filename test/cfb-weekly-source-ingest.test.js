import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {prepare,sourceWeek} from "../scripts/cfb-weekly-source-ingest.mjs";
const head="id,start_date,season,season_type,week,home_team,away_team,spread,home_adjusted_epa,away_adjusted_epa";
const row="401866451,2026-10-31 02:30:00,2026,regular,9,Sacramento State,Kent State,10.5,-0.06,-0.02";
test("calculates upcoming week correctly at Sunday night and Monday",()=>{
 assert.equal(sourceWeek("2026-10-25T20:00:00Z"),9);
 assert.equal(sourceWeek("2026-10-26T14:00:00Z"),9);
 assert.equal(sourceWeek("2026-11-01T20:00:00Z"),10);
});
test("preserves raw CSV with verified receipt and research-only D1 script",()=>{
 const dir=mkdtempSync(join(tmpdir(),"cfb-source-"));
 try{const src=head+"\n"+row+"\n";const r=prepare(src,{season:2026,week:9,observedAt:"2026-10-26T13:00:00Z",outputDir:dir});
 assert.equal(readFileSync(join(dir,"source.csv"),"utf8"),src);
 assert.equal(r.rowCount,1);assert.equal(r.canAuthorizeWager,false);
 const sql=readFileSync(join(dir,"shadow-research.sql"),"utf8");
 assert.match(sql,/INSERT OR IGNORE/);assert.match(sql,/can_promote_model/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("rejects late upload and incorrect week",()=>{
 const src=head+"\n"+row+"\n",o={season:2026,week:9,observedAt:"2026-11-01T00:00:00Z"};
 assert.throws(()=>prepare(src,o),/NOT_PROSPECTIVE/);
 assert.throws(()=>prepare(src,{...o,week:8}),/WRONG_SEASON_WEEK/);
});
