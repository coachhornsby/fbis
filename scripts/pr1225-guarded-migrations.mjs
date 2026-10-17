import {spawnSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const run=(args)=>{const r=spawnSync('npx',['wrangler',...args],{encoding:'utf8',maxBuffer:8e6});if(r.status!==0)throw new Error(`Wrangler failed: ${r.stderr}`);return r.stdout;};
const query=(db,sql)=>JSON.parse(run(['d1','execute',db,'--remote','--json','--command='+sql]));
const receipt={checkedAt:new Date().toISOString(),collectionStarted:false,targets:[]};
mkdirSync('artifacts',{recursive:true});
for(const db of ['fbis-cfb-tier3-research','fbis']) {
  const ids=['0109_cfb_tier3_schema_identity',...(db==='fbis'?['0110_cbb_team_profile_snapshots']:[])];
  const tables=['cfb_tier3_training_snapshots','cfb_tier3_training_games','schema_migrations',...(db==='fbis'?['d1_migrations']:[])];
  const before=query(db,"SELECT * FROM schema_migrations WHERE id IN ('0109_cfb_tier3_schema_identity','0110_cbb_team_profile_snapshots'); PRAGMA table_info(cfb_tier3_training_snapshots); PRAGMA table_info(cfb_tier3_training_games); SELECT COUNT(*) n FROM cfb_tier3_training_games;");
  const expected=['schema_version','header_sha256','home_canonical_id','away_canonical_id','identity_detail_json'];
  const cols=before.slice(1,3).flatMap(r=>r.results.map(c=>c.name));
  const present=expected.filter(c=>cols.includes(c));
  const marked=before[0].results.some(r=>r.id===ids[0]);
  if(present.length!==0&&present.length!==expected.length)throw new Error('Partial 0109 schema; refuse ALTER');
  if(marked&&present.length!==expected.length)throw new Error('0109 ledger/schema mismatch');
  const file=`/tmp/${db}-pr1225-backup.sql`;
  run(['d1','export',db,'--remote','--output',file,'--table',...tables]);
  const sha256=createHash('sha256').update(readFileSync(file)).digest('hex');
  const backupKey=`migration-backups/pr1225/${receipt.checkedAt.replace(/[:.]/g,'-')}/${db}.sql`;
  run(['r2','object','put',`fbis-archive/${backupKey}`,'--remote','--file',file]);
  for(const id of ids) {
    let sql=readFileSync(`migrations/${id}.sql`,'utf8');
    if(id===ids[0]&&present.length===expected.length)sql=sql.split('\n').filter(l=>!l.startsWith('ALTER TABLE')).join('\n');
    if(db==='fbis')sql+=`\nINSERT OR IGNORE INTO d1_migrations(name) VALUES ('${id}.sql');`;
    query(db,sql);
  }
  const after=query(db,"SELECT * FROM schema_migrations WHERE id IN ('0109_cfb_tier3_schema_identity','0110_cbb_team_profile_snapshots'); PRAGMA table_info(cfb_tier3_training_snapshots); PRAGMA table_info(cfb_tier3_training_games); SELECT COUNT(*) n FROM cfb_tier3_training_games;");
  if(before[3].results[0].n!==after[3].results[0].n)throw new Error('Game count changed during schema migration');
  if(expected.some(c=>!after.slice(1,3).flatMap(r=>r.results.map(x=>x.name)).includes(c)))throw new Error('Schema verification failed');
  receipt.targets.push({database:db,backupKey,sha256,gameRowsBefore:before[3].results[0].n,gameRowsAfter:after[3].results[0].n,migrations:after[0].results});
  writeFileSync('artifacts/pr1225-migration-receipt.json',JSON.stringify(receipt,null,2));
}
console.log(JSON.stringify(receipt));
