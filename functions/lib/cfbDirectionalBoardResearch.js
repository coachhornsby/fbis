/**
 * Private CFBD Tier 3 -> public, derived-only CFB directional comparison.
 * The operator's licensed weekly features remain exclusively in TIER3_DB/R2.
 * This is research display, NOT a training/serving-model or betting path.
 */
const finite = v => v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const time = v => {const n=Date.parse(String(v||""));return Number.isFinite(n)?n:null;};
const round = n => Math.round(n*1000)/1000;
export const DIRECTIONAL_PAIRS = [
 {id:"away-run-defense",kind:"rush",off:"home",def:"away"},
 {id:"away-run-offense",kind:"rush",off:"away",def:"home"},
 {id:"away-pass-defense",kind:"pass",off:"home",def:"away"},
 {id:"away-pass-offense",kind:"pass",off:"away",def:"home"},
];
function difference(record,pair) {
 const p=pair.kind==="pass"?"Pass":"Rush";
 const a=finite(record?.[pair.off+p+"Off"]),b=finite(record?.[pair.def+p+"Def"]);
 return a==null||b==null?null:round(a-b);
}
const tilt=d=>d==null?null:d>=.05?"OFFENSE":d<=-.05?"DEFENSE":"BALANCED";
export function buildCfbDirectionalBoardMap(games=[],cfbdRows=[],sdvRows=[],{now=new Date().toISOString()}={}) {
 const nowMs=time(now)??Date.now(),byGameId={};
 for(const game of games) {
  if(game?.sport!=="cfb"||!(/^\d{5,20}$/).test(String(game.id||"")))continue;
  const start=time(game.start);
  if(start==null)continue;
  const season=new Date(start).getUTCFullYear();
  // Never equate receipt-before-kickoff with proof of a provider's original
  // advanced-feature freeze or publication time.
  const cfbd=cfbdRows.filter(r=>String(r.game_id)===String(game.id)&&
   Number(r.season)===season && Number(r.season)===Number(r.snapshot_season)&&
   Number(r.week)===Number(r.snapshot_week)&&r.identity_status==="matched_unique_active_fbs"&&
   r.authority==="research_only"&&r.snapshot_status==="research_only"&&
   Number(r.can_influence_projection)===0&&Number(r.can_authorize_wager)===0&&
   time(r.received_at)!=null&&time(r.received_at)<start&&time(r.received_at)<=nowMs+60_000)
   .sort((a,b)=>String(b.received_at).localeCompare(String(a.received_at)))[0]||null;
  const sdv=sdvRows.filter(r=>String(r.game_id)===String(game.id)&&Number(r.season)===season&&
    r.source_version==="cfb-sdv-source-observed-research-v1"&&time(r.feature_as_of_timestamp)!=null&&
    time(r.feature_as_of_timestamp)<start&&time(r.feature_as_of_timestamp)<=nowMs+60_000&&
    time(r.collection_timestamp)!=null&&time(r.collection_timestamp)<start)
   .sort((a,b)=>String(b.feature_as_of_timestamp).localeCompare(String(a.feature_as_of_timestamp)))[0]||null;
  if(!cfbd&&!sdv)continue;
  const rows=DIRECTIONAL_PAIRS.map(spec=>{
   const a=cfbd?difference(cfbd,spec):null,b=sdv?difference(sdv,spec):null;
   const c=tilt(a),s=tilt(b);
   return {id:spec.id,kind:spec.kind,off:spec.off,
    cfbdDifference:a,sdvDifference:b,cfbdTilt:c,sdvTilt:s,
    disagreement:Boolean(c&&s&&c!=="BALANCED"&&s!=="BALANCED"&&c!==s),
    note:c==="BALANCED"&&s!=="BALANCED"?"CFBD NEAR EVEN":null};
  });
  byGameId[String(game.id)]={
   source:cfbd?"CFBD_TIER3_WEEKLY": "SDV_2026_SEASON",
   season,week:cfbd?Number(cfbd.week):null,
   cfbd:cfbd?{available:rows.filter(r=>r.cfbdDifference!=null).length,receivedAt:cfbd.received_at,
    sourceCutoffVerified:false}:null,
   sdv:sdv?{available:rows.filter(r=>r.sdvDifference!=null).length,
    homeGames:finite(sdv.homeGames),awayGames:finite(sdv.awayGames),
    observedAt:sdv.feature_as_of_timestamp}:null,
   rows,disagreements:rows.filter(r=>r.disagreement).length,
   provenance:"READ_ONLY_DERIVED_DIFFERENCES",
   sourceCutoffVerified:false,authority:"RESEARCH_DISPLAY_ONLY",
   projectionInputsChanged:false,canQualify:false,canAuthorizeWager:false};
 }
 return {byGameId,cfbdGames:Object.values(byGameId).filter(v=>v.cfbd).length,
  sdvGames:Object.values(byGameId).filter(v=>v.sdv).length,networkCalls:0};
}
const sqlCfbd=n=>`SELECT g.game_id,g.season,g.week,g.identity_status,g.authority,
 s.season snapshot_season,s.week snapshot_week,s.status snapshot_status,
 s.can_influence_projection,s.can_authorize_wager,s.received_at,
 json_extract(g.features_json,'$.home_adjusted_passing_epa') homePassOff,
 json_extract(g.features_json,'$.home_adjusted_passing_epa_allowed') homePassDef,
 json_extract(g.features_json,'$.away_adjusted_passing_epa') awayPassOff,
 json_extract(g.features_json,'$.away_adjusted_passing_epa_allowed') awayPassDef,
 json_extract(g.features_json,'$.home_adjusted_rushing_epa') homeRushOff,
 json_extract(g.features_json,'$.home_adjusted_rushing_epa_allowed') homeRushDef,
 json_extract(g.features_json,'$.away_adjusted_rushing_epa') awayRushOff,
 json_extract(g.features_json,'$.away_adjusted_rushing_epa_allowed') awayRushDef
 FROM cfb_tier3_training_games g JOIN cfb_tier3_training_snapshots s USING(snapshot_id)
 WHERE g.game_id IN (${Array(n).fill("?").join(",")})
 ORDER BY s.received_at DESC LIMIT 500`;
const sqlSdv=n=>`SELECT game_id,season,source_version,feature_as_of_timestamp,collection_timestamp,
 json_extract(features_json,'$.home.gamesPlayed') homeGames,
 json_extract(features_json,'$.away.gamesPlayed') awayGames,
 json_extract(features_json,'$.home.passEpa') homePassOff,
 json_extract(features_json,'$.home.passEpaAllowed') homePassDef,
 json_extract(features_json,'$.away.passEpa') awayPassOff,
 json_extract(features_json,'$.away.passEpaAllowed') awayPassDef,
 json_extract(features_json,'$.home.rushEpa') homeRushOff,
 json_extract(features_json,'$.home.rushEpaAllowed') homeRushDef,
 json_extract(features_json,'$.away.rushEpa') awayRushOff,
 json_extract(features_json,'$.away.rushEpaAllowed') awayRushDef
 FROM cfb_pregame_feature_vectors
 WHERE game_id IN (${Array(n).fill("?").join(",")})
 AND source_version='cfb-sdv-source-observed-research-v1'
 ORDER BY feature_as_of_timestamp DESC LIMIT 500`;
const query=async(db,sql,ids)=>{
 if(!ids.length)return {rows:[],state:"NO_EVENTS"};
 if(!db?.prepare)return {rows:[],state:"DB_BINDING_MISSING"};
 try {
   const q=await db.prepare(sql).bind(...ids).all();
   return {rows:Array.isArray(q?.results)?q.results:[],state:"READ_OK"};
 } catch {
   // No SQL, private table schema, or licensed source fields leave the backend.
   return {rows:[],state:"READ_FAILED"};
 }
};
export async function loadCfbDirectionalBoardResearch(env={},games=[],opts={}) {
 const selected=(games||[]).filter(g=>g?.sport==="cfb"),ids=[...new Set(selected.map(g=>String(g.id||"")).filter(v=>(/^\d{5,20}$/).test(v)))].slice(0,100);
 if(!ids.length)return {byGameId:{},cfbdGames:0,sdvGames:0,networkCalls:0,
  sourceHealth:{cfbd:"NO_EVENTS",sdv:"NO_EVENTS"},coverage:{games:0,cfbd:0,sdv:0,disagreements:0}};
 const [cfbd,sdv]=await Promise.all([
  query(env.TIER3_DB,sqlCfbd(ids.length),ids),
  query(env.DB,sqlSdv(ids.length),ids)
 ]);
 const derived=buildCfbDirectionalBoardMap(selected,cfbd.rows,sdv.rows,opts);
 const coverage={games:ids.length,cfbd:derived.cfbdGames,sdv:derived.sdvGames,
  disagreements:Object.values(derived.byGameId).reduce((n,g)=>n+(g.disagreements||0),0)};
 return {...derived,coverage,sourceHealth:{
   cfbd:cfbd.state!=="READ_OK"?cfbd.state:derived.cfbdGames?"MATCHED":"NO_ELIGIBLE_MATCH",
   sdv:sdv.state!=="READ_OK"?sdv.state:derived.sdvGames?"MATCHED":"NO_ELIGIBLE_MATCH",
 },networkCalls:0};
}