/** Public, read-only team-specific scoreboard and AP poll. Never model-authoritative. */
const BASE="https://site.api.espn.com/apis/site/v2/sports/football/college-football/";
async function publicJson(url,fetchFn=fetch){
 const res=await fetchFn(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(9000)});
 if(!res.ok)throw Error("ESPN_HTTP_"+res.status);
 const raw=await res.arrayBuffer();
 if(raw.byteLength>2*1024*1024)throw Error("ESPN_RESPONSE_OVERSIZE");
 return JSON.parse(new TextDecoder().decode(raw));
}
const score=x=>{const v=x&&typeof x==="object"?(x.value??x.displayValue??x.score):x;return v!=null&&v!==""&&Number.isFinite(Number(v))?Number(v):null;};
export function parseCfbTeamSchedule(payload,teamId,season){
 const events=Array.isArray(payload?.events)?payload.events:[];
 const out=new Map();
 for(const event of events){
  const c=event?.competitions?.[0],sides=c?.competitors;
  if(!Array.isArray(sides)||sides.length!==2)continue;
  const own=sides.find(v=>String(v?.team?.id)===String(teamId));
  if(!own)continue;
  const opp=sides.find(v=>v!==own);
  const home=own.homeAway==="home",neutral=!!c.neutralSite;
  const status=c.status||event.status||{};
  const complete=(status.type?.completed===true || status.type?.name==="STATUS_FINAL" || event.status?.type?.completed===true || event.status?.type?.name==="STATUS_FINAL");
  const ownScore=complete?score(own.score):null,oppScore=complete?score(opp.score):null;
  const scored=complete&&ownScore!==null&&oppScore!==null;
  const outcome=scored?(ownScore>oppScore?"W":ownScore<oppScore?"L":"T"):null;
  const id=String(event.id||"");
  if(!/^\d+$/.test(id))continue;
  const date=event.date||c.date||null;
  const year=Number(payload?.season?.year);
  if(Number.isFinite(year)&&year!==Number(season))continue;
  out.set(id,{id,date:date?date.slice(0,10):null,kickoff:date,
   location:neutral?"NEUTRAL":home?"HOME":"AWAY",opponent:opp.team?.displayName||opp.team?.name||null,
   opponentAbbr:opp.team?.abbreviation||null,opponentId:String(opp.team?.id||""),
   status:status.type?.name||null,completed:complete,week:event.week?.number||null,
   result:outcome,pointsFor:scored?ownScore:null,pointsAgainst:scored?oppScore:null,
   source:"ESPN_TEAM_SCHEDULE",verifiedResult:scored});
 }
 return [...out.values()].sort((a,b)=>String(a.kickoff).localeCompare(String(b.kickoff)));
}
export function parseCfbApRanking(payload,teamId,season){
 const polls=payload?.rankings||[];
 const ap=polls.find(p=>p.type==="ap"||/AP Top 25|AP Poll/i.test(p.name||p.shortName||""));
 const entry=ap?.ranks?.find(r=>String(r.team?.id)===String(teamId));
 return {poll:"AP Top 25",rank:entry && Number.isInteger(Number(entry.current))?Number(entry.current):null,
  ranked:!!entry,season,week:ap?.occurrence?.number||payload?.latestWeek?.number||null,
  asOf:ap?.date||payload?.latestWeek?.startDate||null,
  state:ap?"AVAILABLE":"POLL_UNAVAILABLE",source:"ESPN_AP_POLL",modelAuthority:false};
}
export async function loadCfbPublicTeamFacts(espnId,season,fetchFn=fetch){
 if(!/^\d{1,12}$/.test(String(espnId))||!Number.isInteger(Number(season)))throw Error("Invalid team/season");
 const [schedule,poll]=await Promise.allSettled([
  publicJson(BASE+"teams/"+espnId+"/schedule?season="+season+"&limit=100",fetchFn),
  publicJson(BASE+"rankings?season="+season,fetchFn)]);
 return {
  schedule:schedule.status==="fulfilled"
   ?(()=>{const games=parseCfbTeamSchedule(schedule.value,espnId,season);return {state:"AVAILABLE",games,count:games.length,
    source:"ESPN_TEAM_SCHEDULE",provenance:"ESPN public team event feed; final scores require STATUS_FINAL"};})()
   :{state:"SOURCE_UNAVAILABLE",games:[],count:0,source:"ESPN_TEAM_SCHEDULE",reason:String(schedule.reason?.message||"SOURCE_FAILURE")},
  apRanking:poll.status==="fulfilled"
   ?parseCfbApRanking(poll.value,espnId,season)
   :{poll:"AP Top 25",rank:null,ranked:false,season,week:null,asOf:null,state:"SOURCE_UNAVAILABLE",source:"ESPN_AP_POLL",modelAuthority:false}
 };
}
