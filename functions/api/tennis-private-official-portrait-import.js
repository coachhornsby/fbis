// Authenticated, rights-gated PRIVATE official portrait upload. Accepts operator-supplied bytes only.
// No fetching, URL redirects, public-serving route or automated permission activation.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const COHORT='tennis-elo-private-20261019-1074';
const reply=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
const hex=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
function validSource(url,tour,id){
 try {
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port)return false;
  if(tour==='atp')return /^[a-z0-9]{3,6}$/.test(id)&&u.hostname==='www.atptour.com'
    &&u.pathname===('/-/media/alias/player-headshot/'+id.toLowerCase());
  if(tour==='wta')return /^\d{2,10}$/.test(id)&&u.hostname==='wtafiles.blob.core.windows.net'
    &&u.pathname===('/images/headshots/'+id+'.jpg');
 }catch{}
 return false;
}
function imageType(bytes){
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=8&&bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]))return 'image/png';
 if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return reply(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare||!env?.ARCHIVE?.put||!env?.ARCHIVE?.head||!env?.ARCHIVE?.delete)
  return reply({ok:false,reason:'PRIVATE_STORAGE_UNAVAILABLE'},503);
 if(Number(request.headers.get('content-length')||0)>8*1024*1024)return reply({ok:false,reason:'BODY_TOO_LARGE'},413);
 let input;try{input=await request.json()}catch{return reply({ok:false,reason:'INVALID_BODY'},400)}
 const tour=String(input?.tour||'').toLowerCase(),key=String(input?.playerKey||''),id=String(input?.playerId||'');
 const source=String(input?.officialUrl||''),sha=String(input?.sha256||'').toLowerCase();
 if(!['atp','wta'].includes(tour)||!key||!id||!/^[a-f0-9]{64}$/.test(sha)||
   typeof input?.dataBase64!=='string'||input.dataBase64.length>7*1024*1024)
  return reply({ok:false,reason:'INVALID_MANIFEST'},422);
 try {
  const policy=await env.DB.prepare(`SELECT rights_evidence_ref,rights_verification,access_verification,activation_state
    FROM tennis_private_portrait_policy WHERE tour=? AND cohort_id=?`).bind(tour,COHORT).first();
  if(!policy||policy.rights_verification!=='DOCUMENTED_PRIVATE_USE'||
    policy.access_verification!=='VERIFIED_PRIVATE_ACCESS'||policy.activation_state!=='PRIVATE_IMPORT_ALLOWED'||
    !String(policy.rights_evidence_ref||'').trim())return reply({ok:false,reason:'RIGHTS_OR_PRIVATE_ACCESS_NOT_VERIFIED'},403);
  const member=await env.DB.prepare(`SELECT m.fbis_player_id,m.identity_status,r.official_player_id,
    r.headshot_candidate_url,r.headshot_status,r.headshot_evidence_ref
    FROM tennis_private_portrait_cohort_members m
    JOIN tennis_private_portrait_source_references r ON r.cohort_id=m.cohort_id
       AND r.tour=m.tour AND r.player_key=m.player_key
    WHERE m.cohort_id=? AND m.tour=? AND m.player_key=?`).bind(COHORT,tour,key).first();
  if(!member||member.identity_status!=='MATCHED'||member.fbis_player_id!==id||
    member.headshot_status!=='OFFICIAL_IMAGE_SOURCE_VERIFIED'||member.headshot_candidate_url!==source||
    !member.headshot_evidence_ref||!validSource(source,tour,String(member.official_player_id||'')))
      return reply({ok:false,reason:'OFFICIAL_SOURCE_NOT_VERIFIED'},409);
  const existing=await env.DB.prepare(`SELECT sha256,asset_key FROM tennis_private_portrait_imports
    WHERE cohort_id=? AND tour=? AND player_key=?`).bind(COHORT,tour,key).first();
  if(existing)return reply({ok:existing.sha256===sha,status:'ALREADY_IMPORTED',checksumMatch:existing.sha256===sha,
    playerId:id},existing.sha256===sha?200:409);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64))return reply({ok:false,reason:'INVALID_BASE64'},422);
  const binary=atob(input.dataBase64),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  if(bytes.length<300||bytes.length>5242880)return reply({ok:false,reason:'IMAGE_SIZE_INVALID'},422);
  const type=imageType(bytes);
  if(!type||type!==input.contentType)return reply({ok:false,reason:'IMAGE_MIME_MISMATCH'},422);
  if(await hex(bytes)!==sha)return reply({ok:false,reason:'IMAGE_CHECKSUM_MISMATCH'},422);
  const assetKey='tennis/private-official/'+tour+'/'+sha.slice(0,2)+'/'+sha;
  if(await env.ARCHIVE.head(assetKey))return reply({ok:false,reason:'OBJECT_KEY_ALREADY_EXISTS_RECONCILE'},409);
  await env.ARCHIVE.put(assetKey,bytes,{httpMetadata:{contentType:type},
    customMetadata:{scope:'PRIVATE_ONLY',cohort:COHORT,tour,sha256:sha}});
  try{
   const write=await env.DB.prepare(`INSERT INTO tennis_private_portrait_imports
    (cohort_id,tour,player_key,fbis_player_id,official_image_url,asset_key,sha256,
     content_type,byte_count,rights_evidence_ref,imported_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(COHORT,tour,key,id,source,assetKey,sha,type,
      bytes.byteLength,policy.rights_evidence_ref,new Date().toISOString()).run();
   if(Number(write?.meta?.changes)!==1)throw Error('LEDGER_WRITE_NOT_CONFIRMED');
  }catch(e){
   await env.ARCHIVE.delete(assetKey);
   return reply({ok:false,reason:'LEDGER_WRITE_FAILED_ROLLED_BACK'},503);
  }
  return reply({ok:true,status:'PRIVATE_IMPORTED',playerId:id,tour,sha256:sha,bytes:bytes.length,
    storageScope:'PRIVATE_ONLY',publicDisplayAllowed:false});
 }catch{return reply({ok:false,reason:'PRIVATE_IMPORT_UNAVAILABLE'},503)}
}
