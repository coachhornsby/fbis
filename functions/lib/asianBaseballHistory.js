import { parseNpbScheduleMonth } from "./npbFbisV1.js";

export const ASIAN_BASEBALL_HISTORY_PARSER_VERSION="phase2-v1.0.0";

const KBO_CANON={
  LG:"kbo-lg",HANWHA:"kbo-han",SSG:"kbo-ssg",SAMSUNG:"kbo-sam",NC:"kbo-nc",
  KT:"kbo-kt",LOTTE:"kbo-lot",KIA:"kbo-kia",DOOSAN:"kbo-doo",KIWOOM:"kbo-kiw"
};
const NPB_CANON={
  HAN:"npb-ht",DEN:"npb-ydb",YOM:"npb-yg",CHU:"npb-cd",HIR:"npb-hc",YAK:"npb-tys",
  SBH:"npb-fsh",HAM:"npb-hnf",ORI:"npb-ob",RAK:"npb-tre",SEI:"npb-ssl",LOT:"npb-clm"
};
const KBO_TEAM_RE="(LG|HANWHA|SSG|SAMSUNG|NC|KT|LOTTE|KIA|DOOSAN|KIWOOM)";
const KBO_VENUES=["JAMSIL","DAEGU","SUWON","GWANGJU","MUNHAK","SAJIK","CHANGWON","DAEJEON","GOCHEOKSKY","GOCHEOK"];

function htmlText(s=""){return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim();}
function isoKst(date,time="18:30"){const [y,m,d]=date.split("-").map(Number);const [hh,mm]=time.split(":").map(Number);return new Date(Date.UTC(y,m-1,d,hh-9,mm)).toISOString();}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function pad(n){return String(n).padStart(2,"0");}
function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate();}
export function monthBounds(year,month){const last=daysInMonth(year,month);return {start:`${year}-${pad(month)}-01`,end:`${year}-${pad(month)}-${pad(last)}`,days:last};}
export function nextDate(date){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function relationToStart(start,observedAt){const a=Date.parse(start||""),b=Date.parse(observedAt||"");if(!Number.isFinite(a)||!Number.isFinite(b))return"UNKNOWN";return b<a?"PRE_START":"AT_OR_AFTER_START";}

export function parseKboHistoricalScoreboard(html="",date=""){
  const text=htmlText(html);
  const re=new RegExp(`\\b${KBO_TEAM_RE}\\s+(\\d{1,2})\\s+FINAL\\s+(\\d{1,2})\\s+${KBO_TEAM_RE}\\b`,"g");
  const out=[]; let m;
  while((m=re.exec(text))){
    const away=m[1],awayRuns=finite(m[2]),homeRuns=finite(m[3]),home=m[4];
    if(!KBO_CANON[away]||!KBO_CANON[home]||awayRuns==null||homeRuns==null)continue;
    const tail=text.slice(m.index+m[0].length,m.index+m[0].length+180);
    const venue=KBO_VENUES.find(v=>new RegExp(`\\b${v}\\b`,"i").test(tail))||null;
    const time=(tail.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)||[])[0]||"18:30";
    out.push({
      league:"KBO",season:Number(date.slice(0,4)),sourceGameId:null,gameDate:date,scheduledStart:isoKst(date,time),
      homeTeamId:KBO_CANON[home],awayTeamId:KBO_CANON[away],homeAbbr:home,awayAbbr:away,venue,
      status:"FINAL",homeFinalRuns:homeRuns,awayFinalRuns:awayRuns,
      sourceContract:"KBO_OFFICIAL_ENGLISH_SCOREBOARD_V1",
      sourceRef:`https://eng.koreabaseball.com/Schedule/Scoreboard.aspx?searchDate=${date}`
    });
  }
  return dedupeGames(out);
}

export function parseNpbHistoricalMonth(html="",year,month){
  const bounds=monthBounds(year,month),all=[];
  for(let d=1;d<=bounds.days;d++){
    const date=`${year}-${pad(month)}-${pad(d)}`;
    for(const g of parseNpbScheduleMonth(html,date)){
      if(!g?.status?.completed||g.home?.score==null||g.away?.score==null)continue;
      const homeTeamId=NPB_CANON[g.home.abbr],awayTeamId=NPB_CANON[g.away.abbr];
      if(!homeTeamId||!awayTeamId)continue;
      all.push({
        league:"NPB",season:year,sourceGameId:null,gameDate:date,scheduledStart:g.start||null,
        homeTeamId,awayTeamId,homeAbbr:g.home.abbr,awayAbbr:g.away.abbr,venue:g.venue||null,
        status:"FINAL",homeFinalRuns:finite(g.home.score),awayFinalRuns:finite(g.away.score),
        sourceContract:"NPB_OFFICIAL_MONTH_DETAIL_V1",
        sourceRef:`https://npb.jp/games/${year}/schedule_${pad(month)}_detail.html`
      });
    }
  }
  return dedupeGames(all);
}

export function canonicalGameId(g){
  return `${String(g.league).toUpperCase()}-${String(g.gameDate).replaceAll("-","")}-${g.awayTeamId}-${g.homeTeamId}`;
}
export function dedupeGames(games=[]){
  const seen=new Set(),out=[];
  for(const g of games){const id=canonicalGameId(g);if(seen.has(id))continue;seen.add(id);out.push({...g,canonicalGameId:id});}
  return out;
}
export function temporalObservation(game,{observedAt,fetchedAt=observedAt,payload=null}={}){
  const rel=relationToStart(game.scheduledStart,observedAt);
  return {
    id:`${game.canonicalGameId}:FINAL_RESULT`,
    canonicalGameId:game.canonicalGameId,league:game.league,observationType:"FINAL_RESULT",
    relationToStart:rel,observedAt,fetchedAt,sourceContract:game.sourceContract,sourceRef:game.sourceRef,
    parserVersion:ASIAN_BASEBALL_HISTORY_PARSER_VERSION,payload,pregameEligible:0
  };
}
export async function persistHistoricalGames(env,games=[],{observedAt=new Date().toISOString(),fetchedAt=observedAt}={}){
  const db=env?.DB;if(!db?.prepare)return{ok:false,reason:"d1-unbound",persisted:0,duplicates:0};
  let persisted=0,duplicates=0;
  for(const raw of dedupeGames(games)){
    const g={...raw,canonicalGameId:raw.canonicalGameId||canonicalGameId(raw)};
    const prior=await db.prepare("SELECT canonical_game_id FROM asian_baseball_games WHERE canonical_game_id=?").bind(g.canonicalGameId).first();
    if(prior)duplicates++;
    const now=new Date().toISOString();
    await db.prepare(`INSERT INTO asian_baseball_games(
      canonical_game_id,league,season,source_game_id,game_date,scheduled_start,home_team_id,away_team_id,venue,game_status,
      home_final_runs,away_final_runs,innings_status_json,source_contract,source_ref,result_observed_at,first_fetched_at,last_fetched_at,
      parser_version,is_final,research_only,can_qualify,can_authorize,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0,?,?)
    ON CONFLICT(canonical_game_id) DO UPDATE SET
      source_game_id=COALESCE(excluded.source_game_id,asian_baseball_games.source_game_id),
      scheduled_start=COALESCE(excluded.scheduled_start,asian_baseball_games.scheduled_start),
      venue=COALESCE(excluded.venue,asian_baseball_games.venue),game_status=excluded.game_status,
      home_final_runs=COALESCE(excluded.home_final_runs,asian_baseball_games.home_final_runs),
      away_final_runs=COALESCE(excluded.away_final_runs,asian_baseball_games.away_final_runs),
      result_observed_at=COALESCE(asian_baseball_games.result_observed_at,excluded.result_observed_at),
      last_fetched_at=excluded.last_fetched_at,parser_version=excluded.parser_version,is_final=excluded.is_final,updated_at=excluded.updated_at`)
      .bind(g.canonicalGameId,g.league,g.season,g.sourceGameId||null,g.gameDate,g.scheduledStart||null,g.homeTeamId,g.awayTeamId,g.venue||null,g.status||"FINAL",
        g.homeFinalRuns,g.awayFinalRuns,g.inningsStatusJson?JSON.stringify(g.inningsStatusJson):null,g.sourceContract,g.sourceRef,observedAt,fetchedAt,fetchedAt,
        ASIAN_BASEBALL_HISTORY_PARSER_VERSION,1,now,now).run();
    const o=temporalObservation(g,{observedAt,fetchedAt,payload:{status:g.status,homeFinalRuns:g.homeFinalRuns,awayFinalRuns:g.awayFinalRuns,venue:g.venue}});
    await db.prepare(`INSERT INTO asian_baseball_game_observations(
      id,canonical_game_id,league,observation_type,relation_to_start,observed_at,fetched_at,source_contract,source_ref,parser_version,payload_json,
      research_only,pregame_eligible,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,0,?,?)
    ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .bind(o.id,o.canonicalGameId,o.league,o.observationType,o.relationToStart,o.observedAt,o.fetchedAt,o.sourceContract,o.sourceRef,o.parserVersion,JSON.stringify(o.payload),now,now).run();
    persisted++;
  }
  return{ok:true,persisted,duplicates};
}

async function fetchText(url,fetcher=fetch){
  const r=await fetcher(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; FBIS-History/2.0)","accept":"text/html,*/*"}});
  if(!r.ok)throw new Error(`HTTP_${r.status}`);
  return r.text();
}
async function shardRow(db,id){return db.prepare("SELECT * FROM asian_baseball_backfill_shards WHERE id=?").bind(id).first();}
async function upsertShard(db,{id,league,season,month,start,end,maxRequests,sourceContract,status="PENDING"}){
  const now=new Date().toISOString();
  await db.prepare(`INSERT INTO asian_baseball_backfill_shards(
    id,league,season,month,start_date,end_date,cursor_date,max_requests,status,attempts,requests_used,games_discovered,games_persisted,
    malformed_rows,duplicate_rows,source_contract,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,0,0,0,0,0,0,?,?,?)
  ON CONFLICT(id) DO UPDATE SET max_requests=excluded.max_requests,updated_at=excluded.updated_at`)
  .bind(id,league,season,month,start,end,start,maxRequests,status,sourceContract,now,now).run();
}

export async function runAsianBaseballHistoricalShard(env,{league,season,month,maxRequests=7,fetcher=fetch}={}){
  const L=String(league||"").toUpperCase(),y=Number(season),m=Number(month),cap=Math.max(1,Math.min(31,Number(maxRequests)||7));
  if(!["KBO","NPB"].includes(L)||!Number.isInteger(y)||!Number.isInteger(m)||m<1||m>12)return{ok:false,error:"invalid-shard"};
  const db=env?.DB;if(!db?.prepare)return{ok:false,error:"d1-unbound"};
  const b=monthBounds(y,m),id=`${L.toLowerCase()}:${y}-${pad(m)}`,sourceContract=L==="KBO"?"KBO_OFFICIAL_ENGLISH_SCOREBOARD_V1":"NPB_OFFICIAL_MONTH_DETAIL_V1";
  await upsertShard(db,{id,league:L,season:y,month:m,start:b.start,end:b.end,maxRequests:cap,sourceContract});
  let row=await shardRow(db,id); if(row?.status==="DONE")return{ok:true,id,status:"DONE",alreadyComplete:true,report:await historicalQualityReport(env,{league:L,season:y,month:m})};
  const started=new Date().toISOString();
  await db.prepare("UPDATE asian_baseball_backfill_shards SET status='RUNNING',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=?")
    .bind(new Date(Date.now()+4*60*1000).toISOString(),started,id).run();
  let discovered=0,persisted=0,duplicates=0,malformed=0,requests=0,cursor=row?.cursor_date||b.start;
  try{
    if(L==="NPB"){
      const url=`https://npb.jp/games/${y}/schedule_${pad(m)}_detail.html`;
      const html=await fetchText(url,fetcher);requests++;
      const games=parseNpbHistoricalMonth(html,y,m);discovered=games.length;
      const p=await persistHistoricalGames(env,games,{observedAt:started,fetchedAt:started});persisted=p.persisted;duplicates=p.duplicates;
      cursor=nextDate(b.end);
    }else{
      while(cursor<=b.end&&requests<cap){
        const url=`https://eng.koreabaseball.com/Schedule/Scoreboard.aspx?searchDate=${cursor}`;
        const html=await fetchText(url,fetcher);requests++;
        const games=parseKboHistoricalScoreboard(html,cursor);discovered+=games.length;
        const p=await persistHistoricalGames(env,games,{observedAt:started,fetchedAt:started});persisted+=p.persisted;duplicates+=p.duplicates;
        cursor=nextDate(cursor);
      }
    }
    const done=cursor>b.end,status=done?"DONE":"PARTIAL",now=new Date().toISOString();
    await db.prepare(`UPDATE asian_baseball_backfill_shards SET status=?,cursor_date=?,requests_used=requests_used+?,games_discovered=games_discovered+?,
      games_persisted=games_persisted+?,malformed_rows=malformed_rows+?,duplicate_rows=duplicate_rows+?,lease_until=NULL,last_error=NULL,updated_at=?,completed_at=?
      WHERE id=?`).bind(status,cursor,requests,discovered,persisted,malformed,duplicates,now,done?now:null,id).run();
    return{ok:true,id,status,requests,discovered,persisted,duplicates,cursor,report:await historicalQualityReport(env,{league:L,season:y,month:m})};
  }catch(err){
    const now=new Date().toISOString();
    await db.prepare("UPDATE asian_baseball_backfill_shards SET status='FAILED',lease_until=NULL,last_error=?,updated_at=? WHERE id=?")
      .bind(String(err?.message||err).slice(0,500),now,id).run();
    return{ok:false,id,status:"FAILED",error:String(err?.message||err),requests,discovered,persisted,duplicates};
  }
}

export async function historicalQualityReport(env,{league,season,month}={}){
  const db=env?.DB;if(!db?.prepare)return{ok:false,error:"d1-unbound"};
  const L=String(league).toUpperCase(),prefix=`${season}-${pad(month)}`;
  const r=await db.prepare(`SELECT
    COUNT(*) AS persisted_games,
    SUM(CASE WHEN is_final=1 AND home_final_runs IS NOT NULL AND away_final_runs IS NOT NULL THEN 1 ELSE 0 END) AS completed_results,
    SUM(CASE WHEN home_team_id IS NOT NULL AND away_team_id IS NOT NULL THEN 1 ELSE 0 END) AS team_mapped,
    SUM(CASE WHEN venue IS NOT NULL AND TRIM(venue)<>'' THEN 1 ELSE 0 END) AS venue_rows,
    SUM(CASE WHEN source_game_id IS NOT NULL THEN 1 ELSE 0 END) AS source_id_rows,
    SUM(CASE WHEN result_observed_at IS NOT NULL AND last_fetched_at IS NOT NULL THEN 1 ELSE 0 END) AS temporal_rows,
    MIN(game_date) AS first_date,MAX(game_date) AS last_date
    FROM asian_baseball_games WHERE league=? AND substr(game_date,1,7)=?`).bind(L,prefix).first();
  const s=await db.prepare("SELECT * FROM asian_baseball_backfill_shards WHERE id=?").bind(`${L.toLowerCase()}:${prefix}`).first();
  const n=Number(r?.persisted_games||0),pct=x=>n?Number(x||0)/n:null;
  return{ok:true,league:L,season:Number(season),month:Number(month),persistedGames:n,completedResultCoverage:pct(r?.completed_results),
    canonicalTeamMappingCoverage:pct(r?.team_mapped),venueCoverage:pct(r?.venue_rows),sourceIdCoverage:pct(r?.source_id_rows),
    temporalMetadataCoverage:pct(r?.temporal_rows),firstDate:r?.first_date||null,lastDate:r?.last_date||null,
    shard:s?{status:s.status,attempts:Number(s.attempts||0),requestsUsed:Number(s.requests_used||0),gamesDiscovered:Number(s.games_discovered||0),
      gamesPersisted:Number(s.games_persisted||0),duplicateRows:Number(s.duplicate_rows||0),malformedRows:Number(s.malformed_rows||0),lastError:s.last_error||null}:null};
}
