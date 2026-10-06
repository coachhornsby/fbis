import { authorizeSoccerWorker, unauthorizedBody } from "../lib/soccerWorkerAuth.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}

const PRIORITY_KEYS=["eng.1","eng.2","ger.1","esp.1","ita.1","fra.1","uefa.champions","uefa.europa","usa.1","mex.1"];
const VALIDATION_FLOOR=120;
const PRIORITY=`CASE q.heritage_key
  WHEN 'eng.1' THEN 1
  WHEN 'eng.2' THEN 2
  WHEN 'ger.1' THEN 3
  WHEN 'esp.1' THEN 4
  WHEN 'ita.1' THEN 5
  WHEN 'fra.1' THEN 6
  WHEN 'uefa.champions' THEN 7
  WHEN 'uefa.europa' THEN 8
  WHEN 'usa.1' THEN 9
  WHEN 'mex.1' THEN 10
  WHEN 'ned.1' THEN 11
  WHEN 'por.1' THEN 12
  WHEN 'arg.1' THEN 13
  WHEN 'bra.1' THEN 14
  ELSE 100 END`;

async function stageState(db){
  const placeholders=PRIORITY_KEYS.map(()=>"?").join(",");
  const r=await db.prepare(`SELECT heritage_key,COALESCE(advanced_rows,0) AS eligible_count
    FROM soccer_competition_coverage WHERE heritage_key IN (${placeholders})`).bind(...PRIORITY_KEYS).all();
  const counts=Object.fromEntries(PRIORITY_KEYS.map(k=>[k,0]));
  for(const row of r?.results||[])counts[String(row.heritage_key)]=Math.max(0,Number(row.eligible_count)||0);
  const underfilled=PRIORITY_KEYS.filter(k=>counts[k]<VALIDATION_FLOOR);
  return {stage:underfilled.length?"A_BREADTH":"B_DEPTH",counts,underfilled};
}

async function breadthCandidate(db,nowIso,state){
  if(!state.underfilled.length)return null;
  const placeholders=state.underfilled.map(()=>"?").join(",");
  return db.prepare(`SELECT q.*,COALESCE(c.advanced_rows,0) AS eligible_advanced_count
    FROM soccer_pitchapi_backfill_queue q
    LEFT JOIN soccer_competition_coverage c ON c.heritage_key=q.heritage_key
    WHERE q.heritage_key IN (${placeholders})
      AND (q.status='PENDING' OR (q.status='LEASED' AND (q.lease_until IS NULL OR q.lease_until<?)))
      AND q.attempts<6
      AND NOT EXISTS (
        SELECT 1 FROM soccer_pitchapi_backfill_queue active
        WHERE active.heritage_key=q.heritage_key
          AND active.id<>q.id
          AND active.status='LEASED'
          AND active.lease_until IS NOT NULL
          AND active.lease_until>=?
      )
    ORDER BY eligible_advanced_count ASC, ${PRIORITY}, q.attempts ASC, q.updated_at, q.id
    LIMIT 1`).bind(...state.underfilled,nowIso,nowIso).first();
}

async function depthCandidate(db,nowIso,{excludeKeys=[]}={}){
  const exclusion=excludeKeys.length?` AND q.heritage_key NOT IN (${excludeKeys.map(()=>"?").join(",")})`:"";
  return db.prepare(`SELECT q.*,COALESCE(c.advanced_rows,0) AS eligible_advanced_count
    FROM soccer_pitchapi_backfill_queue q
    LEFT JOIN soccer_competition_coverage c ON c.heritage_key=q.heritage_key
    WHERE (q.status='PENDING' OR (q.status='LEASED' AND (q.lease_until IS NULL OR q.lease_until<?)))
      AND q.attempts<6${exclusion}
      AND NOT EXISTS (
        SELECT 1 FROM soccer_pitchapi_backfill_queue active
        WHERE active.heritage_key=q.heritage_key
          AND active.id<>q.id
          AND active.status='LEASED'
          AND active.lease_until IS NOT NULL
          AND active.lease_until>=?
      )
    ORDER BY
      CASE WHEN q.heritage_key IN ('eng.1','eng.2','ger.1','esp.1','ita.1','fra.1','uefa.champions','uefa.europa','usa.1','mex.1') THEN 0 ELSE 1 END,
      COALESCE(c.advanced_rows,0) ASC,
      ${PRIORITY},
      q.season ASC,
      q.offset ASC,
      q.attempts ASC,
      q.updated_at,
      q.id
    LIMIT 1`).bind(nowIso,...excludeKeys,nowIso).first();
}

export async function onRequestPost(context){
  const auth=authorizeSoccerWorker(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;
  if(!db?.prepare)return json({ok:false,error:"d1-unbound"},503);

  for(let claimAttempt=1;claimAttempt<=5;claimAttempt++){
    const now=new Date(),nowIso=now.toISOString(),leaseUntil=new Date(now.getTime()+5*60*1000).toISOString();
    const state=await stageState(db);
    let candidate=state.stage==="A_BREADTH"?await breadthCandidate(db,nowIso,state):null;
    let policy=state.stage;
    if(!candidate){
      candidate=await depthCandidate(db,nowIso,{excludeKeys:state.stage==="A_BREADTH"?state.underfilled:[]});
      if(state.stage==="A_BREADTH"&&candidate)policy="A_BREADTH_FALLBACK_DEPTH";
    }
    if(!candidate)return json({ok:true,empty:true,policy,validationFloor:VALIDATION_FLOOR,eligibleCounts:state.counts,underfilled:state.underfilled});

    const update=await db.prepare(`UPDATE soccer_pitchapi_backfill_queue
      SET status='LEASED',attempts=attempts+1,lease_until=?,updated_at=?
      WHERE id=? AND (status='PENDING' OR (status='LEASED' AND (lease_until IS NULL OR lease_until<?)))`)
      .bind(leaseUntil,nowIso,candidate.id,nowIso).run();
    if(!update?.meta?.changes)continue;

    return json({ok:true,empty:false,claimAttempt,policy,validationFloor:VALIDATION_FLOOR,
      eligibleCounts:state.counts,underfilled:state.underfilled,item:{
        id:candidate.id,
        heritageName:candidate.heritage_name,
        leagueKey:candidate.heritage_key,
        pitchLeagueId:candidate.pitch_league_id,
        season:candidate.season,
        offset:candidate.offset,
        pageSize:Math.max(12,Number(candidate.page_size)||12),
        eligibleAdvancedCount:Number(candidate.eligible_advanced_count??state.counts[candidate.heritage_key]??0),
        leaseUntil
      }});
  }
  return json({ok:false,error:"queue-claim-contention",retryable:true},503);
}
