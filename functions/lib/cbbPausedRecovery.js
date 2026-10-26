import {deployedSportDbMode} from './databaseTopology.js';
import {CBB_SHARED_TABLES,copyCbbExactPage} from './cbbExactMigration.js';
import {SPORT_PREFIX_TABLES} from './sportWorkingCopy.js';
const quoted=x=>{if(!/^[a-z_][a-z0-9_]*$/i.test(x))throw Error('CBB_RECOVERY_INVALID_IDENTIFIER');return '"'+x+'"';};
/** No HTTP endpoint. Operator-controlled paused recovery only; never deletes a source row. */
export async function replayPausedCbbPage(env,table,options={}){
 if(deployedSportDbMode(env,'cbb')!=='sport'||!['1','true','yes'].includes(String(env.SPORT_DB_STRICT_CBB).toLowerCase())
  ||env.CBB_ROLLBACK_RECOVERY_MODE!=='paused'||String(env.SPORT_CUTOVER_RECEIPT_CBB||'').trim())
  throw Error('CBB_RECOVERY_REQUIRES_PAUSED_STRICT_SPORT_WITHOUT_RECEIPT');
 const prefix=SPORT_PREFIX_TABLES.cbb;
 if(![...CBB_SHARED_TABLES,...prefix].includes(table))throw Error('CBB_RECOVERY_TABLE_NOT_APPROVED');
 if(!env.DB?.prepare||!env.CBB_DB?.prepare||env.DB===env.CBB_DB)throw Error('CBB_RECOVERY_DISTINCT_BINDINGS_REQUIRED');
 const validatePage=async({rows,columns,keys,target})=>{
  for(const row of rows){
   const existing=await target.prepare(`SELECT * FROM ${quoted(table)} WHERE ${keys.map(k=>quoted(k)+' IS ?').join(' AND ')}`)
    .bind(...keys.map(k=>row[k])).first();
   if(!existing)continue;
   if(CBB_SHARED_TABLES.includes(table)&&existing.sport!=='cbb')throw Error('CBB_RECOVERY_CROSS_SPORT_ID_COLLISION');
   if(existing.game_id!=null&&row.game_id!=null&&existing.game_id!==row.game_id)throw Error('CBB_RECOVERY_GAME_IDENTITY_CONFLICT');
   if(['predictions','prediction_snapshots','published_projections'].includes(table)){
    for(const key of ['model_version','frozen_at','proj_home','proj_away','proj_total','proj_margin','payload_json','payload_hash']){
     if(columns.includes(key)&&existing[key]!==row[key])throw Error('CBB_RECOVERY_FROZEN_FIELD_CONFLICT:'+key);
    }
   }
  }
 };
 const result=await copyCbbExactPage({DB:env.CBB_DB,CBB_DB:env.DB,SPORT_DB_MODE_CBB:'shadow'},table,
  {...options,prefixTables:prefix,validatePage});
 return {...result,productStillPrimary:false,authorityPaused:true,sourcePreserved:true,primaryDeletionCount:0,canAuthorizeWager:false};
}
