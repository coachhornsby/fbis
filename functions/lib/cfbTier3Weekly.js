import { parseCsv } from "./cfbSdvIntelligence.js";

// Tier 3 subscriber CSV is proprietary. Keep it private, immutable, research-only.
// Do not infer an as-of date from "week" or a timezone from start_date.
const REQUIRED = ["id","start_date","season","season_type","week","neutral_site",
  "home_team","home_conference","away_team","away_conference","spread"];
const META = new Set(REQUIRED);
const FORBIDDEN_LABELS = new Set(["home_points","away_points","home_score","away_score",
  "home_win","away_win","winner","outcome","result","final_margin","closing_spread",
  "home_cover","away_cover","target"]);
export const CFB_TIER3_AUTHORITY = "research_only";
export async function sha256Hex(value) {
  const hash = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
export async function parseCfbTier3WeeklyCsv(raw, {receivedAt=new Date().toISOString(),filename="training_data.csv"}={}) {
  if(typeof raw!=="string"||!raw.trim()||new TextEncoder().encode(raw).length>2_000_000)
    throw Error("TIER3_CSV_INVALID_SIZE");
  const {columns,rows}=parseCsv(raw.replace(/^\uFEFF/,""));
  for(const name of REQUIRED)if(!columns.includes(name))throw Error("TIER3_MISSING_COLUMN:"+name);
  for(const name of columns)if(FORBIDDEN_LABELS.has(name))throw Error("TIER3_TARGET_LEAKAGE:"+name);
  if(rows.length<1||rows.length>200)throw Error("TIER3_INVALID_GAME_COUNT");
  const featureColumns=columns.filter(name=>!META.has(name));
  if(featureColumns.length<12)throw Error("TIER3_INSUFFICIENT_FEATURES");
  if(!Number.isFinite(Date.parse(receivedAt)))throw Error("TIER3_INVALID_RECEIVED_AT");
  const seasons=new Set(rows.map(r=>r.season));
  const weeks=new Set(rows.map(r=>r.week));
  if(seasons.size!==1||weeks.size!==1)throw Error("TIER3_MIXED_SNAPSHOT");
  const season=Number(rows[0].season),week=Number(rows[0].week);
  if(!Number.isInteger(season)||season<2000||season>2100||!Number.isInteger(week)||week<1||week>20)
    throw Error("TIER3_INVALID_SEASON_WEEK");
  const sourceSha256=await sha256Hex(raw);
  const snapshotId="cfbd-tier3:"+sourceSha256.slice(0,32);
  const seen=new Set(),games=[];
  for(const row of rows) {
    const id=String(row.id).trim();
    if(!/^\d{5,20}$/.test(id)||seen.has(id))throw Error("TIER3_BAD_OR_DUPLICATE_GAME_ID");
    seen.add(id);
    if(row.season_type!=="regular"&&row.season_type!=="postseason")
      throw Error("TIER3_UNKNOWN_SEASON_TYPE");
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.start_date))
      throw Error("TIER3_KICKOFF_TIMEZONE_UNSPECIFIED_FORMAT");
    if(!row.home_team?.trim()||!row.away_team?.trim()||
      row.home_team.trim().toLowerCase()===row.away_team.trim().toLowerCase())
      throw Error("TIER3_TEAM_IDENTITY_INVALID");
    if(!["True","False","true","false"].includes(row.neutral_site))
      throw Error("TIER3_NEUTRAL_SITE_INVALID");
    const openingSpread=Number(row.spread);
    if(!Number.isFinite(openingSpread))throw Error("TIER3_SPREAD_INVALID");
    const features={};
    for(const field of featureColumns){
      const v=row[field];
      if(v===""||v==null) {features[field]=null;continue;}
      const n=Number(v);
      if(!Number.isFinite(n))throw Error("TIER3_NON_NUMERIC_FEATURE:"+field);
      features[field]=n;
    }
    games.push({
      snapshotId,gameId:id,season,week,kickoffLiteral:row.start_date,
      homeTeam:row.home_team,awayTeam:row.away_team,
      homeConference:row.home_conference,awayConference:row.away_conference,
      neutralSite:/^true$/i.test(row.neutral_site)?1:0,
      openingSpread,features,rowSha256:await sha256Hex(columns.map(c=>row[c]??"").join("\u001f")),
      identityStatus:"pending_canonical_match",
      pointInTimeStatus:"source_feature_cutoff_unverified",
      authority:CFB_TIER3_AUTHORITY
    });
  }
  return {
    snapshotId,sourceSha256,season,week,receivedAt,
    filename:String(filename).split(/[\\/]/).pop().replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,100),
    featureColumns,columns,games,rowCount:games.length,featureCount:featureColumns.length,
    authority:CFB_TIER3_AUTHORITY,canAuthorizeWager:false,canInfluenceProjection:false,
    sourceFeatureCutoffVerified:false,providerPublishedAt:null
  };
}
export async function saveCfbTier3WeeklySnapshot(env,snapshot,raw) {
  if(!env?.TIER3_DB?.prepare||!env?.TIER3_DB?.batch||!env?.ARCHIVE?.put)
    return {ok:false,reason:"TIER3_PRIVATE_STORAGE_REQUIRED"};
  const key=`licensed/cfbd/tier3/${snapshot.season}/week-${String(snapshot.week).padStart(2,"0")}/${snapshot.sourceSha256}.csv`;
  // Private archive is written before D1 index; no public URL or raw payload in response.
  await env.ARCHIVE.put(key,raw,{httpMetadata:{contentType:"text/csv"},
    customMetadata:{source:"cfbd-tier3-weekly",sha256:snapshot.sourceSha256}});
  const statements=[
    env.TIER3_DB.prepare(`INSERT OR IGNORE INTO cfb_tier3_training_snapshots
      (snapshot_id,source_sha256,season,week,source_filename,received_at,raw_r2_key,
       row_count,feature_count,schema_columns_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(snapshot.snapshotId,snapshot.sourceSha256,snapshot.season,snapshot.week,
        snapshot.filename,snapshot.receivedAt,key,snapshot.rowCount,snapshot.featureCount,JSON.stringify(snapshot.columns))
  ];
  for(const row of snapshot.games){
    statements.push(env.TIER3_DB.prepare(`INSERT OR IGNORE INTO cfb_tier3_training_games
      (snapshot_id,game_id,season,week,kickoff_literal,home_team_source,
       away_team_source,home_conference_source,away_conference_source,neutral_site,
       opening_spread,features_json,row_sha256,identity_status,point_in_time_status,authority)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(row.snapshotId,row.gameId,row.season,row.week,row.kickoffLiteral,
        row.homeTeam,row.awayTeam,row.homeConference,row.awayConference,row.neutralSite,
        row.openingSpread,JSON.stringify(row.features),row.rowSha256,
        row.identityStatus,row.pointInTimeStatus,row.authority));
  }
  await env.TIER3_DB.batch(statements);
  return {ok:true,snapshotId:snapshot.snapshotId,sourceSha256:snapshot.sourceSha256,
    season:snapshot.season,week:snapshot.week,rows:snapshot.rowCount,
    features:snapshot.featureCount,authority:CFB_TIER3_AUTHORITY,networkCalls:0,
    canAuthorizeWager:false,canInfluenceProjection:false};
}
