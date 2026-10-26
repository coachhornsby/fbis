#!/usr/bin/env node
/** Build research-only, append-only D1 evidence receipts AFTER 226 independent NCAA finals.
 * No PRIMARY mutations, no promotion, no wagering.
 * Usage: node scripts/cfb-phase4-export-d1-sql.mjs <R2_ARCHIVE_KEY> <R2_SHA256> <SQL_OUTPUT>
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [key,sha,out]=process.argv.slice(2);
if(!key?.startsWith('cfb/2026/weeks05-08/')||!/^([a-f0-9]{64})$/.test(sha)||!out)throw Error('R2_KEY_SHA_OUTPUT_REQUIRED');
const root=process.env.CFB_EVIDENCE_OUT||'artifacts/cfb-2026-weeks05-08';
const grades=JSON.parse(readFileSync(join(root,'complete-secondary-grading.json'),'utf8'));
const official=JSON.parse(readFileSync(join(root,'ncaa-official-reconciliation-summary.json'),'utf8'));
if(grades.rows?.length!==226||official.rows?.length!==226||official.ncaaVerified!==226||official.conflicts!==0)throw Error('ALL_226_NCAA_VERIFIED_REQUIRED');
const byId=new Map(official.rows.map(x=>[String(x.game_id),x]));
const esc=x=>String(x??'').replaceAll("'","''");
const val=x=>x===null||x===undefined?'NULL':typeof x==='number'&&Number.isFinite(x)?String(x):`'${esc(x)}'`;
let sql=[
 'CREATE TABLE IF NOT EXISTS cfb_phase4_research_evidence (game_id TEXT NOT NULL, source_archive_sha TEXT NOT NULL, season INTEGER NOT NULL, week INTEGER NOT NULL, model_version TEXT NOT NULL, original_frozen_at TEXT NOT NULL, projected_home REAL NOT NULL, projected_away REAL NOT NULL, final_home INTEGER NOT NULL, final_away INTEGER NOT NULL, ncaa_contest_id TEXT NOT NULL, ncaa_scoreboard_url TEXT NOT NULL, independent_official_verified INTEGER NOT NULL CHECK(independent_official_verified=1), margin_error REAL NOT NULL, total_error REAL NOT NULL, observed_drives INTEGER NOT NULL, complete_pbp_verified INTEGER NOT NULL CHECK(complete_pbp_verified=0), research_only INTEGER NOT NULL CHECK(research_only=1), can_authorize_wager INTEGER NOT NULL CHECK(can_authorize_wager=0), can_promote_model INTEGER NOT NULL CHECK(can_promote_model=0), r2_key TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (game_id,source_archive_sha))'
];
for(const p of grades.rows){
 const f=byId.get(String(p.game_id));
 if(!f?.independent_ncaa_verified||Number(f.ncaa_home)!==Number(p.reported_home)||Number(f.ncaa_away)!==Number(p.reported_away))throw Error('OFFICIAL_SCORE_MISMATCH:'+p.game_id);
 const fields=['game_id','source_archive_sha','season','week','model_version','original_frozen_at','projected_home','projected_away','final_home','final_away','ncaa_contest_id','ncaa_scoreboard_url','independent_official_verified','margin_error','total_error','observed_drives','complete_pbp_verified','research_only','can_authorize_wager','can_promote_model','r2_key'];
 const values=[p.game_id,sha,2026,p.week,p.model_version,p.original_frozen_at,p.pregame_home,p.pregame_away,p.reported_home,p.reported_away,f.ncaa_contest_id,f.ncaa_scoreboard_url,1,p.margin_error,p.total_error,p.retrieved_drive_count??0,0,1,0,0,key];
 sql.push(`INSERT OR IGNORE INTO cfb_phase4_research_evidence (${fields.join(',')}) VALUES (${values.map(val).join(',')})`);
}
writeFileSync(out,sql.map(x=>x+';').join('\n')+'\n');
console.log(JSON.stringify({receipt_rows:grades.rows.length,db:'CFB_DB',shadow_research_only:true,r2_key:key}));
