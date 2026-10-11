import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root=new URL("../",import.meta.url);
const script=new URL("../scripts/cfb-team-player-stat-staging.py",import.meta.url).pathname;
const sql=new URL("../docs/sql/cfb-fbs-team-player-statistics-candidate.sql",import.meta.url);

test("Research statistical schema accepts immutable team/player histories without granting model authority",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(readFileSync(sql,"utf8"));
  for(const name of ["cfb_team_game_stat_observations","cfb_team_season_stat_snapshots",
    "cfb_player_game_stat_observations","cfb_player_season_stat_snapshots"]){
    const columns=db.prepare("PRAGMA table_info("+name+")").all();
    assert.ok(columns.some(c=>c.name==="source_timestamp"));
    assert.ok(columns.some(c=>c.name==="observed_at"));
    assert.ok(columns.some(c=>c.name==="metrics_json"));
    assert.ok(columns.some(c=>c.name==="content_hash"));
    assert.ok(columns.some(c=>c.name==="can_influence_projection"&&c.dflt_value==="0"));
  }
 }finally{db.close();}
});
test("Offline archive staging preserves every numeric field and rejects future/leaky games and unknown player IDs",()=>{
 const dir=mkdtempSync(join(tmpdir(),"fbis-cfb-team-stats-"));
 try{
  const teamFile=join(dir,"teams.csv");
  writeFileSync(teamFile,[
   "game_id,season,week,game_date,team_id,opponent_id,team_name,opponent_name,points_for,points_against,off_pass_yards,off_rush_yards,off_EPA_passing_per_play,def_havoc_total_rate,situ_EPA_success_rate",
   "g1,2026,5,2026-10-01T10:00:00Z,333,999,Alabama,Opponent,35,21,275,142,0.3,0.12,0.51",
   "g1,2026,5,2026-10-01T10:00:00Z,333,999,Alabama,Opponent,35,21,275,142,0.3,0.12,0.51",
   "g2,2026,6,2026-10-12T10:00:00Z,333,999,Alabama,Opponent,32,25,280,133,0.4,0.11,0.54",
   "g3,2025,2,2025-09-20T10:00:00Z,333,999,Alabama,Opponent,30,20,270,130,0.2,0.1,0.50",
   "bad,2026,5,2026-10-01T10:00:00Z,Alabama,999,Alabama,Opponent,35,21,275,142,0.3,0.12,0.51"
  ].join("\n")+"\n");
  const playerFile=join(dir,"players.csv");
  writeFileSync(playerFile,[
   "game_id,season,game_date,team_id,athlete_id,opponent,passing_yards,pass_attempts,rushing_yards,receiving_yards",
   "g1,2026,2026-10-01T10:00:00Z,333,9999,Opponent,278,33,22,0",
   "g1,2026,2026-10-01T10:00:00Z,333,unknown,Opponent,101,17,1,0",
  ].join("\n")+"\n");
  const prefix=join(dir,"stage");
  const run=spawnSync("python3",[script,"--archive",teamFile,
    "--archive-observed-at","2026-10-03T10:00:00Z",
    "--season","2026","--player-csv",playerFile,
    "--output-prefix",prefix],{encoding:"utf8",timeout:30000});
  assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(readFileSync(prefix+".manifest.json","utf8"));
  assert.equal(manifest.files["team-game"].records,1);
  assert.equal(manifest.files["team-season"].records,1);
  assert.equal(manifest.files["player-game"].records,1);
  assert.equal(manifest.files["player-season"].records,1);
  assert.equal(manifest.model_authority,false);
  assert.equal(manifest.source_publication_timestamp_verified,false);
  assert.equal(manifest.team_rows_rejected,3);
  assert.equal(manifest.player_rows_rejected,1);
  const read=(name)=>JSON.parse(readFileSync(prefix+"."+name+".jsonl","utf8").trim());
  const team=read("team-game");
  assert.equal(team.team_id,"cfb:espn:333");
  assert.equal(team.game_at,"2026-10-01T10:00:00Z");
  assert.equal(team.can_influence_projection,0);
  assert.equal(team.source_timestamp,null);
  const metrics=JSON.parse(team.metrics_json);
  assert.equal(metrics.offense.off_pass_yards,275);
  assert.equal(metrics.defense.def_havoc_total_rate,0.12);
  assert.equal(metrics.situational.situ_EPA_success_rate,0.51);
  const season=JSON.parse(read("team-season").metrics_json);
  assert.equal(season.partial_season_totals.passYards,275);
  assert.equal(season.coverage.source_games_included,1);
  const player=read("player-game");
  assert.equal(player.player_id,"cfb:espn-player:9999");
  assert.equal(JSON.parse(player.metrics_json).passing.passing_yards,278);
  assert.equal(JSON.parse(read("player-season").metrics_json).partial_season_totals.passingYards,278);
 }finally{rmSync(dir,{force:true,recursive:true});}
});
