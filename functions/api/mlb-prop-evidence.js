import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildSlate } from "../lib/slateEngine.js";
import { canonicalizeProPlayerPropMarket } from "../lib/proPlayerProps.js";
import { sha256Hex } from "../lib/sha256Hex.js";
import { MLB_PROP_PROMOTION_GATE_VERSION } from "../lib/mlbPropPromotionGovernance.js";
import { noVigPair } from "../lib/canonical/economicGrading.js";
import { persistProspectiveEvidenceAtomic, persistEconomicGrade } from "../lib/canonical/evidenceStore.js";

const SUPPORTED_MARKETS=new Set([
  "strikeouts","pitcher_outs","walks_allowed","hits_allowed","earned_runs","pitch_count",
  "hits","total_bases","home_runs","runs","rbis","walks","hits_runs_rbis"
]);
const iso=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?new Date(t).toISOString():null};
const num=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const text=v=>{const s=String(v??"").trim();return s||null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const ctDate=(d=new Date())=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function envFor(context){return{
  PARLAY_API_KEY:context.env.PARLAY_API_KEY,THEODDS_API_KEY:context.env.THEODDS_API_KEY,
  SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
  BALLPARK_PAL_API_KEY:context.env.BALLPARK_PAL_API_KEY,DB:context.env.DB,ARCHIVE:context.env.ARCHIVE,
  caches:caches.default,parlayCacheOnly:true,palCacheOnly:true
}}
function marketKey(raw){
  const s=String(raw||"").replace(/^SPORTSBOOK_PROP:/i,"").replace(/^player_/i,"");
  return canonicalizeProPlayerPropMarket("mlb",s);
}
function shardAccept(eventId,shard,shards){
  const n=Number(String(eventId||"").replace(/\D/g,"").slice(-9))||0;
  return shards<=1 || (n%shards)===shard;
}
function evidenceShardAccept(evidenceId,shard,shards){
  if(shards<=1)return true;
  const n=parseInt(String(evidenceId||"0").slice(0,8),16);
  return Number.isFinite(n) && (n%shards)===shard;
}
function checkpoint(game={}){
  const start=Date.parse(game.start||""); const h=Number.isFinite(start)?(start-Date.now())/3600000:null;
  if(h==null)return"CURRENT"; if(h<=0)return"LIVE_OR_FINAL"; if(h<=1.5)return"CLOSE";
  if(h<=4)return"PREGAME"; if(h<=10)return"MIDDAY"; return"MORNING";
}
async function latestMarketQuotes(db,date,decisionAt){
  const [pp,book]=await Promise.all([
    db.prepare(`SELECT * FROM (
      SELECT player_id,player_name,team,canonical_market,line,odds_tier,observed_at,collected_at,
             ROW_NUMBER() OVER(PARTITION BY lower(player_name),canonical_market,COALESCE(odds_tier,'standard')
               ORDER BY collected_at DESC) rn
        FROM prizepicks_prop_lines
       WHERE lower(sport)='mlb' AND substr(start_time,1,10)=? AND collected_at<=?
    ) WHERE rn=1`).bind(date,decisionAt).all(),
    db.prepare(`SELECT * FROM (
      SELECT subject_id,subject_name,team_id,market_type,COALESCE(book_line,line) line,
             COALESCE(book,source) book,book_over_price,book_under_price,priced,
             COALESCE(source_as_of,frozen_at) observed_at,frozen_at,
             ROW_NUMBER() OVER(PARTITION BY lower(subject_name),market_type,COALESCE(book,source)
               ORDER BY frozen_at DESC) rn
        FROM mlb_market_projections
       WHERE date=? AND market_type LIKE 'SPORTSBOOK_PROP:%' AND frozen_at<=?
    ) WHERE rn=1`).bind(date,decisionAt).all()
  ]);
  const out=[];
  for(const r of pp.results||[]){
    const market=canonicalizeProPlayerPropMarket("mlb",r.canonical_market);
    if(!SUPPORTED_MARKETS.has(market))continue;
    out.push({playerId:text(r.player_id),playerName:r.player_name,team:r.team,market,line:num(r.line),
      marketSource:"PRIZEPICKS_APIFY",sportsbook:"PrizePicks",oddsTier:r.odds_tier||"standard",
      observedAt:iso(r.observed_at||r.collected_at),raw:r});
  }
  for(const r of book.results||[]){
    const market=marketKey(r.market_type);
    if(!SUPPORTED_MARKETS.has(market))continue;
    out.push({playerId:text(r.subject_id),playerName:r.subject_name,team:text(r.team_id),market,line:num(r.line),
      marketSource:"PARLAY_API",sportsbook:r.book||"Parlay",oddsTier:"standard",
      observedAt:iso(r.observed_at||r.frozen_at),raw:r});
  }
  return out.filter(x=>x.playerName&&x.market&&x.line!=null&&x.observedAt);
}
function quoteIndex(quotes=[]){
  const m=new Map();
  for(const q of quotes){
    const k=norm(q.playerName)+"|"+q.market;
    if(!m.has(k))m.set(k,[]);
    m.get(k).push(q);
  }
  return m;
}
async function loadPlayerProfiles(db,rows=[]){
  const ids=[...new Set(rows.map(r=>text(r.playerId)).filter(Boolean))];
  const hitters=new Map(),pitchers=new Map();
  for(let i=0;i<ids.length;i+=70){
    const chunk=ids.slice(i,i+70),ph=chunk.map(()=>"?").join(",");
    const [h,p]=await Promise.all([
      db.prepare(`SELECT player_id,as_of,profile_json,source_version FROM mlb_hitter_profiles WHERE player_id IN (${ph})`).bind(...chunk).all(),
      db.prepare(`SELECT player_id,as_of,profile_json,source_version FROM mlb_pitcher_profiles WHERE player_id IN (${ph})`).bind(...chunk).all()
    ]);
    for(const x of h.results||[])hitters.set(String(x.player_id),x);
    for(const x of p.results||[])pitchers.set(String(x.player_id),x);
  }
  return{hitters,pitchers};
}
function temporalProblems({sourceObservedAt,stateAsOf,projectionAt,marketAt,decisionAt,eventStart}){
  const probs=[];
  const pairs=[
    ["SOURCE_AFTER_STATE",sourceObservedAt,stateAsOf],
    ["STATE_AFTER_PROJECTION",stateAsOf,projectionAt],
    ["MARKET_AFTER_DECISION",marketAt,decisionAt],
  ];
  for(const [code,a,b] of pairs)if(a&&b&&Date.parse(a)>Date.parse(b))probs.push(code);
  if(decisionAt&&eventStart&&Date.parse(decisionAt)>=Date.parse(eventStart))probs.push("POST_START_SNAPSHOT");
  return probs;
}
async function reject(db,{operation,eventId,row,reason,details,at}){
  const id=sha256Hex(JSON.stringify(["mlb_prop_reject",operation,eventId,row?.playerId,row?.market,reason,at,details]));
  await db.prepare(`INSERT OR IGNORE INTO mlb_prop_evidence_rejections
    (id,operation,event_id,player_id,player_name,market,reason,details_json,observed_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,operation,text(eventId),text(row?.playerId),text(row?.playerName),text(row?.market),reason,JSON.stringify(details||{}),at).run();
}
async function startEvidenceRun(db,{id,operation,date,shard,shards,started}){
  await db.prepare(`INSERT INTO mlb_prop_evidence_runs(
    id,operation,event_date,shard,shards,status,attempted,accepted,duplicates,rejected,settled,missing_outcomes,started_at,finished_at,details_json
  ) VALUES(?,?,?,?,?,'RUNNING',0,0,0,0,0,0,?,NULL,?)`)
    .bind(id,operation,date,shard,shards,started,JSON.stringify({phase:"started"})).run();
}
async function finishEvidenceRun(db,{id,status="SUCCESS",attempted=0,accepted=0,duplicates=0,rejected=0,settled=0,missing=0,finished,details={}}){
  await db.prepare(`UPDATE mlb_prop_evidence_runs
    SET status=?,attempted=?,accepted=?,duplicates=?,rejected=?,settled=?,missing_outcomes=?,finished_at=?,details_json=?
    WHERE id=?`)
    .bind(status,attempted,accepted,duplicates,rejected,settled,missing,finished,JSON.stringify(details||{}),id).run();
}
async function failEvidenceRun(db,id,error){
  try{
    await finishEvidenceRun(db,{id,status:"FAILED",finished:new Date().toISOString(),details:{error:String(error?.message||error)}});
  }catch{}
}
async function capture(context,{date,shard=0,shards=1}={}){
  const db=context.env.DB,started=new Date().toISOString();
  const runId=sha256Hex(JSON.stringify(["mlb_prop_capture",date,shard,shards,started]));
  await startEvidenceRun(db,{id:runId,operation:"capture",date,shard,shards,started});
  try{
  const env=envFor(context);
  const slate=await buildSlate("mlb",date,env);
  const games=(slate.games||[]).filter(g=>!g?.status?.completed&&!g?.status?.live).slice(0,8);
  const flat=games.flatMap(g=>(g.playerProjectionRows||[]).map(r=>({g,r}))).filter(x=>SUPPORTED_MARKETS.has(x.r.market));
  const profiles=await loadPlayerProfiles(db,flat.map(x=>x.r));
  const decisionAt=new Date().toISOString();
  const quotes=quoteIndex(await latestMarketQuotes(db,date,decisionAt));
  let attempted=0,accepted=0,duplicates=0,rejected=0;
  for(const {g,r} of flat){
    const qs=quotes.get(norm(r.playerName)+"|"+r.market)||[];
    if(!qs.length)continue;
    for(const q of qs){
      attempted++;
      const eventStart=iso(g.start),projectionAt=iso(r.projectionSnapshotAt)||decisionAt;
      const stateAsOf=iso(r.stateAsOf||g?.mlbPersistentState?.asOf);
      const sourceObservedAt=iso(r.sourceObservedAt||stateAsOf);
      const modelSource=text(r.source),modelVersion=text(r.modelVersion);
      const missing=[];
      if(!g.id||!r.playerName)missing.push("MISSING_PLAYER_OR_EVENT_IDENTITY");
      if(!modelSource)missing.push("MISSING_MODEL_SOURCE");
      if(!modelVersion)missing.push("MISSING_MODEL_VERSION");
      if(!stateAsOf)missing.push("MISSING_STATE_TIMESTAMP");
      if(!projectionAt)missing.push("MISSING_PROJECTION_TIMESTAMP");
      if(!eventStart)missing.push("MISSING_EVENT_START");
      if(missing.length){
        rejected++; await reject(db,{operation:"capture",eventId:g.id,row:r,reason:missing.join(","),details:{quote:q},at:decisionAt}); continue;
      }
      const probs=temporalProblems({sourceObservedAt,stateAsOf,projectionAt,marketAt:q.observedAt,decisionAt,eventStart});
      if(probs.length){
        rejected++; await reject(db,{operation:"capture",eventId:g.id,row:r,reason:probs.join(","),details:{quote:q},at:decisionAt}); continue;
      }
      const side=Number(r.fbisProjection)>q.line?"MORE":Number(r.fbisProjection)<q.line?"LESS":null;
      const team=String(r.team||"").toUpperCase();
      const opponent=team===String(g.home?.abbr||"").toUpperCase()?(g.away?.abbr||g.away?.name): (g.home?.abbr||g.home?.name);
      const cp=checkpoint(g);
      const projectionUnitKey=[
        String(g.id),
        String(r.playerId||norm(r.playerName)),
        r.market,
        modelVersion,
        cp,
      ].join("|");
      const duplicateKey=sha256Hex(JSON.stringify([projectionUnitKey,q.marketSource,q.sportsbook,q.oddsTier,q.line]));
      const id=sha256Hex(JSON.stringify(["MLB_PROP_EVIDENCE_v1",duplicateKey]));
      const prof=String(r.position||"").toUpperCase()==="P"?profiles.pitchers.get(String(r.playerId)):profiles.hitters.get(String(r.playerId));
      const stateSnapshot={contract:"mlb-state-v2",stateAsOf,sourceObservedAt,eventPersistentState:g.mlbPersistentState||null,
        playerProfile:prof?{playerId:prof.player_id,asOf:prof.as_of,sourceVersion:prof.source_version,profile:JSON.parse(prof.profile_json||"null")}:null};
      if(!evidenceShardAccept(id,shard,shards))continue;
      const sportInsert=db.prepare(`INSERT OR IGNORE INTO mlb_prop_prospective_evidence(
        id,gate_version,event_id,event_date,event_start_at,player_id,player_name,team,opponent,position,market,
        projection,sigma,model_source,model_version,source_observed_at,state_as_of,projection_snapshot_at,checkpoint,
        market_source,sportsbook,market_line,odds_tier,market_observed_at,decision_snapshot_at,candidate_side,
        state_snapshot_json,projection_json,market_json,temporal_integrity,temporal_diagnostics_json,duplicate_key,projection_unit_key,
        can_qualify,can_authorize_wager,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?)`)
      .bind(id,MLB_PROP_PROMOTION_GATE_VERSION,String(g.id),date,eventStart,text(r.playerId),r.playerName,r.team||null,opponent||null,r.position||null,r.market,
        num(r.fbisProjection),num(r.fbisSigma),modelSource,modelVersion,sourceObservedAt,stateAsOf,projectionAt,cp,
        q.marketSource,q.sportsbook,q.line,q.oddsTier,q.observedAt,decisionAt,side,
        JSON.stringify(stateSnapshot),JSON.stringify(r),JSON.stringify(q),1,JSON.stringify({ok:true,problems:[]}),duplicateKey,projectionUnitKey,decisionAt);
        const stateSnapshotId=sha256Hex(JSON.stringify(["mlb_prop_state",g.id,r.playerId||norm(r.playerName),stateAsOf,modelVersion]));
        const championProjection={championModel:String(g.championModel||slate.modelVersion||"FBIS-v1.4")};
        const challengerProjection={playerId:r.playerId||null,playerName:r.playerName,market:r.market,projection:num(r.fbisProjection),sigma:num(r.fbisSigma),candidateSide:side};
        const marketSnapshot={marketSource:q.marketSource,sportsbook:q.sportsbook,oddsTier:q.oddsTier,marketLine:q.line,observedAt:q.observedAt,raw:q.raw||null};
        const uncertainty={sigma:num(r.fbisSigma),state:num(r.fbisSigma)==null?"UNKNOWN":"OBSERVED"};
        const qualificationAuthority={canQualify:false,source:"MLB_PROP_PROMOTION_GATE",gateVersion:MLB_PROP_PROMOTION_GATE_VERSION};
        const wagerAuthority={canAuthorize:false,source:"MODEL_GOVERNANCE"};
        const canonical = await persistProspectiveEvidenceAtomic(context.env, {
          evidenceId:id,
          sport:"mlb",
          eventId:String(g.id),
          eventStartAt:eventStart,
          snapshotAt:decisionAt,
          championModelId:"MLB-SAVANT-RPG-SP",
          modelId:modelSource,
          modelVersion,
          lifecycle:"SHADOW",
          gateVersion:MLB_PROP_PROMOTION_GATE_VERSION,
          stateSnapshotId,
          marketSnapshotId:duplicateKey,
          marketObservedAt:q.observedAt,
          sourceObservedAts:[sourceObservedAt,q.observedAt].filter(Boolean),
          codeSha:context.env.CF_PAGES_COMMIT_SHA||null,
          stateSnapshot,
          marketSnapshot,
          uncertainty,
          incumbentProjection:championProjection,
          challengerProjection,
          governance:{
            stateBeforeWeight:true,
            rawProjectionDistanceCanPromote:false,
            canQualify:false,
            canAuthorizeWager:false,
            projectionUnitKey,
            marketSource:q.marketSource,
            sportsbook:q.sportsbook,
            oddsTier:q.oddsTier,
            marketLine:q.line,
          },
          qualificationAuthority,
          wagerAuthority,
          canQualify:false,
          canAuthorize:false,
        }, { beforeStatements:[sportInsert] });
        if(!canonical.ok){
          rejected++;
          await reject(db,{operation:"canonical_capture",eventId:g.id,row:r,reason:canonical.reason||"CANONICAL_EVIDENCE_WRITE_FAILED",details:{canonical},at:decisionAt});
          continue;
        }
        const sportChanged=Number(canonical.beforeResults?.[0]?.meta?.changes||0);
        if(sportChanged>0)accepted++; else duplicates++;
      
    }
  }
  const finished=new Date().toISOString();
  await finishEvidenceRun(db,{id:runId,attempted,accepted,duplicates,rejected,finished,details:{games:games.length,projectionRows:flat.length,marketQuotes:[...quotes.values()].reduce((n,x)=>n+x.length,0)}});
  return{ok:true,operation:"capture",date,shard,shards,games:games.length,projectionRows:flat.length,attempted,accepted,duplicates,rejected,runId};
  }catch(e){
    await failEvidenceRun(db,runId,e);
    throw e;
  }
}
function inningsToOuts(v){
  const s=String(v??""); if(!s)return null; const [a,b="0"]=s.split("."); const inn=Number(a),rem=Number(b);
  return Number.isFinite(inn)&&[0,1,2].includes(rem)?inn*3+rem:null;
}
function playerActual(player={},market=""){
  const b=player?.stats?.batting||{},p=player?.stats?.pitching||{};
  if(market==="strikeouts")return player?.position?.abbreviation==="P"?num(p.strikeOuts):num(b.strikeOuts);
  if(market==="pitcher_outs")return inningsToOuts(p.inningsPitched);
  if(market==="walks_allowed")return num(p.baseOnBalls);
  if(market==="hits_allowed")return num(p.hits);
  if(market==="earned_runs")return num(p.earnedRuns);
  if(market==="pitch_count")return num(p.numberOfPitches);
  if(market==="hits")return num(b.hits);
  if(market==="total_bases"){
    const h=num(b.hits),d=num(b.doubles)||0,t=num(b.triples)||0,hr=num(b.homeRuns)||0;
    return h==null?null:h+d+2*t+3*hr;
  }
  if(market==="home_runs")return num(b.homeRuns);
  if(market==="runs")return num(b.runs);
  if(market==="rbis")return num(b.rbi);
  if(market==="walks")return num(b.baseOnBalls);
  if(market==="hits_runs_rbis"){
    const h=num(b.hits),r=num(b.runs),bi=num(b.rbi); return h==null||r==null||bi==null?null:h+r+bi;
  }
  return null;
}
async function settle(context,{date,shard=0,shards=1,limitGames=6}={}){
  const db=context.env.DB,started=new Date().toISOString();
  const runId=sha256Hex(JSON.stringify(["mlb_prop_settle",date,shard,shards,started]));
  await startEvidenceRun(db,{id:runId,operation:"settle",date,shard,shards,started});
  try{
  const q=await db.prepare(`SELECT DISTINCT event_id FROM mlb_prop_prospective_evidence
    WHERE event_date=? AND temporal_integrity=1 AND settled_at IS NULL ORDER BY event_id`).bind(date).all();
  const ids=(q.results||[]).map(x=>String(x.event_id)).slice(0,Math.max(1,Math.min(10,Number(limitGames)||6)));
  let attempted=0,settled=0,missing=0,rejected=0;
  for(const eventId of ids){
    attempted++;
    let feed;
    try{
      const res=await fetch(`https://statsapi.mlb.com/api/v1.1/game/${encodeURIComponent(eventId)}/feed/live`,{headers:{accept:"application/json"}});
      if(!res.ok)throw new Error("mlb_stats_http_"+res.status); feed=await res.json();
    }catch(e){missing++;await reject(db,{operation:"settle",eventId,row:null,reason:"SETTLEMENT_FETCH_FAILED",details:{error:String(e?.message||e)},at:new Date().toISOString()});continue}
    if(String(feed?.gameData?.status?.abstractGameState||"").toLowerCase()!=="final"){missing++;continue}
    const players={...(feed?.liveData?.boxscore?.teams?.home?.players||{}),...(feed?.liveData?.boxscore?.teams?.away?.players||{})};
    const rows=((await db.prepare(`SELECT * FROM mlb_prop_prospective_evidence WHERE event_id=? AND settled_at IS NULL AND temporal_integrity=1`).bind(eventId).all()).results||[])
      .filter(row=>evidenceShardAccept(row.id,shard,shards));
    for(const row of rows){
      const player=players["ID"+row.player_id] || Object.values(players).find(x=>norm(x?.person?.fullName)===norm(row.player_name));
      const actual=playerActual(player,row.market);
      if(actual==null){missing++;continue}
      const side=row.candidate_side;
      const result=side==="MORE"?(actual>row.market_line?"HIT":actual<row.market_line?"MISS":"PUSH"):
        side==="LESS"?(actual<row.market_line?"HIT":actual>row.market_line?"MISS":"PUSH"):"NO_SIDE";
      const at=new Date().toISOString();
      const settlementPayload={gameStatus:feed.gameData.status,playerId:player?.person?.id||null,market:row.market,actual};
      const upd=await db.prepare(`UPDATE mlb_prop_prospective_evidence
        SET actual_value=?,result=?,settled_at=?,settlement_source='MLB_STATS_FINAL',settlement_json=?,updated_at=?
        WHERE id=? AND settled_at IS NULL`).bind(actual,result,at,JSON.stringify(settlementPayload),at,row.id).run();
      const changed=Number(upd?.meta?.changes||0);
      settled+=changed;
      if(changed>0){
        await db.prepare(`UPDATE fbis_prospective_evidence
          SET graded_at=?,result_json=?
          WHERE evidence_id=? AND graded_at IS NULL`)
          .bind(at,JSON.stringify({result,actual,settlementSource:"MLB_STATS_FINAL",settlement:settlementPayload}),row.id).run();

        let market={};
        try{market=JSON.parse(row.market_json||"{}")||{}}catch{}
        const raw=market?.raw||{};
        const overPrice=num(raw.book_over_price);
        const underPrice=num(raw.book_under_price);
        if(overPrice!=null&&underPrice!=null&&(row.candidate_side==="MORE"||row.candidate_side==="LESS")){
          const nv=noVigPair(overPrice,underPrice);
          const isMore=row.candidate_side==="MORE";
          const entryPrice=isMore?overPrice:underPrice;
          const entryNoVig=isMore?nv.a:nv.b;
          const normalizedResult=result==="HIT"?"WIN":result==="MISS"?"LOSS":result==="PUSH"?"PUSH":null;
          if(normalizedResult&&entryNoVig!=null){
            const gradeId=sha256Hex(JSON.stringify(["FBIS_ECONOMIC_GRADE_v1",row.id]));
            const gradeWrite=await persistEconomicGrade(context.env,{
              gradeId,
              evidenceId:row.id,
              sport:"mlb",
              eventId:row.event_id,
              marketFamily:row.market,
              selection:row.candidate_side,
              projectedProbability:null,
              entryLine:num(row.market_line),
              entryPrice,
              entryNoVigProbability:entryNoVig,
              closeLine:null,
              closePrice:null,
              closeNoVigProbability:null,
              result:normalizedResult,
              stakeUnits:1,
              gradedAt:at,
              metadata:{
                economicBasis:"SIMULATED_1U_PRICE_AVAILABLE",
                marketSource:row.market_source,
                sportsbook:row.sportsbook,
                entryMarketSnapshotId:row.duplicate_key,
                closeMarketSnapshotId:null,
                entryObservedAt:row.market_observed_at,
                closeObservedAt:null,
                metricMethodVersion:"FBIS-ECONOMIC-GRADE-v1",
              },
            });
            if(!gradeWrite.ok){
              rejected++;
              await reject(db,{operation:"economic_grade",eventId:row.event_id,row,reason:gradeWrite.reason||"ECONOMIC_GRADE_WRITE_FAILED",details:{gradeWrite},at});
            }
          }
        }
      }
    }
  }
  const finished=new Date().toISOString();
  await finishEvidenceRun(db,{id:runId,attempted,rejected,settled,missing,finished,details:{eventIds:ids}});
  return{ok:true,operation:"settle",date,shard,shards,games:ids.length,settled,missingOutcomes:missing,rejected,runId};
  }catch(e){
    await failEvidenceRun(db,runId,e);
    throw e;
  }
}
async function status(context,{date=null}={}){
  const where=date?"WHERE event_date=?":"",bind=date?[date]:[];
  const rows=(await context.env.DB.prepare(`SELECT market,model_source,model_version,
    COUNT(*) offer_snapshots,
    COUNT(DISTINCT projection_unit_key) independent_projection_units,
    SUM(CASE WHEN settled_at IS NOT NULL THEN 1 ELSE 0 END) settled_offer_snapshots,
    COUNT(DISTINCT CASE WHEN settled_at IS NOT NULL THEN projection_unit_key END) settled_independent_units,
    COUNT(DISTINCT event_date) distinct_dates,
    SUM(CASE WHEN temporal_integrity=0 THEN 1 ELSE 0 END) temporal_failures,
    SUM(CASE WHEN settled_at IS NULL THEN 1 ELSE 0 END) pending_offer_snapshots
    FROM mlb_prop_prospective_evidence ${where}
    GROUP BY market,model_source,model_version ORDER BY market,model_version`).bind(...bind).all()).results||[];
  const rej=(await context.env.DB.prepare(`SELECT reason,COUNT(*) n FROM mlb_prop_evidence_rejections
    ${date?"WHERE substr(observed_at,1,10)=?":""} GROUP BY reason ORDER BY n DESC`).bind(...bind).all()).results||[];
  const consistency=(await context.env.DB.prepare(`SELECT
      COUNT(*) settled_projection_units,
      SUM(CASE WHEN actual_variants>1 THEN 1 ELSE 0 END) actual_value_mismatch_units
    FROM (
      SELECT projection_unit_key,COUNT(DISTINCT actual_value) actual_variants
      FROM mlb_prop_prospective_evidence
      ${date?"WHERE event_date=? AND settled_at IS NOT NULL":"WHERE settled_at IS NOT NULL"}
      GROUP BY projection_unit_key
    )`).bind(...bind).all()).results?.[0]||{settled_projection_units:0,actual_value_mismatch_units:0};
  const settlementSources=(await context.env.DB.prepare(`SELECT settlement_source,COUNT(*) settled_offer_snapshots,
      COUNT(DISTINCT projection_unit_key) settled_independent_units
    FROM mlb_prop_prospective_evidence
    ${date?"WHERE event_date=? AND settled_at IS NOT NULL":"WHERE settled_at IS NOT NULL"}
    GROUP BY settlement_source ORDER BY settled_offer_snapshots DESC`).bind(...bind).all()).results||[];
  return{ok:true,operation:"status",date,gateVersion:MLB_PROP_PROMOTION_GATE_VERSION,rows,rejections:rej,consistency,settlementSources,
    governance:{canQualify:false,canAuthorizeWager:false,autoPromotion:false,stateBeforeWeight:true}};
}
export async function onRequestGet(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const auth=authorizeHarvest(context.request,context.env); if(!auth.ok)return json(unauthorizedBody(),401);
  const u=new URL(context.request.url); return json(await status(context,{date:text(u.searchParams.get("date"))}));
}
export async function onRequestPost(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const auth=authorizeHarvest(context.request,context.env); if(!auth.ok)return json(unauthorizedBody(),401);
  let body={};try{body=await context.request.json()}catch{}
  const operation=String(body.operation||"").toLowerCase(),date=text(body.date)||ctDate();
  const shard=Math.max(0,Number(body.shard)||0),shards=Math.max(1,Math.min(32,Number(body.shards)||1));
  if(shard>=shards)return json({ok:false,error:"invalid_shard"},400);
  try{
    if(operation==="capture")return json(await capture(context,{date,shard,shards}));
    if(operation==="settle")return json(await settle(context,{date,shard,shards,limitGames:body.limitGames}));
    if(operation==="status")return json(await status(context,{date}));
    return json({ok:false,error:"unsupported_operation"},400);
  }catch(e){return json({ok:false,error:String(e?.message||e),operation,date,shard,shards},500)}
}


export { inningsToOuts, playerActual };
