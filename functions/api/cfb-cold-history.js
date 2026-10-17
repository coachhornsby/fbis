import {harvestSecret} from '../lib/auth.js';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
/** Qualified raw historical source access. Canonical memberships stay primary. */
export async function onRequestGet({env,request}){
 if(!harvestSecret(env)||request.headers.get('x-harvest-secret')!==harvestSecret(env))return reply({ok:false,error:'FORBIDDEN'},403);
 const url=new URL(request.url),season=Number(url.searchParams.get('season')),after=url.searchParams.get('afterRowid')||'0',limit=Number(url.searchParams.get('limit')||100);
 if(!Number.isInteger(season)||season<2005||season>2025||!/^\d{1,12}$/.test(after)||!Number.isInteger(limit)||limit<1||limit>100)return reply({ok:false,error:'INVALID_SCOPE'},400);
 try{
  if(!env.COLD_HISTORY_DB?.prepare)throw Error('COLD_HISTORY_BINDING_REQUIRED');
  const accepted=await env.COLD_HISTORY_DB.prepare("SELECT * FROM storage_archive_acceptance WHERE id='cfb-2005-2025'").first();
  if(accepted?.state!=='COPY_VERIFIED'||accepted.source_rows!==430971||accepted.drive_verified!==1||! /^[a-f0-9]{64}$/.test(accepted.manifest_sha256||''))throw Error('CFB_ARCHIVE_NOT_QUALIFIED');
  const r=await env.COLD_HISTORY_DB.prepare('SELECT CAST(rowid AS TEXT) __source_rowid,* FROM cfb_roster_observations WHERE season=? AND rowid>? ORDER BY rowid LIMIT ?').bind(season,Number(after),limit+1).all();
  const rows=(r.results||[]).slice(0,limit);return reply({ok:true,season,rows,nextRowid:r.results.length>limit?rows.at(-1).__source_rowid:null,readOnly:true,sourceRowsDeleted:0,retentionReleaseAuthorized:false});
 }catch{return reply({ok:false,error:'CFB_ARCHIVE_UNAVAILABLE'},503);}
}
