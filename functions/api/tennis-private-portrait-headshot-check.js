// Source-only WTA headshot HEAD verification. No image bytes are downloaded,
// archived, served, or allowed into production before private access & rights.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const respond=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const COHORT='tennis-elo-private-20261019-1074';
const SRC='WTA_OFFICIAL_SITE_TEMPLATE';
const prefix='https://wtafiles.blob.core.windows.net/images/headshots/';
function sourceMatch(url,id){
 return /^\d{2,10}$/.test(String(id||''))&&url===prefix+id+'.jpg';
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return respond(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return respond({ok:false,reason:'DB_UNAVAILABLE'},503);
 const q=new URL(request.url).searchParams,limit=Math.max(1,Math.min(60,Number(q.get('limit')||40)||40));
 const after=String(q.get('after')||'').slice(0,90);
 try{
  const rows=(await env.DB.prepare(`SELECT r.player_key,r.official_player_id,
    r.headshot_candidate_url,m.player_name
    FROM tennis_private_portrait_source_references r
    JOIN tennis_private_portrait_cohort_members m ON m.cohort_id=r.cohort_id
     AND m.tour=r.tour AND m.player_key=r.player_key
    WHERE r.cohort_id=? AND r.tour='wta' AND r.player_key>?
      AND r.official_id_provider='WTA_OFFICIAL'
      AND r.headshot_candidate_source=?
      AND r.headshot_status IN ('OFFICIAL_SITE_TEMPLATE_CANDIDATE','OFFICIAL_IMAGE_SOURCE_VERIFIED')
    ORDER BY r.player_key LIMIT ?`).bind(COHORT,after,SRC,limit).all()).results||[];
  const items=rows.filter(r=>sourceMatch(r.headshot_candidate_url,r.official_player_id))
    .map(r=>({playerKey:r.player_key,sourceId:r.official_player_id,
      candidateUrl:r.headshot_candidate_url}));
  return respond({ok:true,cohortId:COHORT,items,nextCursor:rows.length===limit?rows.at(-1).player_key:null,
    doesNotAuthorizeUsage:true,doesNotDownloadImages:true});
 }catch{return respond({ok:false,reason:'SOURCE_MANIFEST_UNAVAILABLE'},503);}
}
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return respond(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return respond({ok:false,reason:'DB_UNAVAILABLE'},503);
 let payload;try{payload=await request.json();}catch{return respond({ok:false,reason:'INVALID_JSON'},400);}
 const observations=payload?.observations;
 if(!Array.isArray(observations)||observations.length<1||observations.length>60)
  return respond({ok:false,reason:'INVALID_OBSERVATION_BATCH'},422);
 let verified=0,rejected=0,availableOnly=0;
 for(const o of observations){
  const key=String(o?.playerKey||''),src=String(o?.candidateUrl||'');
  if(!/^[a-z0-9 ]{2,90}$/.test(key)||!/^\d{2,10}$/.test(String(o?.sourceId||''))||
   !sourceMatch(src,String(o.sourceId))){rejected++;continue;}
  const date=Date.parse(o.observedAt||'');
  if(!Number.isFinite(date)||Math.abs(Date.now()-date)>60*60000){rejected++;continue;}
  const ctype=String(o.contentType||'').split(';')[0].trim().toLowerCase();
  const status=Number(o.httpStatus);
  const evidence=JSON.stringify({method:'HEAD',status,contentType:ctype,observedAt:o.observedAt,
    sourceUrl:src,verifiedVia:'GITHUB_ACTIONS_OPERATOR',imageBytesDownloaded:false});
  try{
   const existing=await env.DB.prepare(`SELECT official_player_id,headshot_candidate_url,headshot_status
    FROM tennis_private_portrait_source_references WHERE cohort_id=? AND tour='wta'
    AND player_key=? AND headshot_candidate_source=?`).bind(COHORT,key,SRC).first();
   if(!existing||String(existing.official_player_id)!==String(o.sourceId)||
     existing.headshot_candidate_url!==src){rejected++;continue;}
   if(status===200&&ctype==='image/jpeg'){
    const r=await env.DB.prepare(`UPDATE tennis_private_portrait_source_references
      SET headshot_status='OFFICIAL_IMAGE_SOURCE_VERIFIED',headshot_evidence_ref=?,noted_at=?
      WHERE cohort_id=? AND tour='wta' AND player_key=?
      AND official_player_id=? AND headshot_candidate_url=?
      AND private_image_imported=0 AND public_display_allowed=0`)
      .bind(evidence,o.observedAt,COHORT,key,String(o.sourceId),src).run();
    if(Number(r?.meta?.changes)===1)verified++;else rejected++;
   }else availableOnly++; // 404 or forbidden remains a candidate, never promote.
  }catch{rejected++;}
 }
 return respond({ok:rejected===0,received:observations.length,verified,rejected,notVerified:availableOnly,
   authorizedForImport:false,imagesDownloaded:0,publicDisplayAllowed:false},rejected?207:200);
}
