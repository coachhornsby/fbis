import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const adapter=new URL("../scripts/cfb-sdv-player-box-normalize.py",import.meta.url).pathname;
const stage=new URL("../scripts/cfb-team-player-stat-staging.py",import.meta.url).pathname;

function fixture(dir){
 const teams=join(dir,"fbs.csv"),game=join(dir,"games.csv"),players=join(dir,"player_box.csv");
 writeFileSync(teams,"team_id,subdivision\ncfb:espn:333,FBS\ncfb:espn:888,FBS\ncfb:espn:444,FCS\n");
 writeFileSync(game,[
  "game_id,season,week,game_date,team_id,opponent_id,team_name,opponent_name,points_for,points_against,off_pass_yards",
  "401856634,2026,5,2026-10-01T10:00:00Z,333,888,Alabama,Georgia,35,21,275",
  "401856634,2026,5,2026-10-01T10:00:00Z,888,333,Georgia,Alabama,21,35,230",
  "401856635,2026,8,2026-10-13T10:00:00Z,333,888,Alabama,Georgia,21,35,275",
 ].join("\n")+"\n");
 writeFileSync(players,[
  "season,game_id,team_id,athlete_id,athlete_name,category,completions/passingAttempts,passingYards,passingTouchdowns,rushingAttempts,rushingYards,receptions,receivingYards,totalTackles,stat_1",
  "2026,401856634,333,123,Valid Quarterback,passing,23/41,255,2,,,,,,",
  "2026,401856634,333,123,Valid Quarterback,rushing,,,,5,20,,,,",
  "2026,401856634,333,555,Valid Receiver,receiving,,,,,,6,85,,",
  "2026,401856634,333,777,Valid Defender,defensive,,,,,,,,9,",
  "2026,401856634,444,987,FCS Athlete,passing,20/21,245,1,,,,,,",
  "2026,unknown,333,123,Valid Quarterback,passing,23/41,255,2,,,,,,",
  "2026,401856635,333,123,Valid Quarterback,passing,23/41,255,2,,,,,,",
  "2026,401856634,333,666,Unknown Box,passing,23/41,255,2,,,,,,60",
 ].join("\n")+"\n");
 return {teams,game,players};
}
function run(script,args){return spawnSync("python3",[script,...args],{encoding:"utf8",timeout:30000});}

test("SDV ESPN player box normalization: FBS only, strict game join, paired passing, no name joins",()=>{
 const dir=mkdtempSync(join(tmpdir(),"cfb-sdv-box-"));
 try {
  const {teams,game,players}=fixture(dir),prefix=join(dir,"normalized");
  const r=run(adapter,["--player-box",players,"--team-games",game,
    "--team-game-member","none","--fbs-teams",teams,
    "--season","2026","--source-observed-at","2026-10-03T00:00:00Z",
    "--output-prefix",prefix]);
  assert.equal(r.status,0,r.stderr);
  const manifest=JSON.parse(readFileSync(prefix+".manifest.json","utf8"));
  assert.equal(manifest.player_game_rows,3);
  assert.equal(manifest.fbs_whitelisted_teams,2);
  assert.equal(manifest.counts.excluded_non_fbs,1);
  assert.equal(manifest.counts.missing_game_date,1);
  assert.equal(manifest.counts.future_game,1);
  assert.equal(manifest.counts.unnamed_stats_quarantined,1);
  assert.equal(manifest.feature_authority,false);
  assert.equal(manifest.source_publication_time_verified,false);
  const lines=readFileSync(prefix+".player-game.csv","utf8").trim().split("\n");
  assert.equal(lines.length,4);
  const heading=lines[0].split(",");
  const data=lines.slice(1).map(line=>Object.fromEntries(line.split(",").map((v,i)=>[heading[i],v])));
  const qb=data.find(x=>x.athlete_id==="123");
  assert.equal(qb.passing_yards,"255");
  assert.equal(qb.passing_attempts,"41");
  assert.equal(qb.completions,"23");
  assert.equal(qb.rushing_yards,"20");
  assert.equal(qb.rushing_attempts,"5");
  assert.equal(data.find(x=>x.athlete_id==="555").receptions,"6");
  assert.equal(data.find(x=>x.athlete_id==="777").total_tackles,"9");
  assert.ok(data.every(x=>x.team_id==="333"&&x.game_id==="401856634"));
 }finally{rmSync(dir,{force:true,recursive:true});}
});

test("Normalized box CSV and hash-bound manifest feed source-specific immutable staging; tampering stops",()=>{
 const dir=mkdtempSync(join(tmpdir(),"cfb-box-stage-"));
 try {
  const {teams,game,players}=fixture(dir);
  const prefix=join(dir,"normalized");
  const x=run(adapter,["--player-box",players,"--team-games",game,
    "--team-game-member","unused","--fbs-teams",teams,"--season","2026",
    "--source-observed-at","2026-10-02T14:00:00Z","--output-prefix",prefix]);
  assert.equal(x.status,0,x.stderr);
  const stagePrefix=join(dir,"staged");
  const args=["--archive",game,"--member","unused",
    "--archive-observed-at","2026-10-03T00:00:00Z",
    "--season","2026","--player-csv",prefix+".player-game.csv",
    "--player-manifest",prefix+".manifest.json","--output-prefix",stagePrefix];
  const r=run(stage,args);
  assert.equal(r.status,0,r.stderr);
  const report=JSON.parse(readFileSync(stagePrefix+".manifest.json","utf8"));
  assert.equal(report.files["player-game"].records,3);
  assert.equal(report.files["player-season"].records,3);
  assert.equal(report.player_source_manifest_verified,true);
  const rows=readFileSync(stagePrefix+".player-game.jsonl","utf8").trim().split("\n").map(JSON.parse);
  const qb=rows.find(x=>x.player_id==="cfb:espn-player:123");
  assert.equal(qb.source,"SDV_ESPN_CFB_PLAYER_BOX");
  assert.equal(qb.source_timestamp,null);
  assert.equal(qb.observed_at,"2026-10-02T14:00:00Z");
  assert.equal(qb.can_influence_projection,0);
  const m=JSON.parse(qb.metrics_json);
  assert.equal(m.advanced?.total_tackles,undefined);
  assert.equal(m.passing.passing_yards,255);
  appendFileSync(prefix+".player-game.csv","\n");
  const tampered=run(stage,args);
  assert.notEqual(tampered.status,0);
  assert.match(tampered.stderr,/manifest\/hash mismatch/);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
