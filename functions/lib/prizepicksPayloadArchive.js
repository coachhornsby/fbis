/** Historical source compaction only. Typed lines, model evidence and clocks stay untouched. */
export const PP_ARCHIVE_VERSION='fbis-prizepicks-drive-v1';
export const PP_INLINE_RAW_KEYS=Object.freeze([
 'player_image','playerImage','player_headshot_url','headshot','image_url','imageUrl',
 'league','leagueName','player_league',
 'payout_break_even_probability','break_even_probability','payoutBreakEvenProbability','breakEvenProbability',
 'payout_calibration_validated','payoutCalibrationValidated'
]);
export async function rawSha256(text){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const hex=s=>/^[a-f0-9]{64}$/.test(s||'');
export async function compactPrizePicksRaw(text,{id,driveFileId,sourceSqlSha256}={}){
 if(typeof text!=='string'||!hex(id)||!hex(sourceSqlSha256)||!/^[A-Za-z0-9_-]{10,100}$/.test(driveFileId||''))throw Error('INVALID_ARCHIVE_PROOF');
 let raw;try{raw=JSON.parse(text);}catch{return {changed:false,reason:'INVALID_JSON'};}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {changed:false,reason:'NON_OBJECT_PAYLOAD'};
 if(Object.hasOwn(raw,'_fbisArchive'))return {changed:false,reason:'ALREADY_ARCHIVED'};
 const view={};for(const key of PP_INLINE_RAW_KEYS)if(Object.hasOwn(raw,key))view[key]=raw[key];
 view._fbisArchive={version:PP_ARCHIVE_VERSION,driveFileId,sourceSqlSha256,table:'prizepicks_prop_lines',id,rawSha256:await rawSha256(text)};
 const compact=JSON.stringify(view);const bytes=s=>new TextEncoder().encode(s).length;
 if(bytes(compact)>=bytes(text))return {changed:false,reason:'NO_SAVING'};
 return {changed:true,text:compact,bytesRemoved:bytes(text)-bytes(compact)};
}
export async function restorePrizePicksRaw(compactText,archivedRow){
 const p=JSON.parse(compactText)?._fbisArchive;
 if(p?.version!==PP_ARCHIVE_VERSION||p.table!=='prizepicks_prop_lines'||p.id!==archivedRow?.id||!hex(p.rawSha256))throw Error('ARCHIVE_IDENTITY_MISMATCH');
 if(await rawSha256(archivedRow.raw_json)!==p.rawSha256)throw Error('ARCHIVE_PAYLOAD_HASH_MISMATCH');
 return archivedRow.raw_json;
}
/** 25 rows = 100 bound parameters. Indexed identity and exact old bytes are required. */
export function ppCompactionStatement(db,rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>25||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>!hex(r.id)||typeof r.oldRaw!=='string'||typeof r.newRaw!=='string'))throw Error('INVALID_COMPACTION_BATCH');
 const cases=rows.map(()=> 'WHEN ? THEN ?').join(' '),where=rows.map(()=>'(id=? AND raw_json=?)').join(' OR ');
 const params=[...rows.flatMap(r=>[r.id,r.newRaw]),...rows.flatMap(r=>[r.id,r.oldRaw])];
 return db.prepare(`UPDATE prizepicks_prop_lines SET raw_json=CASE id ${cases} END WHERE ${where}`).bind(...params);
}
