// Read-only permanent ATP/WTA player directory for Teams > Tennis.
// Source-of-truth is canonical tennis_players; only approved R2 portraits can
// be called archived, and external feed URL references retain their source label.
import { approvedTennisPortraits } from "../lib/tennisPortraits.js";
import { loadStoredTennisPrizePicksHeadshots } from "../lib/tennisPrizePicksHeadshots.js";
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const escapeLike=s=>s.replace(/[\\%_]/g,"\\$&");
export async function onRequestGet({request,env}){
 if(!env.DB?.prepare)return respond({ok:false,error:"DB_REQUIRED"},503);
 const p=new URL(request.url).searchParams;
 const tour=String(p.get("tour")||"wta").toLowerCase();
 if(!["atp","wta"].includes(tour))return respond({ok:false,error:"INVALID_TOUR"},400);
 const search=String(p.get("q")||"").trim().slice(0,64);
 const scope=p.get("scope")==="ranked"?"ranked":"all";
 const page=Math.min(200,Math.max(1,Math.floor(Number(p.get("page")||1)||1)));
 const pageSize=36;
 const predicates=["tour=?"],args=[tour];
 if(scope==="ranked"){predicates.push("current_rank IS NOT NULL");}
 if(search){predicates.push("(normalized_name LIKE ? ESCAPE '\\' OR lower(canonical_name) LIKE ? ESCAPE '\\')");args.push("%"+escapeLike(search.toLowerCase())+"%","%"+escapeLike(search.toLowerCase())+"%");}
 const where=predicates.join(" AND ");
 try{
  const [countResult,listResult]=await Promise.all([
   env.DB.prepare(`SELECT COUNT(*) AS total FROM tennis_players WHERE ${where}`).bind(...args).first(),
   env.DB.prepare(`SELECT fbis_player_id,tour,canonical_name,normalized_name,country_code,
       current_rank,ranking_points,active_state,official_source,official_observed_at,
       official_headshot_source FROM tennis_players WHERE ${where}
       ORDER BY CASE WHEN current_rank IS NULL THEN 1 ELSE 0 END,
       current_rank ASC,canonical_name COLLATE NOCASE ASC LIMIT ? OFFSET ?`)
    .bind(...args,pageSize,(page-1)*pageSize).all()
  ]);
  const records=listResult?.results||[];
  const ids=records.map(x=>x.fbis_player_id);
  const chunks=[];for(let i=0;i<ids.length;i+=20)chunks.push(ids.slice(i,i+20));
  const [approvedGroups,feed]=await Promise.all([
   Promise.all(chunks.map(ids=>approvedTennisPortraits(env.DB,ids))),
   loadStoredTennisPrizePicksHeadshots(env.DB,ids)
  ]);
  const approved=new Map(approvedGroups.flatMap(x=>[...x.entries()]));
  return respond({ok:true,tour,page,pageSize,total:Number(countResult?.total||0),
   pages:Math.ceil(Number(countResult?.total||0)/pageSize),search,scope,
   players:records.map(x=>{
     const portrait=approved.get(x.fbis_player_id),external=portrait?null:feed.get(x.fbis_player_id);
     return{playerId:x.fbis_player_id,tour:x.tour,name:x.canonical_name,countryCode:x.country_code||null,
       rank:x.current_rank,rankingPoints:x.ranking_points,activeState:x.active_state,
       identitySource:x.official_source,observedAt:x.official_observed_at,
       portraitUrl:portrait?.url||external?.url||null,
       portraitSource:portrait?"APPROVED_R2":external?"EXTERNAL_FEED":"MISSING",
       portraitCredit:portrait?.credit||null,
       portraitSourceUrl:portrait?.sourceUrl||null,
       profileUrl:"/api/tennis-player-profile?id="+encodeURIComponent(x.fbis_player_id)};
   }),note:"Read-only research directory. External image URLs are not licensed R2 assets."});
 }catch{return respond({ok:false,error:"TENNIS_DIRECTORY_UNAVAILABLE"},503);}
}
