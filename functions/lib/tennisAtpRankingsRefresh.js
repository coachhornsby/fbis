import {fetchEspnTennisRankings} from "./tennisPrizePicksResearch.js";
const key=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

/** Source-labeled supplement, never an ATP_OFFICIAL identity or ATP schedule.
 * Only stable, unique known player identities are eligible for updates.
 */
export async function refreshAtpPlayerResearch(db,archive,{now=new Date(),fetchImpl=fetch}={}){
 if(!db?.prepare||!db?.batch)throw Error("ATP_RANKINGS_DATABASE_UNAVAILABLE");
 const feed=await fetchEspnTennisRankings(fetchImpl);
 const rows=feed.rows.filter(r=>r.tour==="atp"&&Number.isInteger(r.rank)&&r.rank>0&&
   r.rank<=3000&&Number.isFinite(r.points)&&r.points>=0);
 if(rows.length<20)throw Error("ATP_RANKINGS_SOURCE_INSUFFICIENT");
 const observed=now.toISOString(),day=observed.slice(0,10);
 const unique=new Map(rows.map(r=>[key(r.name),r]));
 const names=[...unique.keys()].filter(Boolean);
 const directory=[];
 for(let i=0;i<names.length;i+=45){
  const chunk=names.slice(i,i+45);
  const q=await db.prepare(`SELECT fbis_player_id,normalized_name,official_source FROM tennis_players
   WHERE tour='atp' AND normalized_name IN (${chunk.map(()=>"?").join(",")})`).bind(...chunk).all();
  directory.push(...q.results||[]);
 }
 const byName=new Map();
 for(const player of directory){
  const k=player.normalized_name;
  if(!byName.has(k))byName.set(k,[]);
  byName.get(k).push(player);
 }
 const commands=[],written=[];
 for(const [name,r] of unique){
  const found=byName.get(name)||[];
  if(found.length!==1||found[0].official_source==="ATP_OFFICIAL")continue;
  const id=found[0].fbis_player_id;
  const provenance=JSON.stringify({endpoint:"site.api.espn.com/apis/site/v2/sports/tennis/atp/rankings",
    rankingDateMeaning:"observation_date_not_official_effective_date",
    observedAt:observed,sourcePlayerId:r.espnId,canAuthorizeWager:false});
  commands.push(db.prepare(`INSERT OR IGNORE INTO tennis_ranking_observations
    (observation_id,fbis_player_id,tour,ranking_date,singles_rank,points,source,
     source_player_id,observed_at,ingested_at,provenance_json,source_priority)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind("espn_atp_"+day+"_"+id,id,"atp",day,r.rank,r.points,"ESPN_TENNIS_RANKINGS",
     r.espnId,observed,observed,provenance,20));
  commands.push(db.prepare(`UPDATE tennis_players
    SET current_rank=?,ranking_points=?,country_code=COALESCE(country_code,?),
        updated_at=?
    WHERE fbis_player_id=? AND tour='atp' AND official_source<>'ATP_OFFICIAL'`)
   .bind(r.rank,r.points,r.country||null,observed,id));
  written.push({fbisPlayerId:id,name:r.name,rank:r.rank,points:r.points,country:r.country,espnId:r.espnId});
 }
 for(let i=0;i<commands.length;i+=50)await db.batch(commands.slice(i,i+50));
 const receipt={source:"ESPN_TENNIS_RANKINGS",tour:"atp",observedAt:observed,
  feedCount:rows.length,canonicalUpdated:written.length,ambiguousOrUnmatched:unique.size-written.length,
  players:written,officialSourcePromoted:false,canAuthorizeWager:false};
 if(archive?.put){
  const path="tennis/rankings/espn-atp/"+day+"/"+observed.replace(/[:.]/g,"-")+".json";
  await archive.put(path,JSON.stringify(receipt),{httpMetadata:{contentType:"application/json"}});
 }
 return {ok:true,source:receipt.source,observedAt:observed,feedCount:rows.length,
   canonicalUpdated:written.length,unmatched:receipt.ambiguousOrUnmatched,
   officialSourcePromoted:false,canAuthorizeWager:false};
}
