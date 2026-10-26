#!/usr/bin/env node
/** Append-only research settlement SQL. Only official NCAA-confirmed games with
 * originals frozen before kickoff may enter; never updates A/A or wagering.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [dir,r2Key,archiveHash,out]=process.argv.slice(2);
if(!dir||!r2Key?.startsWith('cfb/2026/weekly-postgame/')||!/^[a-f0-9]{64}$/.test(archiveHash)||!out)throw Error('REQUIRED_ARCHIVE_HASH_KEY_OUTPUT');
const report=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const ddl='CREATE TABLE IF NOT EXISTS cfb_weekly_postgame_research (season INTEGER NOT NULL,week INTEGER NOT NULL,game_id TEXT NOT NULL,weekly_source_sha TEXT NOT NULL,archive_sha TEXT NOT NULL,original_model TEXT NOT NULL,original_frozen_at TEXT NOT NULL,ncaa_contest_id TEXT NOT NULL,official_home REAL NOT NULL,official_away REAL NOT NULL,projected_home REAL NOT NULL,projected_away REAL NOT NULL,margin_error REAL NOT NULL,total_error REAL NOT NULL,ncaa_source_url TEXT NOT NULL,raw_evidence_r2_key TEXT NOT NULL,independently_official_verified INTEGER NOT NULL CHECK(independently_official_verified=1),research_only INTEGER NOT NULL CHECK(research_only=1),can_authorize_wager INTEGER NOT NULL CHECK(can_authorize_wager=0),can_promote_model INTEGER NOT NULL CHECK(can_promote_model=0),PRIMARY KEY(season,game_id,archive_sha))';
const commands=[ddl],eligible=report.records.filter(x=>x.status==='OFFICIAL_GRADED_RESEARCH_ONLY');
for(const r of eligible){
 const val=[2026,report.week,r.game_id,report.sourceSha,archiveHash,r.originalModelVersion,r.originalFrozenAt,String(r.ncaaContestId),r.officialHome,r.officialAway,r.projectedHome,r.projectedAway,r.marginError,r.totalError,r.ncaaScoreboardUrl,r2Key,1,1,0,0];
 commands.push('INSERT OR IGNORE INTO cfb_weekly_postgame_research VALUES ('+val.map(v=>typeof v==='number'?v:q(v)).join(',')+')');
}
writeFileSync(out,commands.map(x=>x+';').join('\n')+'\n');
console.log(JSON.stringify({eligibleResearchOnly:eligible.length,unsettled:report.unsettled,sourceGames:report.sourceGames,modelPromotion:false}));
