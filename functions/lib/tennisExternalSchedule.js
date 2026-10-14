/**
 * ESPN PUBLIC schedule evidence. Not ATP/WTA official authority.
 * Research-only source identities. Never modifies wagering or model authority.
 */
const SOURCE="ESPN_PUBLIC";
const tours=new Set(["atp","wta"]);
const normal=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const token=v=>/^[a-zA-Z0-9_-]{1,80}$/.test(String(v||""));
const iso=v=>{const ms=Date.parse(v||"");return Number.isFinite(ms)?new Date(ms).toISOString():null;};
function fullname(x){
 const n=String(x||"").trim();
 if(!n||n.includes("/")||n.includes("&")||normal(n).split(" ").length<2)return null;
 return n;
}
function competitorName(c){
 return fullname(c?.athlete?.displayName||c?.athlete?.fullName||c?.athlete?.name||
  c?.team?.displayName||c?.displayName||c?.name);
}
function eventList(body){
 return [...(Array.isArray(body?.events)?body.events:[]),
  ...(Array.isArray(body?.tournaments)?body.tournaments.flatMap(t=>t.events||[]):[])];
}
export function extractEspnTennisFixtures(body,{tour,fetchedAt}={}){
 if(!tours.has(tour)||!iso(fetchedAt))throw Error("INVALID_FIXTURE_CONTEXT");
 const events=eventList(body);
 if(!Array.isArray(body?.events)&&!Array.isArray(body?.tournaments))throw Error("ESPN_TENNIS_SCHEDULE_CONTRACT_CHANGED");
 const clock=Date.parse(fetchedAt),rows=[],seen=new Set(),reasons={};
 const reject=reason=>{reasons[reason]=(reasons[reason]||0)+1;};
 for(const e of events){
  if(!token(e?.id)){reject("EVENT_ID_UNVERIFIED");continue}
  // ESPN tennis scoreboards use tournament events containing round groupings.
  // Each grouping contains individual match competitions.
  const comps=[...(Array.isArray(e.competitions)?e.competitions:[]),
    ...(Array.isArray(e.groupings)?e.groupings.flatMap(g=>Array.isArray(g.competitions)?g.competitions:[]):[])];
  for(const c of comps){
   if(!token(c?.id)){reject("COMPETITION_ID_UNVERIFIED");continue}
   if(!Array.isArray(c?.competitors)||c.competitors.length!==2){reject("NOT_VERIFIED_SINGLES");continue}
   const names=c.competitors.map(competitorName);
   if(!names[0]||!names[1]||normal(names[0])===normal(names[1])){reject("PLAYER_IDENTITY_UNVERIFIED");continue}
   // A tournament start is not a match start. Only use competition date,
   // or event date if the event represents exactly one competition.
   const matchTime=iso(c.date||(comps.length===1?e.date:null));
   if(!matchTime){reject("MATCH_TIME_UNVERIFIED");continue}
   const ms=Date.parse(matchTime);
   if(ms<clock-8*3600000||ms>clock+72*3600000){reject("MATCH_OUTSIDE_WINDOW");continue}
   const state=String(c.status?.type?.state||e.status?.type?.state||"pre").toLowerCase();
   const status=state==="post"?"FINAL":state==="in"?"IN_PROGRESS":"SCHEDULED";
   if(status==="FINAL"){reject("COMPLETED");continue}
   const fixtureId="tennis:espn:"+tour+":"+String(e.id)+":"+String(c.id);
   if(seen.has(fixtureId)){reject("DUPLICATE");continue}seen.add(fixtureId);
   rows.push({fixtureId,source:SOURCE,tour,sourceEventId:String(e.id),sourceCompetitionId:String(c.id),
    matchTime,player1Name:names[0],player2Name:names[1],status,fetchedAt});
  }
 }
 return {rows,sourceEvents:events.length,reasons};
}
export async function captureEspnTennisSchedule(env,{tour,date,fetchImpl=fetch,now=new Date()}={}){
 if(!tours.has(tour)||!/^\d{8}$/.test(String(date||"")))throw Error("INVALID_SOURCE_SCOPE");
 if(!env?.ARCHIVE?.put||!env?.DB?.prepare)throw Error("DURABLE_STORAGE_REQUIRED");
 const captureTime=now.toISOString(),day=Date.UTC(Number(date.slice(0,4)),Number(date.slice(4,6))-1,Number(date.slice(6,8)));
 if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==date.slice(0,4)+"-"+date.slice(4,6)+"-"+date.slice(6,8)||
  day<Date.parse(captureTime.slice(0,10)+"T00:00:00Z")||day>Date.parse(captureTime.slice(0,10)+"T00:00:00Z")+2*86400000)
  throw Error("FIXTURE_DATE_OUTSIDE_ALLOWED_WINDOW");
 const url="https://site.api.espn.com/apis/site/v2/sports/tennis/"+tour+"/scoreboard?dates="+date;
 const response=await fetchImpl(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error("ESPN_PUBLIC_HTTP_"+response.status);
 const payload=await response.text();
 if(payload.length>2_000_000)throw Error("FIXTURE_PAYLOAD_TOO_LARGE");
 const body=JSON.parse(payload);
 const {rows,sourceEvents,reasons}=extractEspnTennisFixtures(body,{tour,fetchedAt:captureTime});
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload));
 const rawHash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
 const rawKey="tennis/external-fixtures/espn/raw/"+rawHash+".json";
 await env.ARCHIVE.put(rawKey,payload,{httpMetadata:{contentType:"application/json"}});
 const insertSql=[
 "INSERT INTO tennis_external_fixtures (",
 "fixture_id,source,tour,source_event_id,source_competition_id,match_time,",
 "player1_name,player2_name,status,fetched_at,raw_hash,raw_key,created_at,updated_at",
 ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
 "ON CONFLICT(fixture_id) DO UPDATE SET",
 "match_time=excluded.match_time,player1_name=excluded.player1_name,player2_name=excluded.player2_name,",
 "status=excluded.status,fetched_at=excluded.fetched_at,raw_hash=excluded.raw_hash,",
 "raw_key=excluded.raw_key,updated_at=excluded.updated_at"
 ].join(" ");
 let persisted=0;
 for(const row of rows){
  const result=await env.DB.prepare(insertSql)
    .bind(row.fixtureId,row.source,row.tour,row.sourceEventId,row.sourceCompetitionId,
     row.matchTime,row.player1Name,row.player2Name,row.status,captureTime,rawHash,rawKey,captureTime,captureTime).run();
  persisted+=Number(result?.meta?.changes||result?.changes||0);
 }
 return {ok:true,source:SOURCE,tour,date,capturedAt:captureTime,
  providerEvents:sourceEvents,verifiedFixtures:rows.length,persisted,
  rawHash,rawKey,rejections:reasons,researchOnly:true,
  officialSourceVerified:false,canQualify:false,canAuthorizeWager:false};
}
