import {oauthRoute,authorized,unauthorized,SCOPE} from './oauth.mjs';
import {requireJobAdmission} from '../account-budget/admission.mjs';
import {createExecutionLease, executionFetch} from '../account-budget/execution.mjs';
export const JOB='services/espn-mcp/worker.mjs';
export const UNITS={requests:1,responseBytes:4194304,d1Queries:0,reads:0,writes:0,r2Lists:0,r2Reads:0,r2Writes:0,r2Bytes:0};
export const LEAGUES={cfb:['football','college-football'],nba:['basketball','nba'],cbb:['basketball','mens-college-basketball'],nhl:['hockey','nhl'],nfl:['football','nfl'],mlb:['baseball','mlb'],wnba:['basketball','wnba']};
const league={type:'string',enum:Object.keys(LEAGUES)};
const pagination={offset:{type:'integer',minimum:0,maximum:1000},limit:{type:'integer',minimum:1,maximum:100}};
export const TOOLS=[
 {name:'espn_scoreboard',description:'ESPN schedules, scores, team IDs and game statuses. Explicit YYYYMMDD date, default America/Chicago today. Paginated compact events, no model or wager authority.',inputSchema:{type:'object',properties:{league,date:{type:'string',pattern:'^[0-9]{8}$'},...pagination},required:['league'],additionalProperties:false}},
 {name:'espn_summary',description:'ESPN game header, teams, scores, status, scoring plays and team statistics. Requires numeric ESPN event ID.',inputSchema:{type:'object',properties:{league,event:{type:'string',pattern:'^[0-9]{6,15}$'}},required:['league','event'],additionalProperties:false}},
 {name:'espn_teams',description:'ESPN team identity directory with pagination and explicit coverage metadata. College directory coverage is explicitly labeled; ESPN may include other divisions.',inputSchema:{type:'object',properties:{league,...pagination},required:['league'],additionalProperties:false}},
 {name:'fbis_espn_status',description:'ESPN connector configuration; no upstream request.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
].map(t=>({...t,securitySchemes:[{type:'oauth2',scopes:[SCOPE]}],_meta:{securitySchemes:[{type:'oauth2',scopes:[SCOPE]}]},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}}));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const result=(id,value)=>json({jsonrpc:'2.0',id,result:value});
const rpcError=(id,code,message)=>json({jsonrpc:'2.0',id,error:{code,message}});
const content=(payload,isError=false)=>({...(isError?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(payload)}]});
const status=s=>s?{clock:s.clock??null,displayClock:s.displayClock??null,period:s.period??null,type:s.type??null}:null;
export function competition(c){return {id:c.id??null,date:c.date??null,neutralSite:c.neutralSite??null,status:status(c.status),competitors:(c.competitors||[]).map(x=>({id:x.id??null,homeAway:x.homeAway??null,score:x.score??null,scoreAvailable:c.status?.type?.state!=='pre'&&x.score!=null,winner:x.winner??null,team:team(x.team||{})}))};}
function team(t){return {id:t.id??null,uid:t.uid??null,slug:t.slug??null,abbreviation:t.abbreviation??null,displayName:t.displayName??null,shortDisplayName:t.shortDisplayName??null,logo:t.logo??t.logos?.[0]?.href??null};}
function event(e){return {id:e.id??null,uid:e.uid??null,date:e.date??null,name:e.name??null,shortName:e.shortName??null,status:status(e.status),competitions:(e.competitions||[]).map(competition)};}
const chicagoDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
function validDate(s){if(!/^\d{8}$/.test(s))return false;const d=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10).replaceAll('-','')===s;}
export function requestSpec(name,a){
 const tool=TOOLS.find(t=>t.name===name);if(!tool)throw Error('UNKNOWN_TOOL');
 if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!Object.hasOwn(tool.inputSchema.properties,k)))throw Error('INVALID_ARGUMENTS');
 if(name==='fbis_espn_status')return null;
 if(!Object.hasOwn(LEAGUES,a.league))throw Error('SUPPORTED_LEAGUE_REQUIRED');
 const [sport,league]=LEAGUES[a.league];const action=name==='espn_scoreboard'?'scoreboard':name==='espn_teams'?'teams':'summary';
 const url=new URL(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/${action}`);
 const offset=a.offset??0,limit=a.limit??100;
 if(!Number.isInteger(offset)||offset<0||offset>1000||!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_PAGINATION');
 let date;
 if(action==='scoreboard'){date=a.date??chicagoDay();if(typeof date!=='string'||!validDate(date))throw Error('INVALID_DATE');url.searchParams.set('dates',date);}
 if(action==='summary'){if(typeof a.event!=='string'||!/^\d{6,15}$/.test(a.event))throw Error('NUMERIC_EVENT_ID_REQUIRED');url.searchParams.set('event',a.event);}
 else {url.searchParams.set('limit','1000');if(a.league==='cfb')url.searchParams.set('groups','80');if(a.league==='cbb')url.searchParams.set('groups','50');}
 return {url,action,date,offset,limit};
}
export async function callTool(name,a,env,{fetchImpl=fetch,admit=requireJobAdmission}={}){
 const spec=requestSpec(name,a);
 if(!spec)return content({source:'ESPN unofficial public API',version:'1.2.1',readOnly:true,scheduledPolling:false,wagerAuthority:false,budgetBindingConfigured:!!env.FBIS_ACCOUNT_BUDGET,timeZone:'America/Chicago',leagues:Object.keys(LEAGUES)});
 const {url,action,date,offset,limit}=spec;const requestedAt=new Date().toISOString();let receivedAt=null,httpStatus=null;
 try{
  const admission=await admit(env,JOB,crypto.randomUUID());
  const lease=createExecutionLease(admission);
  // Enforce this connector's own caps even if a billing policy is misconfigured.
  const limits=Object.fromEntries(Object.entries(UNITS).map(([k,v])=>[k,Math.min(v,admission.maxUnits?.[k]??0)]));
  const bounded=createExecutionLease({...admission,maxUnits:limits});lease.live();
  const request=executionFetch(bounded,fetchImpl,{origin:url.origin,path:url.pathname});
  const r=await request(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(9000)});
  receivedAt=new Date().toISOString();httpStatus=r.status;
  const provenance={source:'ESPN',unofficial:true,sourceUrl:url.toString(),requestedAt,receivedAt,sourceHttpDate:r.headers.get('date'),sourceLastModified:r.headers.get('last-modified'),sourceAgeSeconds:r.headers.get('age'),httpStatus,league:a.league,date:date??null,timeZone:'America/Chicago',wagerAuthority:false};
  if(!r.ok){await r.body?.cancel();return content({...provenance,error:'UPSTREAM_HTTP_ERROR'},true);}
  if(!r.headers.get('content-type')?.includes('json')){await r.body?.cancel();return content({...provenance,error:'UPSTREAM_NON_JSON'},true);}
  const data=await r.json();const base={...provenance,sourceUpdatedAt:data.lastUpdated??data.meta?.lastUpdated??null};
  if(action==='summary'){
   if(!data.header?.id||!Array.isArray(data.header?.competitions)||!data.header.competitions.length)return content({...base,error:'UPSTREAM_SUMMARY_SCHEMA_INVALID'},true);
   if(String(data.header.id)!==a.event)return content({...base,error:'UPSTREAM_EVENT_ID_MISMATCH'},true);
   return content({...base,data:{header:event(data.header),scoringPlays:(data.scoringPlays||[]).map(p=>({id:p.id??null,text:p.text??null,homeScore:p.homeScore??null,awayScore:p.awayScore??null,period:p.period??null,clock:p.clock??null})),teamStatistics:(data.boxscore?.teams||[]).map(t=>({team:team(t.team||{}),statistics:t.statistics||[]}))},sectionsProvided:['header','scoringPlays','teamStatistics']});
  }
  const rows=action==='scoreboard'?data.events:data.sports?.[0]?.leagues?.[0]?.teams;
  if(!Array.isArray(rows))return content({...base,error:'UPSTREAM_SCHEMA_INVALID'},true);
  const items=rows.map(action==='scoreboard'?event:x=>team(x.team||x));
  const shown=items.slice(offset,offset+limit),nextOffset=offset+shown.length<items.length?offset+shown.length:null;
  return content({...base,totalRetrieved:items.length,shown:shown.length,offset,nextOffset,truncated:nextOffset!==null,upstreamLimit:1000,upstreamMayBeTruncated:items.length>=1000,coverage:action==='teams'&&a.league==='cfb'?'ESPN college football directory (all divisions; groups filter not honored upstream)':a.league==='cfb'?'FBS (ESPN group 80)':a.league==='cbb'?'Division I schedule/directory (ESPN group 50; schedule may include non-DI opponents)':'league',data:action==='scoreboard'?{events:shown}:{teams:shown}});
 }catch(e){return content({source:'ESPN',sourceUrl:url.toString(),league:a.league,requestedAt,receivedAt,httpStatus,error:e?.name==='TimeoutError'||e?.name==='AbortError'?'UPSTREAM_TIMEOUT':e.message||'CONNECTOR_FAILURE',wagerAuthority:false},true);}
}
export default {async fetch(req,env){
 const oauth=await oauthRoute(req,env);if(oauth)return oauth;
 if(new URL(req.url).pathname!=='/mcp')return new Response('Not found',{status:404});
 if(req.method==='GET'&&!await authorized(req,env))return unauthorized();
 if(req.method==='GET')return new Response(null,{status:405,headers:{allow:'POST'}});
 if(req.method!=='POST')return new Response(null,{status:405,headers:{allow:'POST'}});
 if(Number(req.headers.get('content-length')||0)>16384)return new Response('Request too large',{status:413});
 let m;try{const body=await req.text();if(body.length>16384)return new Response('Request too large',{status:413});m=JSON.parse(body);}catch{return rpcError(null,-32700,'Invalid JSON');}
 if(!m||Array.isArray(m)||m.jsonrpc!=='2.0'||typeof m.method!=='string')return rpcError(null,-32600,'Invalid request');
 if(m.id==null&&m.method.startsWith('notifications/'))return new Response(null,{status:202});
 if(m.id==null)return rpcError(null,-32600,'Request id required');
 if(m.method==='initialize')return result(m.id,{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'FBIS ESPN',version:'1.2.1'}});
 if(m.method==='ping')return result(m.id,{});
 if(m.method==='tools/list')return result(m.id,{tools:TOOLS});
 if(m.method!=='tools/call')return rpcError(m.id,-32601,'Method not found');
 if(!await authorized(req,env))return unauthorized();
 try{return result(m.id,await callTool(m.params?.name,m.params?.arguments??{},env));}catch(e){return rpcError(m.id,-32602,e.message);}
}};
