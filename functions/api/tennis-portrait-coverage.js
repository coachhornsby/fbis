// Canonical ATP/WTA media coverage — distinguishes durable R2 image bytes
// from provider-owned image URLs. No betting/model authority.
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const isTour=t=>t==="atp"||t==="wta";
const approved=`a.approval_status='APPROVED' AND a.public_display_allowed=1
  AND a.display_scope='PUBLIC_WEB' AND a.rights_evidence_ref IS NOT NULL
  AND trim(a.rights_evidence_ref)<>'' AND julianday(a.approved_at)<=julianday('now')
  AND (a.expires_at IS NULL OR julianday(a.expires_at)>julianday('now'))`;
const linked=`p.official_headshot_url IS NOT NULL AND trim(p.official_headshot_url)<>''
  AND p.official_headshot_url LIKE 'https://%'
  AND lower(p.official_headshot_url) NOT LIKE '%/images/teams/%'
  AND lower(p.official_headshot_url) NOT LIKE '%/v2/team/%'`;
export async function onRequestGet({request,env}) {
 if(!env?.DB?.prepare)return json({ok:false,error:"DB_REQUIRED"},503);
 const params=new URL(request.url).searchParams,tour=String(params.get("tour")||"").toLowerCase();
 if(tour&&!isTour(tour))return json({ok:false,error:"INVALID_TOUR"},400);
 const limit=Math.max(0,Math.min(100,Math.floor(Number(params.get("limit")||0)||0)));
 try{
  const where=tour?"WHERE p.tour=?":"";
  const query=`SELECT p.tour AS tour,COUNT(*) AS players,
    SUM(CASE WHEN ${approved} THEN 1 ELSE 0 END) AS archived_approved,
    SUM(CASE WHEN NOT (${approved}) AND ${linked} THEN 1 ELSE 0 END) AS linked_external,
    SUM(CASE WHEN NOT (${approved}) AND NOT (${linked}) THEN 1 ELSE 0 END) AS missing,
    SUM(CASE WHEN p.active_state='RANKED_ACTIVE' THEN 1 ELSE 0 END) AS ranked_active
    FROM tennis_players p LEFT JOIN tennis_player_portraits a ON a.fbis_player_id=p.fbis_player_id
    ${where} GROUP BY p.tour ORDER BY p.tour`;
  const rows=(await env.DB.prepare(query).bind(...(tour?[tour]:[])).all()).results||[];
  let missing=[];
  if(limit){
   const filter=tour?"AND p.tour=?":"";
   const sql=`SELECT p.fbis_player_id AS playerId,p.tour,p.canonical_name AS name,
     p.current_rank AS rank,p.active_state AS activeState
     FROM tennis_players p LEFT JOIN tennis_player_portraits a ON a.fbis_player_id=p.fbis_player_id
     WHERE NOT (${approved}) AND NOT (${linked}) ${filter}
     ORDER BY CASE WHEN p.active_state='RANKED_ACTIVE' THEN 0 ELSE 1 END,
       CASE WHEN p.current_rank IS NULL THEN 1 ELSE 0 END,p.current_rank,p.canonical_name LIMIT ?`;
   missing=(await env.DB.prepare(sql).bind(...(tour?[tour]:[]),limit).all()).results||[];
  }
  return json({ok:true,generatedAt:new Date().toISOString(),byTour:rows,
    total:rows.reduce((a,x)=>({players:a.players+Number(x.players||0),
      archivedApproved:a.archivedApproved+Number(x.archived_approved||0),
      linkedExternal:a.linkedExternal+Number(x.linked_external||0),
      missing:a.missing+Number(x.missing||0)}),{players:0,archivedApproved:0,linkedExternal:0,missing:0}),
    missingPlayers:missing,policy:{archivedApproved:"rights-reviewed R2 image bytes",linkedExternal:"saved URL only; not an archived asset",missing:"no usable saved image"}});
 }catch{return json({ok:false,error:"PORTRAIT_COVERAGE_UNAVAILABLE"},503)}
}
