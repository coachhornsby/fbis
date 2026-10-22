// ATP official ranking URL evidence for the source-locked private Tennis cohort.
// Harvest-secret authenticated. No photos downloaded or published.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const reply=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const COHORT='tennis-elo-private-20261019-1074';
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return reply(unauthorizedBody(auth.reason),403);
 try{
  const rows=(await env.DB.prepare(`SELECT m.player_key,m.fbis_player_id,m.player_name,
   r.official_player_id,r.official_id_status
   FROM tennis_private_portrait_cohort_members m
   JOIN tennis_private_portrait_source_references r
    ON r.cohort_id=m.cohort_id AND r.tour=m.tour AND r.player_key=m.player_key
   WHERE m.cohort_id=? AND m.tour='atp' ORDER BY m.elo_rank`).bind(COHORT).all()).results||[];
  return reply({ok:rows.length===559,cohortId:COHORT,players:rows.map(r=>({
   key:r.player_key,officialId:r.official_player_id||null})),
   noImageBytes:true},rows.length===559?200:409);
 }catch{return reply({ok:false,reason:'ATP_MANIFEST_UNAVAILABLE'},503);}
}
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return reply(unauthorizedBody(auth.reason),403);
 let body;try{body=await request.json();}catch{return reply({ok:false,reason:'INVALID_JSON'},400);}
 const rows=body?.rows;
 if(!Array.isArray(rows)||rows.length<1||rows.length>75)return reply({ok:false,reason:'INVALID_BATCH'},422);
 let linked=0,unchanged=0,rejected=0;
 for(const row of rows){
  const key=norm(row?.playerKey),id=String(row?.atpId||'').toLowerCase();
  const slug=String(row?.slug||'').toLowerCase(),src=String(row?.profileUrl||'');
  const range=String(row?.rankingRange||''),sourceHash=String(row?.sourceSha256||'');
  if(!/^[a-z0-9 ]{4,80}$/.test(key)||!/^[-a-z0-9]{3,90}$/.test(slug)||
   !/^[a-z0-9]{3,6}$/.test(id)||!/^[a-f0-9]{64}$/.test(sourceHash)||
   norm(slug)!==key||src!=='https://www.atptour.com/en/players/'+slug+'/'+id+'/overview'||
   !/^(0-100|101-200|201-300|301-400|401-500|501-600|601-700|701-800|801-900|901-1000|1001-1100|1101-1200|1201-1300|1301-1400|1401-1500|1501-5000)$/.test(range)){
    rejected++;continue;
  }
  try{
   const source=await env.DB.prepare(`SELECT m.fbis_player_id,m.identity_status,
     r.official_player_id,r.official_id_provider,r.official_id_status
     FROM tennis_private_portrait_cohort_members m
     JOIN tennis_private_portrait_source_references r ON r.cohort_id=m.cohort_id
       AND r.tour=m.tour AND r.player_key=m.player_key
     WHERE m.cohort_id=? AND m.tour='atp' AND m.player_key=?`).bind(COHORT,key).first();
   if(!source||source.identity_status!=='MATCHED'){rejected++;continue;}
   // A pre-existing official ID cannot silently be overwritten by a new source.
   if(source.official_player_id&&source.official_player_id.toLowerCase()!==id){
    rejected++;continue;
   }
   const dup=await env.DB.prepare(`SELECT player_key FROM tennis_private_portrait_source_references
     WHERE cohort_id=? AND tour='atp' AND official_id_provider='ATP_OFFICIAL'
      AND official_player_id=? AND player_key<>?`).bind(COHORT,id,key).first();
   if(dup){rejected++;continue;}
   const sourceIdLink=await env.DB.prepare(`SELECT fbis_player_id FROM tennis_player_source_ids WHERE provider='ATP_OFFICIAL' AND source_player_id=?`).bind(id).first();
   if(sourceIdLink&&sourceIdLink.fbis_player_id!==source.fbis_player_id){rejected++;continue;}
   const provenance=JSON.stringify({source:'ATP_OFFICIAL',rankingPage:'https://www.atptour.com/en/rankings/singles?rankRange='+range,
    rankingHtmlSha256:sourceHash,playerLink:src,collectionMethod:'GITHUB_ACTIONS_OFFICIAL_SITE',verifiedScope:'OFFICIAL_LINK_ONLY'});
   const update=await env.DB.prepare(`UPDATE tennis_private_portrait_source_references
    SET official_id_provider='ATP_OFFICIAL',official_player_id=?,official_id_status='LINKED_FROM_OFFICIAL_INGEST',
      official_profile_candidate_url=?,profile_status='SOURCE_URL_VERIFIED',
      headshot_candidate_url='https://www.atptour.com/-/media/alias/player-headshot/'||lower(?),
      headshot_candidate_source='ATP_OFFICIAL_PAGE_TEMPLATE',
      headshot_status='OFFICIAL_SITE_TEMPLATE_CANDIDATE',
      headshot_evidence_ref=NULL,noted_at=?
    WHERE cohort_id=? AND tour='atp' AND player_key=?
      AND private_image_imported=0 AND public_display_allowed=0`)
    .bind(id,src,id,new Date().toISOString(),COHORT,key).run();
   if(Number(update?.meta?.changes)!==1){rejected++;continue;}
   const now=new Date().toISOString();
   await env.DB.prepare(`INSERT OR IGNORE INTO tennis_player_source_ids
    (provider,source_player_id,fbis_player_id,source_name,normalized_source_name,
     source_priority,first_seen_at,last_seen_at,provenance_json)
    VALUES('ATP_OFFICIAL',?,?,?,?,100,?,?,?)`)
    .bind(id,source.fbis_player_id,row.playerName||slug,key,now,now,provenance).run();
   linked++;
  }catch{rejected++;}
 }
 return reply({ok:rejected===0,received:rows.length,linked,unchanged,rejected,
  photoUrlsVerified:false,photoBytesDownloaded:0,privacyActivated:false},rejected?207:200);
}
