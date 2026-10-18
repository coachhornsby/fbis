/** Persist PrizePicks tennis feed headshots onto canonical player cards.
 * Rights-approved R2 portraits still win on the board; this only fills the
 * player-card image slots from the same PP CDN URLs already shown on props.
 * Never overwrites an ATP/WTA official headshot source.
 */
const KEY=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
export function isPrizePicksTennisHeadshot(url){
 const u=String(url||"").trim();
 return /^https:\/\//i.test(u)&&!/\/images\/teams\//i.test(u);
}
function tourOf(league,raw={}){
 const token=String(league||raw.league||raw.leagueName||"").toLowerCase();
 if(/\bwta\b/.test(token))return "wta";
 if(/\batp\b/.test(token))return "atp";
 return null;
}
/** Latest unique PP headshot per tour+player name from a run or recent window. */
export async function loadPrizePicksTennisHeadshotCandidates(db,{runId=null,lookbackHours=72}={}){
 if(!db?.prepare)return [];
 const q=runId
  ? await db.prepare(`SELECT player_name,player_headshot_url,league,collected_at,raw_json
      FROM prizepicks_prop_lines WHERE run_id=? AND lower(sport)='tennis'
      AND player_headshot_url IS NOT NULL AND trim(player_headshot_url)<>''
      ORDER BY collected_at DESC`).bind(runId).all()
  : await db.prepare(`SELECT player_name,player_headshot_url,league,collected_at,raw_json
      FROM prizepicks_prop_lines WHERE lower(sport)='tennis'
      AND player_headshot_url IS NOT NULL AND trim(player_headshot_url)<>''
      AND julianday(collected_at)>=julianday('now',?)
      ORDER BY collected_at DESC`).bind(`-${Math.max(1,Number(lookbackHours)||72)} hours`).all();
 const by=new Map();
 for(const row of q?.results||[]){
  const name=KEY(row.player_name);
  if(!name||!isPrizePicksTennisHeadshot(row.player_headshot_url))continue;
  let raw={};try{raw=typeof row.raw_json==="string"?JSON.parse(row.raw_json):row.raw_json||{};}catch{raw={};}
  const tour=tourOf(row.league,raw);
  const key=`${tour||"*"}|${name}`;
  if(!by.has(key))by.set(key,{name:row.player_name,normalized:name,tour,url:String(row.player_headshot_url).trim(),collectedAt:row.collected_at});
 }
 return [...by.values()];
}
export async function persistTennisPrizePicksHeadshots(db,opts={}){
 if(!db?.prepare)return {ok:false,updated:0,matched:0,reason:"DB_REQUIRED"};
 const candidates=await loadPrizePicksTennisHeadshotCandidates(db,opts);
 let matched=0,updated=0;
 const now=new Date().toISOString();
 for(const c of candidates){
  const tours=c.tour?[c.tour]:["atp","wta"];
  for(const tour of tours){
   const found=await db.prepare(`SELECT fbis_player_id,official_headshot_url,official_headshot_source
     FROM tennis_players WHERE tour=? AND normalized_name=? LIMIT 2`).bind(tour,c.normalized).all();
   const rows=found?.results||[];
   if(rows.length!==1)continue;
   matched++;
   const row=rows[0];
   const source=String(row.official_headshot_source||"");
   const canWrite=!row.official_headshot_url||source==="PRIZEPICKS_FEED"||source==="";
   if(canWrite&&row.official_headshot_url!==c.url){
    await db.prepare(`UPDATE tennis_players SET official_headshot_url=?,official_headshot_source='PRIZEPICKS_FEED',updated_at=?
      WHERE fbis_player_id=?`).bind(c.url,now,row.fbis_player_id).run();
    updated++;
   }
   await db.prepare(`UPDATE tennis_player_bank SET headshot_url=?,updated_at=?
     WHERE tour=? AND player_key=? AND (headshot_url IS NULL OR headshot_url='' OR headshot_url<>?)`)
    .bind(c.url,now,tour,c.normalized,c.url).run().catch(()=>{});
  }
 }
 return {ok:true,candidates:candidates.length,matched,updated,source:"PRIZEPICKS_FEED",canAuthorizeWager:false};
}
/** Card display: only PrizePicks-sourced URLs stored on the canonical player card. */
export async function loadStoredTennisPrizePicksHeadshots(db,playerIds=[]){
 const ids=[...new Set((playerIds||[]).map(String).filter(Boolean))].slice(0,40);
 const out=new Map();
 if(!db?.prepare||!ids.length)return out;
 try{
  const ph=ids.map(()=>"?").join(",");
  const r=await db.prepare(`SELECT fbis_player_id,official_headshot_url,official_headshot_source
    FROM tennis_players WHERE fbis_player_id IN (${ph})`).bind(...ids).all();
  for(const row of r?.results||[]){
   if(row.official_headshot_source==="PRIZEPICKS_FEED"&&isPrizePicksTennisHeadshot(row.official_headshot_url))
    out.set(String(row.fbis_player_id),{url:String(row.official_headshot_url).trim(),imageSource:"PRIZEPICKS_FEED"});
  }
 }catch{/* fail closed */}
 return out;
}
