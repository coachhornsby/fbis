// Bounded read-only presentation of existing canonical research; no source calls.
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 const url=new URL(request.url),tour=url.searchParams.get('tour');
 const names=['home','away'].map(side=>url.searchParams.get(side)||'');
 if(!['atp','wta'].includes(tour)||names.some(n=>!n.trim()||n.length>120))return json({ok:false,reason:'TOUR_AND_PLAYER_NAMES_REQUIRED'},400);
 // Tennis canonical product authority remains PRIMARY while cutover is shadow.
 if(!env.DB?.prepare)return json({ok:false,reason:'CANONICAL_STORE_UNAVAILABLE'},503);
 try{
  const players=await Promise.all(names.map(async name=>{
   const found=(await env.DB.prepare('SELECT fbis_player_id,canonical_name,normalized_name,current_rank,official_source,official_effective_at,official_observed_at FROM tennis_players WHERE tour=? AND lower(canonical_name)=lower(?) LIMIT 2').bind(tour,name).all()).results||[];
   if(found.length!==1)return {name,state:found.length?'IDENTITY_AMBIGUOUS':'IDENTITY_UNMATCHED',profiles:[],recent:[]};
   const p=found[0];
   const [profiles,recent]=await Promise.all([
    env.DB.prepare('SELECT surface,profile_json,source_as_of,last_match_date,source,source_license FROM tennis_player_profiles_current WHERE tour=? AND player_key=? ORDER BY surface LIMIT 8').bind(tour,p.normalized_name).all(),
    env.DB.prepare('SELECT match_date,player1_key,player2_key,player1_name,player2_name,winner_key,score,tournament,surface FROM tennis_match_history WHERE tour=? AND (player1_key=? OR player2_key=?) ORDER BY match_date DESC LIMIT 5').bind(tour,p.normalized_name,p.normalized_name).all()]);
   return {name:p.canonical_name,canonicalId:p.fbis_player_id,state:'EXACT_CANONICAL_NAME_MATCH',rank:p.current_rank,
    identitySource:p.official_source,identityEffectiveAt:p.official_effective_at,identityObservedAt:p.official_observed_at,
    normalizedName:p.normalized_name,profiles:(profiles.results||[]).map(r=>{let stats={};try{stats=JSON.parse(r.profile_json||'{}');}catch{}
     return {surface:r.surface,matches:stats.surfaceMatches??null,servePointWin:stats.servePointWin??null,returnPointWin:stats.returnPointWin??null,
      source:r.source,sourceAsOf:r.source_as_of,lastMatchDate:r.last_match_date,license:r.source_license};}),recent:recent.results||[],availability:{state:'UNVERIFIED',withdrawal:null,retirement:null}};
  }));
  return json({ok:true,tour,checkedAt:new Date().toISOString(),home:players[0],away:players[1],researchOnly:true,
   sourceHealth:{sportscoreDirect:'NOT_ADMITTED_RELIABILITY_AND_ATTRIBUTION_GATES',sportscoreRapidApi:'MISSING_AUTHENTICATED_FREE_ENTITLEMENT'},canAuthorizeWager:false});
 }catch{return json({ok:false,reason:'TENNIS_RESEARCH_READ_FAILED'},503);}
}
