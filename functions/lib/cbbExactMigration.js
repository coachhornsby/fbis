import {deployedSportDbMode} from './databaseTopology.js';

export const CBB_SHARED_TABLES=Object.freeze(['games','predictions','prediction_snapshots','published_projections','odds_snapshots','team_form','team_form_games']);
const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/i.test(x))throw Error('CBB_UNSAFE_IDENTIFIER');return '"'+x+'"';};
function scoped(table){return CBB_SHARED_TABLES.includes(table);}
function allow(table,prefixTables){if(!scoped(table)&&!prefixTables.includes(table))throw Error('CBB_TABLE_NOT_ALLOWLISTED');}
function handles(env){
 if(deployedSportDbMode(env,'cbb')!=='shadow')throw Error('CBB_SHADOW_MODE_REQUIRED');
 if(!env.DB?.prepare||!env.CBB_DB?.prepare||env.DB===env.CBB_DB)throw Error('CBB_DISTINCT_BINDINGS_REQUIRED');
 return [env.DB,env.CBB_DB];
}
async function schema(source,target,table){
 const name=ident(table),s=(await source.prepare(`PRAGMA table_info(${name})`).all()).results||[],t=(await target.prepare(`PRAGMA table_info(${name})`).all()).results||[];
 if(!s.length||s.some(c=>!t.some(d=>d.name===c.name&&d.type===c.type&&d.pk===c.pk&&d.notnull===c.notnull&&d.dflt_value===c.dflt_value)))throw Error('CBB_SCHEMA_CONTRACT_MISMATCH:'+table);
 const keys=s.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
 if(!keys.length)throw Error('CBB_SOURCE_KEY_REQUIRED');
 return {columns:s.map(c=>c.name),keys};
}
async function meta(db){await db.prepare('CREATE TABLE IF NOT EXISTS cbb_migration_progress (id TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)').run();}
function selection(table,keys,after,limit){
 const terms=scoped(table)?["sport='cbb'"]:[],args=[];
 if(after?.length){if(after.length!==keys.length)throw Error('CBB_CURSOR_INVALID');terms.push(`(${keys.map(ident).join(',')}) > (${keys.map(()=>'?').join(',')})`);args.push(...after);}
 return {sql:`SELECT * FROM ${ident(table)} ${terms.length?'WHERE '+terms.join(' AND '):''} ORDER BY ${keys.map(ident).join(',')} LIMIT ?`,args:[...args,limit]};
}
const stable=(row,cols)=>JSON.stringify(cols.map(c=>row[c]));

/** Exact source IDs/fields, full mutable replay, atomic page + durable checkpoint. */
export async function copyCbbExactPage(env,table,{prefixTables=[],pageSize=100,maxPages=10,resume=true}={}){
 allow(table,prefixTables);const [source,target]=handles(env);
 const {columns,keys}=await schema(source,target,table);await meta(target);
 const id='copy:'+table, prior=resume?await target.prepare('SELECT state_json FROM cbb_migration_progress WHERE id=?').bind(id).first():null;
 let state=prior?JSON.parse(prior.state_json):{after:null,cycle:0};
 const limit=Math.min(100,Math.max(1,Number(pageSize)||100)),budget=Math.min(50,Math.max(1,Number(maxPages)||10));
 let copied=0,exhausted=false;
 for(let page=0;page<budget;page++){
  const query=selection(table,keys,state.after,limit),rows=(await source.prepare(query.sql).bind(...query.args).all()).results||[];
  if(rows.some(r=>scoped(table)&&r.sport!=='cbb'))throw Error('CBB_CROSS_SPORT_ROW');
  if(rows.some(r=>keys.some(k=>r[k]==null)))throw Error('CBB_NULL_SOURCE_KEY');
  const updates=columns.filter(c=>!keys.includes(c));
  const sql=`INSERT INTO ${ident(table)}(${columns.map(ident).join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(${keys.map(ident).join(',')}) DO ${updates.length?'UPDATE SET '+updates.map(c=>`${ident(c)}=excluded.${ident(c)}`).join(','):'NOTHING'}`;
  exhausted=rows.length<limit;
  const next={after:exhausted?null:keys.map(k=>rows.at(-1)[k]),cycle:state.cycle+(exhausted?1:0)};
  const stmts=rows.map(row=>target.prepare(sql).bind(...columns.map(c=>row[c]??null)));
  stmts.push(target.prepare('INSERT INTO cbb_migration_progress(id,state_json,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').bind(id,JSON.stringify(next),new Date().toISOString()));
  if(typeof target.batch!=='function')throw Error('CBB_ATOMIC_BATCH_REQUIRED');
  await target.batch(stmts);copied+=rows.length;state=next;
  if(exhausted)break;
 }
 return {ok:true,table,copied,exhausted,cursor:state.after,cycle:state.cycle,productStillPrimary:true,canAuthorizeWager:false};
}

/** Independent two-way exhaustive ordered scan. No writes to either record set. */
export async function compareCbbExactPage(env,table,{prefixTables=[],after=null,pageSize=1000}={}){
 allow(table,prefixTables);const [source,target]=handles(env);const {columns,keys}=await schema(source,target,table);
 const query=selection(table,keys,after,Math.min(1000,Math.max(1,Number(pageSize)||1000)));
 const [s,t]=await Promise.all([source.prepare(query.sql).bind(...query.args).all(),target.prepare(query.sql).bind(...query.args).all()]);
 const left=s.results||[],right=t.results||[];
 // Compare union up to the smaller page boundary; a shifted key must never hide a missing row.
 const end=left.length&&right.length?(JSON.stringify(keys.map(k=>left.at(-1)[k]))===JSON.stringify(keys.map(k=>right.at(-1)[k]))?keys.map(k=>left.at(-1)[k]):null):null;
 const equal=left.length===right.length&&left.every((r,i)=>stable(r,columns)===stable(right[i],columns));
 const digest=async rows=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows.map(r=>columns.map(c=>r[c]))))))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return {ok:equal,table,sourceRows:left.length,targetRows:right.length,sourceHash:await digest(left),targetHash:await digest(right),nextAfter:equal?end:null,exhausted:equal&&left.length<query.args.at(-1),status:equal?'PAGE_FIELDS_MATCH':'RECORD_MISMATCH_STOP',canAuthorizeWager:false};
}
