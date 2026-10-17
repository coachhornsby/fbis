import {createHash} from 'node:crypto';
export const PRIMARY_DB='b50c724c-903b-4241-8ce1-48d931e7a44c';
export const COLD_DB='6fad1baf-126f-4ab8-9b80-a7d71637d6d4';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const identifier=s=>{if(!/^[a-z_][a-z0-9_]*$/i.test(s))throw Error('INVALID_IDENTIFIER');return '"'+s+'"';};
export function sqlValue(v){
 if(v===null)return 'NULL';
 if(typeof v==='number'){if(!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v)))throw Error('UNSAFE_NUMBER');return String(v);}
 if(typeof v!=='string')throw Error('UNSUPPORTED_VALUE');
 return v.includes('\0')?"CAST(X'"+Buffer.from(v).toString('hex')+"' AS TEXT)":"'"+v.replaceAll("'","''")+"'";
}
export function rowSql(table,columns,rows){
 const prefix='INSERT OR IGNORE INTO '+identifier(table)+'(rowid,'+columns.map(identifier).join(',')+') VALUES ';
 const statements=[];let values=[];
 for(const row of rows){
  if(!/^\d+$/.test(row.__source_rowid)||!Number.isSafeInteger(Number(row.__source_rowid)))throw Error('INVALID_ROWID');
  const value='('+[row.__source_rowid,...columns.map(k=>sqlValue(row[k]))].join(',')+')';
  if(Buffer.byteLength(prefix+value)>90000)throw Error('ROW_EXCEEDS_SQL_BUDGET');
  if(values.length&&Buffer.byteLength(prefix+[...values,value].join(','))>90000){statements.push(prefix+values.join(',')+';');values=[];}
  values.push(value);
 }
 if(values.length)statements.push(prefix+values.join(',')+';');
 return statements.join('\n')+'\n';
}
export function assertRowsEqual(expected,actual,columns){
 if(expected.length!==actual.length)throw Error('ROW_COUNT_PARITY_FAILED');
 for(let i=0;i<expected.length;i++)for(const k of ['__source_rowid',...columns])if(expected[i][k]!==actual[i][k])throw Error('FIELD_PARITY_FAILED_'+k);
}
