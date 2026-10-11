import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const schema0098=readFileSync(new URL("../migrations/0098_college_persistence_recovery.sql",import.meta.url),"utf8");
const schema0099=readFileSync(new URL("../migrations/0099_cfb_fbs_statistical_ledgers.sql",import.meta.url),"utf8");

function dbWithLedger(){
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.exec("INSERT INTO schema_migrations(id,applied_at) VALUES('0097_apify_acquisition_authority','2026-10-07T20:03:41Z')");
  return db;
}
function migrationCount(db,id){
  return db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE id=?").get(id).n;
}
test("FBS statistical migration 0099 fails without approved 0098 predecessor",()=>{
  const db=dbWithLedger();
  try {
    assert.throws(()=>db.exec(schema0099));
    assert.equal(migrationCount(db,"0099_cfb_fbs_statistical_ledgers"),0);
  }finally{db.close()}
});
test("0098 -> 0099 adds four immutable ledgers, preserves existing history and authority",()=>{
  const db=dbWithLedger();
  try{
    db.exec("CREATE TABLE untouched_sentinel(k TEXT PRIMARY KEY,v TEXT NOT NULL)");
    db.exec("INSERT INTO untouched_sentinel(k,v) VALUES('keep','original')");
    db.exec(schema0098);
    db.exec(schema0099);
    for(const table of ["cfb_team_game_stat_observations","cfb_team_season_stat_snapshots",
      "cfb_player_game_stat_observations","cfb_player_season_stat_snapshots"]){
      const info=db.prepare("PRAGMA table_info("+table+")").all();
      assert.ok(info.some(x=>x.name==="source_timestamp"));
      assert.ok(info.some(x=>x.name==="observed_at"));
      assert.ok(info.some(x=>x.name==="content_hash"));
      assert.ok(info.some(x=>x.name==="can_influence_projection"&&x.dflt_value==="0"));
      const idx=db.prepare("SELECT name FROM sqlite_master WHERE tbl_name=? AND type='index'").all(table);
      assert.ok(idx.some(x=>x.name.startsWith("idx_cfb_")));
    }
    assert.equal(db.prepare("SELECT v FROM untouched_sentinel WHERE k='keep'").get().v,"original");
    const insert=db.prepare("INSERT INTO cfb_team_game_stat_observations(id,team_id,game_id,season,game_at,source,observed_at,content_hash,metrics_json,ingested_at,can_influence_projection) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const row=["r1","cfb:espn:333","401856634",2026,"2026-10-01T10:00:00Z","SDV_ESPN","2026-10-11T00:53:00Z","h1",'{"offense":{"passYards":275}}',"2026-10-11T01:04:00Z",0];
    insert.run(...row);
    assert.throws(()=>insert.run(...row.slice(0,-1),1),/constraint/i);
    assert.throws(()=>insert.run(...row),/constraint/i);
    assert.equal(migrationCount(db,"0099_cfb_fbs_statistical_ledgers"),1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cfb_team_game_stat_observations").get().n,1);
    db.exec(schema0099);
    assert.equal(migrationCount(db,"0099_cfb_fbs_statistical_ledgers"),1);
  }finally{db.close()}
});
test("0099 rejects an existing schema conflict, never registers completed migration",()=>{
  const db=dbWithLedger();
  try{
    db.exec(schema0098);
    db.exec("CREATE TABLE cfb_team_game_stat_observations (id TEXT PRIMARY KEY)");
    assert.throws(()=>db.exec(schema0099));
    assert.equal(migrationCount(db,"0099_cfb_fbs_statistical_ledgers"),0);
  }finally{db.close()}
});
