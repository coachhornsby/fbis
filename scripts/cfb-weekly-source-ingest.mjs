#!/usr/bin/env node
/** Incoming weekly CFBD Tier3 CSV -> immutable research receipt + append-only shadow D1 SQL.
 * NEVER trains, reprojects, grades a not-yet-completed game or changes wager authority.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateWeeklyCsv} from './cfb-weekly-input-guard.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
export function sourceWeek(at){
 const time=Date.parse(at);
 if(!Number.isFinite(time))throw Error('VALID_TIMESTAMP_REQUIRED');
 const anchor=Date.parse('2026-10-26T00:00:00Z');
 const weeks=Math.floor((time-anchor+24*3600*1000)/(7*24*3600*1000));
 return 9+weeks;
}
export function prepare(source,{season,week,observedAt,outputDir='artifacts/cfb-weekly-inbox'}){
 if(season!==2026||!Number.isInteger(week)||week<5||week>18)throw Error('UNEXPECTED_SEASON_WEEK');
 const validated=validateWeeklyCsv(source,{observedAt,expectedSeason:season,expectedWeek:week});
 const fingerprint=sha(source);
 const r2Key=`cfb/training/immutable/${season}/week${String(week).padStart(2,'0')}/${fingerprint}.csv`;
 const receipt={schema:'fbis.cfb.weekly_source.v2',season,week,sha256:fingerprint,sourceReceivedAt:observedAt,
  publicationAttestation:'OPERATOR_ATTESTED_PREGAME',preKickoffObservation:true,
  earliestKickoff:validated.rows.map(x=>x.kickoff_utc).sort()[0],
  rowCount:validated.rows.length,featureCount:Object.keys(validated.rows[0]).length-1,
  r2Key,championAuthority:false,canAuthorizeWager:false,canPromoteModel:false,
  frozenProjectionReceiptsAttached:false,prospectiveQualifier:false};
 mkdirSync(outputDir,{recursive:true});
 writeFileSync(join(outputDir,'source.csv'),source);
 writeFileSync(join(outputDir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 const ddl='CREATE TABLE IF NOT EXISTS cfb_weekly_research_sources (season INTEGER NOT NULL,week INTEGER NOT NULL,game_id TEXT NOT NULL,source_sha TEXT NOT NULL,kickoff_utc TEXT NOT NULL,source_observed_at TEXT NOT NULL,publication_attestation TEXT NOT NULL,source_r2_key TEXT NOT NULL,features_json TEXT NOT NULL,can_authorize_wager INTEGER NOT NULL CHECK(can_authorize_wager=0),can_promote_model INTEGER NOT NULL CHECK(can_promote_model=0),PRIMARY KEY(season,week,game_id,source_sha))';
 const sql=[ddl,...validated.rows.map(r=>{
   const fields=['season','week','game_id','source_sha','kickoff_utc','source_observed_at','publication_attestation','source_r2_key','features_json','can_authorize_wager','can_promote_model'];
   const values=[season,week,r.id,fingerprint,r.kickoff_utc,observedAt,'OPERATOR_ATTESTED_PREGAME',r2Key,JSON.stringify(r),0,0];
   return 'INSERT OR IGNORE INTO cfb_weekly_research_sources ('+fields.join(',')+') VALUES ('+values.map(v=>typeof v==='number'?v:quote(v)).join(',')+')';
 })];
 writeFileSync(join(outputDir,'shadow-research.sql'),sql.map(x=>x+';').join('\n')+'\n');
 return receipt;
}
if(process.argv[1]?.endsWith('cfb-weekly-source-ingest.mjs')){
 const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i===-1?null:args[i+1];};
 const week=Number(opt('--week')||sourceWeek(new Date().toISOString()));
 const season=Number(opt('--season')||2026),observedAt=opt('--observed-at')||new Date().toISOString();
 const csv=opt('--csv'),outputDir=opt('--out-dir')||'artifacts/cfb-weekly-inbox';
 if(!csv)throw Error('--csv is required');
 console.log(JSON.stringify(prepare(readFileSync(csv,'utf8'),{season,week,observedAt,outputDir})));
}
