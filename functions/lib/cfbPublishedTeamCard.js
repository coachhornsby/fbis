/** Reads only persisted published versions. Missing publication stays visible. */
export async function loadPublishedCfbTeamCard(db,teamId,season,{asOf=null}={}){
 const missing={state:'NOT_PUBLISHED',card:null,version:null,publishedAt:null,canInfluenceProjection:false,canAuthorizeWager:false};
 if(asOf&&(!/(Z|[+-]\d\d:\d\d)$/.test(asOf)||!Number.isFinite(Date.parse(asOf))))throw Error('Invalid card cutoff');
 try{
  const query=asOf
   ?db.prepare('SELECT id,team_id,season,published_at,body_json FROM cfb_postgame_card_versions WHERE team_id=? AND season=? AND julianday(published_at)<=julianday(?) ORDER BY julianday(published_at) DESC,id DESC LIMIT 1').bind(teamId,Number(season),asOf)
   :db.prepare('SELECT v.id,v.team_id,v.season,v.published_at,v.body_json FROM cfb_postgame_card_current c JOIN cfb_postgame_card_versions v ON v.id=c.version_id WHERE c.team_id=? AND c.season=?').bind(teamId,Number(season));
  const row=await query.first();if(!row)return missing;
  const card=JSON.parse(row.body_json);
  if(card.team_id!==teamId||card.season!==Number(season)||!Number.isInteger(card.games)||card.games<0||!Number.isFinite(Date.parse(row.published_at)))return {...missing,state:'INVALID_PUBLICATION'};
  return {...missing,state:'PUBLISHED_VERSION',card,version:row.id,publishedAt:row.published_at};
 }catch{return {...missing,state:'PUBLICATION_STORAGE_UNAVAILABLE'};}
}
