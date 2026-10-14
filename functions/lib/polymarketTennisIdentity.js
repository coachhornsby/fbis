/** Verified, source-backed tennis event candidates for Polymarket identity linking.
 * A snapshot of an Action market is NOT a verified tennis schedule.
 * No source-local Polymarket identifier is ever treated as canonical.
 */
export async function loadVerifiedTennisCandidates(db,starts=[],{
 asOf=new Date().toISOString(),
 includeCompleted=false,
}={}){
 if(!db?.prepare)return [];
 const times=(starts||[]).map(x=>Date.parse(x||"")).filter(Number.isFinite);
 if(!times.length)return [];
 if(!Number.isFinite(Date.parse(asOf)))return [];
 const from=new Date(Math.min(...times)-2*3600000).toISOString();
 const until=new Date(Math.max(...times)+2*3600000).toISOString();
 // True official matches take precedence over independent ESPN research
 // identities when both exist. Neither source is inferred from market prices.
 // includeCompleted is research-rematch only: never invents prices or clocks.
 const espnStatus=includeCompleted
  ?"f.status IN ('SCHEDULED','IN_PROGRESS','FINAL','COMPLETED','STATUS_FINAL','STATUS_FULL_TIME')"
  :"f.status IN ('SCHEDULED','IN_PROGRESS')";
 const result=await db.prepare(`
  SELECT m.match_id AS id,m.match_time AS start,m.tour AS tour,
         p1.canonical_name AS away_name,p2.canonical_name AS home_name,
         'tennis' AS sport,m.source AS fixture_source
  FROM tennis_official_matches m
  JOIN tennis_players p1 ON m.player1_id=p1.fbis_player_id
  JOIN tennis_players p2 ON m.player2_id=p2.fbis_player_id
  WHERE m.source IN ('ATP_OFFICIAL','WTA_OFFICIAL')
    AND m.match_time BETWEEN ?1 AND ?2
    AND m.player1_id IS NOT NULL AND m.player2_id IS NOT NULL
    AND m.player1_id<>m.player2_id
    AND lower(m.tour)=lower(p1.tour) AND lower(m.tour)=lower(p2.tour)
    AND julianday(m.observed_at)<=julianday(?4)
  UNION ALL
  SELECT f.fixture_id AS id,f.match_time AS start,f.tour,
         f.player1_name AS away_name,f.player2_name AS home_name,
         'tennis' AS sport,'ESPN_PUBLIC' AS fixture_source
  FROM tennis_external_fixtures f
  WHERE f.source='ESPN_PUBLIC' AND ${espnStatus}
    AND f.match_time BETWEEN ?1 AND ?2 AND f.fetched_at>=?3
    AND julianday(f.fetched_at)<=julianday(?4)
  ORDER BY start,id
 `).bind(from,until,new Date(Date.parse(asOf)-18*3600000).toISOString(),asOf).all();
 const rows=(result?.results||[]).filter(x=>x.id&&x.start&&x.away_name&&x.home_name);
 // Do not let a duplicate provider listing produce ambiguous canonical IDs.
 const key=x=>[String(x.tour).toLowerCase(),[x.away_name,x.home_name].map(v=>String(v).normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()).sort().join("|"),
  Math.floor(Date.parse(x.start)/(5*60000))].join(":");
 const by=new Map();
 for(const x of rows){
  const k=key(x),prior=by.get(k);
  if(!prior||x.fixture_source!=="ESPN_PUBLIC"&&prior.fixture_source==="ESPN_PUBLIC")by.set(k,x);
 }
 return [...by.values()];
}
