import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

test("NBA official injury parser preserves submitted and not-yet-submitted states",()=>{
  const dir="artifacts/test-nba-official";
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(dir+"/discovery.json",JSON.stringify({
    ok:true,url:"https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-02-05_10_30AM.pdf"
  }));
  fs.writeFileSync(dir+"/report.txt",[
    "Injury Report: 02/05/26 10:30 AM",
    "Game Date Game Time Matchup Team Player Name Current Status Reason",
    "02/05/2026 07:00 (ET) BKN@ORL Brooklyn Nets Etienne, Tyson Out G League - Two-Way",
    "Thomas, Cam Questionable Injury/Illness - Right Ankle; Sprain",
    "Orlando Magic Suggs, Jalen Probable Injury/Illness - Knee",
    "02/05/2026 07:30 (ET) CHI@TOR Chicago Bulls NOT YET SUBMITTED",
    "Toronto Raptors NO INJURIES",
  ].join("\n"));
  execFileSync(process.execPath,[
    "scripts/nba-official-injury-parse.mjs",
    "text="+dir+"/report.txt",
    "discovery="+dir+"/discovery.json",
    "out="+dir+"/out.json",
    "sql="+dir+"/out.sql",
    "playerSql="+dir+"/player.sql",
    "reportSql="+dir+"/reports.sql"
  ]);
  const j=JSON.parse(fs.readFileSync(dir+"/out.json","utf8"));
  assert.equal(j.quality.entries,3);
  assert.ok(j.entries.some(x=>x.playerName==="Etienne, Tyson"&&x.status==="OUT"));
  assert.ok(j.entries.some(x=>x.playerName==="Thomas, Cam"&&x.status==="QUESTIONABLE"));
  assert.ok(j.coverage.some(x=>x.teamKey==="CHI"&&x.submissionStatus==="NOT_YET_SUBMITTED"));
  assert.ok(j.coverage.some(x=>x.teamKey==="TOR"&&x.submissionStatus==="SUBMITTED"&&x.playerRows===0));
  const sql=fs.readFileSync(dir+"/out.sql","utf8");
  assert.match(sql,/NBA_OFFICIAL_INJURY_REPORT/);
  assert.match(sql,/player_availability_observations/);
  assert.match(sql,/nba_official_availability_reports/);
  const playerSql=fs.readFileSync(dir+"/player.sql","utf8");
  const reportSql=fs.readFileSync(dir+"/reports.sql","utf8");
  assert.equal((playerSql.match(/INSERT OR IGNORE INTO/g)||[]).length,3);
  assert.equal((reportSql.match(/INSERT OR IGNORE INTO/g)||[]).length,4);
  assert.match(playerSql,/player_availability_observations/);
  assert.doesNotMatch(playerSql,/nba_official_availability_reports/);
  assert.match(reportSql,/nba_official_availability_reports/);
  assert.doesNotMatch(reportSql,/player_availability_observations/);
});
