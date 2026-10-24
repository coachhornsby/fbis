/**
 * NBA post-cutover, strictly additive recovery from legacy PRIMARY -> NBA_DB.
 * Existing NBA_DB keys/field values are immutable. Never delete from either DB.
 * Distinct from shadow sync: permitted only with a fresh CORE-approved SPORT grant.
 */
import { resolveNbaResearchOwnerDb } from "./nbaResearchOwnerDb.js";
import { SPORT_PREFIX_TABLES } from "./sportWorkingCopy.js";

const safeId=s=>typeof s==="string"&&/^[a-z][a-z0-9_]*$/.test(s);
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const same=(a,b,columns)=>columns.every(k=>a[k]===b[k]||(a[k]==null&&b[k]==null));

export async function recoverMissingNbaResearchPage(env,{
  table,afterRowid=0,pageSize=80,highRowid=null,dryRun=false,
}={}){
 const refused=reason=>({ok:false,sport:"nba",table,reason,
    sourceRowsDeleted:0,existingRowsOverwritten:0,canAuthorizeWager:false});
 if(!SPORT_PREFIX_TABLES.nba.includes(table)||!safeId(table))
   return refused("NBA_TABLE_NOT_ALLOWLISTED");
 const owner=await resolveNbaResearchOwnerDb(env);
 if(!owner.ok||owner.mode!=="sport"||owner.binding!=="NBA_DB")
   return refused(owner.reason||"APPROVED_NBA_DB_REQUIRED");
 const source=env.DB,target=owner.db;
 if(!source?.prepare||!target?.prepare||source===target)
   return refused("DISTINCT_NBA_DATABASE_BINDINGS_REQUIRED");
 const cursor=Number(afterRowid),limit=Number(pageSize);
 if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(limit)||limit<1||limit>100)
   return refused("INVALID_PAGE");
 const [srcInfo,dstInfo]=await Promise.all([
   source.prepare("PRAGMA table_info("+table+")").all(),
   target.prepare("PRAGMA table_info("+table+")").all(),
 ]);
 const srcCols=(srcInfo?.results||[]).map(c=>c.name);
 const dstCols=(dstInfo?.results||[]).map(c=>c.name);
 if(!srcCols.length||JSON.stringify(srcCols)!==JSON.stringify(dstCols)
   ||!srcCols.every(safeId)) return refused("TABLE_SCHEMA_NOT_IDENTICAL");
 const primaryKeys=(srcInfo.results||[]).filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
 if(primaryKeys.length!==1||!safeId(primaryKeys[0]))
   return refused("UNSUPPORTED_COMPOSITE_OR_MISSING_PK");
 const pk=primaryKeys[0];
 const actualHigh=Number((await source.prepare("SELECT COALESCE(MAX(rowid),0) n FROM "+table).first())?.n||0);
 let ceiling=highRowid==null?actualHigh:Number(highRowid);
 if(!Number.isSafeInteger(ceiling)||ceiling<0||ceiling>actualHigh)
   return refused("INVALID_FROZEN_SOURCE_UPPER_BOUND");
 const rows=(await source.prepare("SELECT rowid AS __fbis_recovery_rowid,* FROM "+table+
   " WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?")
   .bind(cursor,ceiling,limit).all())?.results||[];
 const nextCursor=rows.length?Number(rows.at(-1).__fbis_recovery_rowid):cursor;
 if(rows.some(r=>!Number.isSafeInteger(Number(r.__fbis_recovery_rowid))||
   r[pk]===undefined||r[pk]===null))
   return refused("SOURCE_ROW_PK_OR_ROWID_INVALID");
 const found=new Map();
 // Keep SQLite parameter bindings small and avoid templating source data into SQL.
 for(let i=0;i<rows.length;i+=50){
   const subset=rows.slice(i,i+50);
   const placeholders=subset.map(()=>"?").join(",");
   const q=(await target.prepare("SELECT "+quote(pk)+" FROM "+table+
      " WHERE "+quote(pk)+" IN ("+placeholders+")")
      .bind(...subset.map(r=>r[pk])).all())?.results||[];
   for(const row of q)found.set(String(row[pk]),true);
 }
 const missing=rows.filter(r=>!found.has(String(r[pk])));
 if(!dryRun&&missing.length){
   const colsql=srcCols.map(quote).join(",");
   const sql="INSERT OR IGNORE INTO "+table+"("+colsql+") VALUES("+
     srcCols.map(()=>"?").join(",")+")";
   // Bound statement groups prevent exceeding D1 batch limits.
   for(let i=0;i<missing.length;i+=20){
     const subset=missing.slice(i,i+20);
     const stmts=subset.map(r=>target.prepare(sql).bind(...srcCols.map(c=>r[c]??null)));
     if(typeof target.batch==="function")await target.batch(stmts);
     else for(const st of stmts)await st.run();
   }
   // Verify every missing source row now exists with every source field intact.
   // No replacement of an existing row is ever issued.
   for(const row of missing){
     const got=await target.prepare("SELECT * FROM "+table+
         " WHERE "+quote(pk)+"=? LIMIT 1").bind(row[pk]).first();
     if(!got||!same(row,got,srcCols))
       return { ...refused("RECOVERY_SOURCE_FIELD_VERIFICATION_FAILED"),
         failedKey:String(row[pk]).slice(0,120),copiedAttempted:missing.length };
   }
 }
 return {ok:true,table,sport:"nba",mode:dryRun?"dry-run":"insert-missing-only",
   sourceCursor:cursor,nextCursor,frozenHighRowid:ceiling,
   scanned:rows.length,alreadyInNbaDb:rows.length-missing.length,
   inserted:dryRun?0:missing.length,wouldInsert:dryRun?missing.length:0,
   exhausted:nextCursor>=ceiling||rows.length<limit,
   sourceRowsDeleted:0,existingRowsOverwritten:0,canAuthorizeWager:false};
}
