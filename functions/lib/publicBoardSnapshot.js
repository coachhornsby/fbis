// Public scoreboard publication. No databases, provider credentials, model inference,
// odds acquisition, persistence or wager authorization are reachable from this module.
export const PUBLIC_SPORTS = Object.freeze(['nfl','cfb','nba','cbb','nhl','mlb','tennis']);
export const SCOREBOARD_SOURCES = Object.freeze([
  ['nfl','football/nfl'],['cfb','football/college-football'],
  ['nba','basketball/nba'],['cbb','basketball/mens-college-basketball'],
  ['nhl','hockey/nhl'],['mlb','baseball/mlb'],
  ['tennis','tennis/atp','atp'],['tennis','tennis/wta','wta'],
]);
export const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
export function boardDate(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
}
export function shiftBoardDate(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('INVALID_BOARD_DATE');
  const d = new Date(date+'T12:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0,10)!==date) throw Error('INVALID_BOARD_DATE');
  d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}
const number = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
function participant(row, sport) {
  const t = row.team || row.athlete;
  if (!(t?.id || row.id) || !t.displayName) return null;
  const logo = t.logo || t.headshot?.href;
  return {sport, name:t.displayName,fullName:t.displayName,abbr:t.abbreviation||t.shortName||null,
    espnId:String(t.id || row.id),providerTeamId:String(t.id || row.id),
    logo:typeof logo==='string' && logo.startsWith('https://a.espncdn.com/')?logo:null,
    score:number(row.score),color:t.color||null};
}
export function scoreboardGames(payload, {sport,tour=null,date,capturedAt}) {
  if (!PUBLIC_SPORTS.includes(sport) || !Array.isArray(payload?.events)) throw Error('INVALID_SCOREBOARD');
  if (payload.events.length >= 500) throw Error('SCOREBOARD_TRUNCATED');
  const out = [];
  for (const event of payload.events) for (const c of (sport==='tennis'?(event.groupings||[]).filter(g=>g.grouping?.slug===`${tour==='wta'?'womens':'mens'}-singles`).flatMap(g=>g.competitions||[]):event.competitions||[])) {
    const start = c.date || event.date;
    if (!Number.isFinite(Date.parse(start)) || boardDate(start)!==date) continue;
    const rows=c.competitors||[];
    // Doubles and tournament containers are not individual singles fixtures.
    if (rows.length!==2 || (sport==='tennis' && rows.some(r=>!r.athlete))) continue;
    const h=rows.find(r=>r.homeAway==='home')||(sport==='tennis'?rows[0]:null);
    const a=rows.find(r=>r.homeAway==='away')||(sport==='tennis'?rows[1]:null);
    const home=h&&participant(h,sport),away=a&&participant(a,sport);
    if(!home||!away||home.espnId===away.espnId||!/^\d+$/.test(String(c.id||event.id))) continue;
    const s=c.status||event.status, type=s?.type;
    if (!type?.state) continue;
    const status=type.completed?'final':type.state==='in'?'live':
      /postpon/i.test(type.name||'')?'postponed':/cancel/i.test(type.name||'')?'cancelled':'scheduled';
    // Pregame score zeros are placeholders, not observed results.
    if(type.state==='pre'){home.score=null;away.score=null;}
    out.push({id:String(c.id||event.id),sport,tour,date,start,home,away,status,neutralSite:typeof c.neutralSite==='boolean'?c.neutralSite:null,
      statusDetail:type.detail||type.description||status,statusPeriod:s.period??null,statusClock:s.displayClock||null,
      capturedAt,source:'ESPN_SCOREBOARD',sourceEventUrl:event.links?.find(l=>l.rel?.includes('summary'))?.href||null,
      projectionUnavailable:true,marketUnavailable:true,projectionKind:'UNAVAILABLE',projectionState:'SCHEDULE_ONLY',
      projectionDisplayLabel:'Projection unavailable',pureProjectionAvailable:false,model:null,
      rec:null,lean:null,odds:{},playerMarkets:[],playerProjectionRows:[],quality:{score:null,flags:['projections_paused','markets_paused']},
      qualificationBlocked:true,bettingAllowed:false,canQualify:false,canAuthorizeWager:false,
      noPlayReason:'Prediction and market pipelines remain paused. Schedule and scores only.'});
  }
  return out;
}
export async function boundedScoreboardFetch(url, {fetchFn=fetch,signal}={}) {
  if (!url.startsWith('https://site.api.espn.com/apis/site/v2/sports/')) throw Error('SOURCE_NOT_ALLOWED');
  const response=await fetchFn(url,{signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('ESPN_HTTP_'+response.status);
  const limit=4*1024*1024;
  if(Number(response.headers.get('content-length'))>limit)throw Error('SCOREBOARD_TOO_LARGE');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
    if(bytes>limit){await reader.cancel();throw Error('SCOREBOARD_TOO_LARGE');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const raw=new Uint8Array(bytes);let pos=0;for(const chunk of chunks){raw.set(chunk,pos);pos+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(raw));
}
export async function captureScoreboards({date=boardDate(),fetchFn=fetch,signal,now=Date.now()}={}) {
  // Sixteen fixed calls maximum, no retries, no provider discovery or pagination.
  // Two adjacent UTC days cover the entire selected Central day, including DST.
  const end=shiftBoardDate(date,1),stamp=d=>d.replaceAll('-',''),capturedAt=new Date(now).toISOString();
  const results=[], requests=SCOREBOARD_SOURCES.flatMap(([sport,path,tour])=>[date,end].map(day=>[sport,path,tour,day]));
  for(let i=0;i<requests.length;i+=4){
    const batch=await Promise.all(requests.slice(i,i+4).map(async([sport,path,tour,day])=>{
      const url=`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${stamp(day)}&limit=500${['cbb','cfb'].includes(sport)?'&groups=50':''}`;
      try{const data=await boundedScoreboardFetch(url,{fetchFn,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
        return {sport,tour,capturedAt,games:scoreboardGames(data,{sport,tour,date,capturedAt}),url,ok:true};}
      catch(error){return {sport,tour,capturedAt,games:[],url,ok:false,error:String(error.message||error)};}
    }));results.push(...batch);
  }
  return assemblePublicBoard(results,{date,capturedAt});
}
export function assemblePublicBoard(results,{date,capturedAt}) {
  const games=[...new Map(results.flatMap(r=>r.games).map(g=>[g.sport+':'+g.tour+':'+g.id,g])).values()].sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
  const feeds=Object.fromEntries(PUBLIC_SPORTS.map(sport=>{const r=results.filter(x=>x.sport===sport);return [sport,{ok:r.length>0&&r.every(x=>x.ok),source:'ESPN_SCOREBOARD',capturedAt,
    error:r.filter(x=>!x.ok).map(x=>x.error).join('; ')||null,n:games.filter(g=>g.sport===sport).length}];}));
  return {version:1,date,timezone:'America/Chicago',generatedAt:capturedAt,expiresAt:new Date(Date.parse(capturedAt)+SNAPSHOT_MAX_AGE_MS).toISOString(),
    publicationMode:'SCHEDULE_AND_SCORES_ONLY',games,feeds,
    groups:PUBLIC_SPORTS.map(sport=>({sport,label:sport.toUpperCase(),games:games.filter(g=>g.sport===sport),error:feeds[sport].error})),
    counts:{games:games.length,qualified:0,leans:0,bySport:Object.fromEntries(PUBLIC_SPORTS.map(s=>[s,feeds[s].n]))},
    canQualify:false,canAuthorizeWager:false,
    costContract:{publicD1Queries:0,publicCloudflareFunctions:0,paidModelCalls:0},
    sources:results.map(({games,...r})=>({...r,count:games.length}))};
}
