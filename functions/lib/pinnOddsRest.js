/**
 * PinnOdds FREE REST-only prematch research feed. No WS, SSE, order execution,
 * model promotion, or sportsbook execution authority.
 * D1 SQL INSERT ... SELECT is the atomic, cross-Worker request reservation.
 */
import { persistNormalizedMarketBatch } from "./marketObservationLedger.js";

export const PINNODDS_SPORTS=Object.freeze({1:["soccer"],2:["tennis"],3:["nba","cbb","wnba"],4:["nhl"],5:["nfl","cfb"],6:["mlb","npb","kbo"]});
const SPORT_IDS=Object.keys(PINNODDS_SPORTS).map(Number);
const DAY_LIMIT=100,ROUTINE_LIMIT=80,DIAG_LIMIT=20,MINUTE_LIMIT=19;
const n=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const clean=v=>String(v??"").trim();
const ident=v=>clean(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const asIso=v=>{const d=Date.parse(v||"");return Number.isFinite(d)?new Date(d).toISOString():null};
const inWindow=(date,now)=>{const t=Date.parse(date||"");return Number.isFinite(t)&&t>=now-600000&&t<=now+14*86400000};
export const americanFromDecimal=v=>{const d=n(v);return d==null||d<=1?null:Math.round(d>=2?100*(d-1):-100/(d-1))};

/** A failed/timeout/429 request still consumes a quota slot. */
export async function reservePinnOddsRequest(db,{sportId,purpose="routine",now=new Date(),requestId=crypto.randomUUID()}={}){
 if(!db?.prepare)return {ok:false,reason:"D1_UNAVAILABLE"};
 if(!SPORT_IDS.includes(Number(sportId))||!["routine","diagnostic"].includes(purpose))return {ok:false,reason:"INVALID_REQUEST"};
 const stamp=now.toISOString(),day=stamp.slice(0,10),minute=stamp.slice(0,16);
 const r=await db.prepare(`INSERT INTO pinnodds_api_requests(id,utc_day,utc_minute,purpose,sport_id,reserved_at,status)
 SELECT ?,?,?,?,?,?,'RESERVED' WHERE
 (SELECT COUNT(*) FROM pinnodds_api_requests WHERE utc_day=?)<? AND
 (SELECT COUNT(*) FROM pinnodds_api_requests WHERE utc_day=? AND purpose=?)<? AND
 (SELECT COUNT(*) FROM pinnodds_api_requests WHERE utc_minute=?)<? AND
 NOT EXISTS(SELECT 1 FROM pinnodds_api_requests WHERE retry_after_until>?)`)
 .bind(requestId,day,minute,purpose,Number(sportId),stamp,day,DAY_LIMIT,day,purpose,purpose==="routine"?ROUTINE_LIMIT:DIAG_LIMIT,minute,MINUTE_LIMIT,stamp).run();
 return Number(r?.meta?.changes??r?.changes??0)>0?{ok:true,id:requestId,stamp,day}:{ok:false,reason:"QUOTA_OR_COOLDOWN",day};
}
export async function finishPinnOddsRequest(db,reservation,{status="FAILED",httpStatus=null,dataStatus=null,dataAgeMs=null,eventCount=null,offerCount=null,errorCode=null,retryAfterUntil=null}={}){
 if(!reservation?.ok)return;
 await db.prepare(`UPDATE pinnodds_api_requests SET status=?,http_status=?,data_status=?,data_age_ms=?,event_count=?,offer_count=?,error_code=?,retry_after_until=?,completed_at=? WHERE id=?`)
 .bind(status,httpStatus,dataStatus,dataAgeMs,eventCount,offerCount,errorCode,retryAfterUntil,new Date().toISOString(),reservation.id).run();
}
export async function pinnOddsBudgetStatus(db,{now=new Date()}={}){
 if(!db?.prepare)return {ok:false,reason:"D1_UNAVAILABLE"};
 const day=now.toISOString().slice(0,10);
 const r=await db.prepare(`SELECT COUNT(*) AS used,SUM(CASE WHEN purpose='routine' THEN 1 ELSE 0 END) AS routine,SUM(CASE WHEN purpose='diagnostic' THEN 1 ELSE 0 END) AS diagnostic,MAX(retry_after_until) AS retry_after_until FROM pinnodds_api_requests WHERE utc_day=?`).bind(day).first();
 const used=Number(r?.used||0),routine=Number(r?.routine||0),diagnostic=Number(r?.diagnostic||0);
 return {ok:true,day,used,routine,diagnostic,remaining:Math.max(0,DAY_LIMIT-used),routineRemaining:Math.max(0,ROUTINE_LIMIT-routine),diagnosticRemaining:Math.max(0,DIAG_LIMIT-diagnostic),retryAfterUntil:r?.retry_after_until||null,dailyLimit:DAY_LIMIT,routineLimit:ROUTINE_LIMIT,diagnosticLimit:DIAG_LIMIT};
}
/** Only match unique, correctly oriented participants with verified start <=2h. */
export function matchPinnOddsEvent(event,games,sportId,now=Date.now()){
 const start=asIso(event?.starts||event?.start_ts),home=ident(event?.home),away=ident(event?.away);
 if(!start||!home||!away||!inWindow(start,now))return {sport:null,eventId:null,reason:"INVALID_OR_PAST_EVENT"};
 const startMs=Date.parse(start),sports=PINNODDS_SPORTS[Number(sportId)]||[];
 const matches=(games||[]).filter(g=>sports.includes(String(g.sport||"").toLowerCase())&&ident(g.home_name)===home&&ident(g.away_name)===away&&Math.abs(Date.parse(g.start||"")-startMs)<=2*3600000);
 return matches.length===1?{sport:String(matches[0].sport).toLowerCase(),eventId:String(matches[0].id),reason:"TWO_PARTICIPANT_START_VERIFIED"}:{sport:null,eventId:null,reason:matches.length?"AMBIGUOUS_MATCH":"UNMATCHED_EVENT"};
}
/** Preserve signed spread contracts, periods, source IDs and 3-way draw markets. */
export function normalizePinnOddsEvent(event,sportId,{match={},capturedAt=new Date().toISOString(),dataAgeMs=null}={}){
 const providerId=clean(event?.event_id);if(!providerId)return [];
 const output=[],start=asIso(event.starts||event.start_ts);
 for(const [periodKey,period] of Object.entries(event.periods||{})){
  if(!/^num_\d+$/.test(periodKey)||!period||typeof period!=="object")continue;
  const periodNo=Number(period.number??periodKey.slice(4));
  const add=(family,side,decimal,line=null,extra={})=>{
   const p=n(decimal);if(p==null||p<=1)return;
   const familyName=family==="moneyline"&&period.money_line?.draw!=null?"moneyline_3way":family;
   output.push({source:"PinnOdds",sourceType:"sportsbook",sport:match.sport||"unmatched",league:clean(event.league_name),
    eventId:match.eventId||null,eventStart:start,homeTeam:clean(event.home),awayTeam:clean(event.away),
    marketFamily:familyName,side,period:periodKey,line,americanOdds:americanFromDecimal(p),decimalOdds:p,
    standardOrAlt:line==null?"standard":"unknown",sourceMarketId:`${providerId}:${periodNo}:${family}:${line??"none"}`,
    sourceOutcomeId:`${providerId}:${periodNo}:${family}:${side}:${line??"none"}`,
    fetchedAt:null,executionEligible:false,raw:{providerEventId:providerId,providerSportId:Number(sportId),
    providerLeagueId:event.league_id??null,eventMatchStatus:match.reason||"UNMATCHED_EVENT",sourceObservedAt:null,
    collectorCapturedAt:capturedAt,boardAgeMs:dataAgeMs,referenceOnly:true,...extra}});
  };
  for(const side of ["home","draw","away"])add("moneyline",side,period.money_line?.[side]);
  for(const [key,value] of Object.entries(period.spreads||{})){
   const threshold=n(value?.hdp??key);if(threshold==null)continue;
   add("spread","home",value?.home,threshold);add("spread","away",value?.away,-threshold);
  }
  for(const [key,value] of Object.entries(period.totals||{})){
   const threshold=n(value?.points??key);if(threshold==null)continue;
   add("total","over",value?.over,threshold);add("total","under",value?.under,threshold);
  }
  for(const team of ["home","away"]){
   // team_totals carries all alternates. Do not double-count its primary rung.
   const ladders=Object.entries(period.team_totals?.[team]||{});
   if(ladders.length){
    for(const [key,v] of ladders){
     const threshold=n(v?.points??key);if(threshold==null)continue;
     add("team_total",team+"_over",v?.over,threshold,{teamTotalSide:team,alternateLadder:true});
     add("team_total",team+"_under",v?.under,threshold,{teamTotalSide:team,alternateLadder:true});
    }
   }else{
    const value=period.team_total?.[team],threshold=n(value?.points);if(threshold==null)continue;
    add("team_total",team+"_over",value.over,threshold,{teamTotalSide:team});
    add("team_total",team+"_under",value.under,threshold,{teamTotalSide:team});
   }
  }
 }
 return output;
}
/** No paid endpoints and no implicit retry; 24-hour full-board reconciliation. */
export async function collectPinnOddsPrematch(env,{sportId,purpose="routine",now=new Date(),full=false,fetchImpl=fetch}={}){
 if(!env?.PINNODDS_API_KEY)return {ok:false,reason:"CREDENTIAL_NOT_CONFIGURED"};
 const db=env.DB,id=Number(sportId);
 if(!db?.prepare)return {ok:false,reason:"D1_UNAVAILABLE"};
 if(!SPORT_IDS.includes(id))return {ok:false,reason:"UNSUPPORTED_SPORT"};
 const prior=await db.prepare("SELECT provider_cursor,last_full_at FROM pinnodds_feed_state WHERE sport_id=?").bind(id).first();
 const isFull=Boolean(full||!prior?.last_full_at||Date.parse(prior.last_full_at)<now.getTime()-86400000||prior?.provider_cursor==null);
 const reservation=await reservePinnOddsRequest(db,{sportId:id,purpose,now});
 if(!reservation.ok)return {ok:false,reason:reservation.reason,sportId:id};
 const outcome={status:"FAILED",eventCount:0,offerCount:0};
 try{
  const url=new URL("https://pinnodds.com/kit/v1/prematch/fixtures");url.searchParams.set("sport_id",String(id));url.searchParams.set("include_specials","1");
  if(!isFull)url.searchParams.set("since",String(prior.provider_cursor));
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),22000);
  let response;try{response=await fetchImpl(url.toString(),{headers:{"x-api-key":env.PINNODDS_API_KEY,"x-portal-apikey":env.PINNODDS_API_KEY,Accept:"application/json"},signal:abort.signal})}finally{clearTimeout(timer)}
  outcome.httpStatus=response.status;
  if(response.status===429){
   const raw=response.headers.get("retry-after"),sec=raw==null?NaN:Number(raw),until=Date.parse(raw||"");
   outcome.retryAfterUntil=Number.isFinite(sec)&&sec>=0?new Date(now.getTime()+Math.min(sec,86400)*1000).toISOString():Number.isFinite(until)&&until>now.getTime()?new Date(until).toISOString():new Date(now.getTime()+3600000).toISOString();
   outcome.errorCode="RATE_LIMITED";return {ok:false,reason:"RATE_LIMITED",sportId:id};
  }
  if(!response.ok){outcome.errorCode="HTTP_"+response.status;return {ok:false,reason:outcome.errorCode,sportId:id}}
  const status=clean(response.headers.get("x-data-status")).toLowerCase(),board=clean(response.headers.get("x-data-board")).toLowerCase();
  const age=n(response.headers.get("x-data-age-ms"));outcome.dataStatus=status||"unknown";outcome.dataAgeMs=age;
  if(status!=="fresh"||board!=="prematch"||age==null||age<0||age>300000){
   outcome.status="WITHHELD";outcome.errorCode="STALE_UNKNOWN_OR_WRONG_BOARD";
   return {ok:false,reason:outcome.errorCode,dataStatus:status,dataAgeMs:age,sportId:id};
  }
  const data=await response.json(),cursor=Number(data?.last);
  if(!Array.isArray(data?.events)||!Number.isSafeInteger(cursor)||cursor<0){outcome.errorCode="INVALID_ENVELOPE_OR_CURSOR";return {ok:false,reason:outcome.errorCode,sportId:id}}
  if(!isFull&&cursor<Number(prior.provider_cursor)){outcome.errorCode="CURSOR_REGRESSION";return {ok:false,reason:outcome.errorCode,sportId:id}}
  const sports=PINNODDS_SPORTS[id],placeholders=sports.map(()=>"?").join(",");
  const games=await db.prepare(`SELECT id,sport,start,home_name,away_name FROM games WHERE sport IN (${placeholders}) AND start BETWEEN ? AND ?`)
   .bind(...sports,new Date(now.getTime()-7200000).toISOString(),new Date(now.getTime()+14*86400000).toISOString()).all();
  let matched=0,unmatched=0,withdrawn=0,quarantinedSpecials=0;
  const seen=[],offers=[];
  for(const event of data.events){
   const eventId=clean(event?.event_id);if(!eventId)continue;seen.push(eventId);
   if(event?.special||event?.special_category){
     // Specials have independent settlement/player identity. Never attach to a
     // parent game merely because the home/away label looks similar.
     quarantinedSpecials++;continue;
   }
   const match=matchPinnOddsEvent(event,games?.results||[],id,now.getTime());
   if(match.eventId){matched++;offers.push(...normalizePinnOddsEvent(event,id,{match,capturedAt:reservation.stamp,dataAgeMs:age}))}
   else unmatched++;
  }
  outcome.eventCount=data.events.length;outcome.offerCount=offers.length;
  const persisted=offers.length?(await persistNormalizedMarketBatch(db,offers,{snapshotType:"CURRENT",collectedAt:reservation.stamp,modelProbability:null})).inserted:0;
  // Complete healthy FULL boards only. Never infer fixture withdrawal from incremental empty.
  if(isFull){
   const priorFixtures=await db.prepare("SELECT provider_event_id FROM pinnodds_fixture_state WHERE sport_id=? AND active=1").bind(id).all();
   const current=new Set(seen);
   for(const previous of priorFixtures?.results||[]){
    if(current.has(String(previous.provider_event_id)))continue;
    await db.prepare("UPDATE pinnodds_fixture_state SET active=0,withdrawn_at=?,updated_at=? WHERE sport_id=? AND provider_event_id=?")
     .bind(reservation.stamp,reservation.stamp,id,previous.provider_event_id).run();withdrawn++;
   }
  }
  for(const eventId of seen)await db.prepare(`INSERT INTO pinnodds_fixture_state(sport_id,provider_event_id,active,first_seen_at,last_seen_at,updated_at)
   VALUES(?,?,1,?,?,?) ON CONFLICT(sport_id,provider_event_id) DO UPDATE SET active=1,last_seen_at=excluded.last_seen_at,withdrawn_at=NULL,updated_at=excluded.updated_at`)
   .bind(id,eventId,reservation.stamp,reservation.stamp,reservation.stamp).run();
  await db.prepare(`INSERT INTO pinnodds_feed_state(sport_id,provider_cursor,last_full_at,last_success_at,last_checked_at,last_data_status,last_data_age_ms,last_event_count,last_offer_count,last_failure,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(sport_id) DO UPDATE SET provider_cursor=excluded.provider_cursor,last_full_at=coalesce(excluded.last_full_at,pinnodds_feed_state.last_full_at),last_success_at=excluded.last_success_at,last_checked_at=excluded.last_checked_at,last_data_status=excluded.last_data_status,last_data_age_ms=excluded.last_data_age_ms,last_event_count=excluded.last_event_count,last_offer_count=excluded.last_offer_count,last_failure=NULL,updated_at=excluded.updated_at`)
   .bind(id,cursor,isFull?reservation.stamp:null,reservation.stamp,reservation.stamp,status,age,data.events.length,offers.length,reservation.stamp).run();
  outcome.status="SUCCESS";
  return {ok:true,sportId:id,mode:isFull?"FULL":"INCREMENTAL",dataStatus:status,boardAgeMs:age,providerEvents:data.events.length,matchedEvents:matched,unmatchedEvents:unmatched,quarantinedSpecials,offers:offers.length,persisted,withdrawnEvents:withdrawn,canQualify:false,canAuthorizeWager:false};
 }catch(err){outcome.errorCode=err?.name==="AbortError"?"REQUEST_TIMEOUT":"COLLECT_OR_PERSIST_FAILED";return {ok:false,reason:outcome.errorCode,sportId:id}}
 finally{await finishPinnOddsRequest(db,reservation,outcome)}
}
