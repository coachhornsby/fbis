function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "access-control-allow-origin":"*"
  }});
}
export async function onRequestGet({env}){
  if(!env?.DB?.prepare)return json({ok:false,error:"database unavailable",rows:[]},503);
  try{
    const res=await env.DB.prepare(`
      SELECT
        p.game_id AS event_id,
        p.player_id,
        p.player_name,
        p.team,
        p.market_type AS market,
        p.projection AS fbis_projection,
        p.sigma AS fbis_sigma,
        p.projected_minutes,
        p.availability_status,
        p.availability_verified,
        p.feature_cutoff_timestamp,
        p.model_id,
        p.model_version,
        g.tipoff_timestamp AS start_time,
        g.can_qualify AS game_can_qualify,
        p.can_qualify
      FROM nba_player_prop_projections p
      LEFT JOIN nba_game_projections g ON g.game_id=p.game_id
      WHERE p.can_qualify=1
        AND COALESCE(g.tipoff_timestamp,p.feature_cutoff_timestamp) >= datetime('now','-3 hours')
        AND COALESCE(g.tipoff_timestamp,p.feature_cutoff_timestamp) < datetime('now','+2 days')
      ORDER BY p.feature_cutoff_timestamp DESC
      LIMIT 1500
    `).all();
    const rows=(res?.results||[]).map(r=>({
      sport:"nba",
      eventId:String(r.event_id||""),
      playerId:r.player_id||null,
      playerName:r.player_name,
      team:r.team||null,
      start:r.start_time||null,
      market:r.market,
      fbisProjection:r.fbis_projection,
      fbisSigma:r.fbis_sigma,
      projectedMinutes:r.projected_minutes,
      availabilityStatus:r.availability_status||"UNKNOWN",
      availabilityVerified:Number(r.availability_verified||0)===1,
      modelId:r.model_id,
      modelVersion:r.model_version,
      canQualify:Number(r.can_qualify||0)===1,
      canAuthorize:false,
    }));
    return json({ok:true,rows,count:rows.length,source:"NBA_PROSPECTIVE_SHADOW_D1",canQualify:true,canAuthorize:false});
  }catch(err){
    return json({ok:false,error:String(err?.message||err),rows:[]},500);
  }
}
