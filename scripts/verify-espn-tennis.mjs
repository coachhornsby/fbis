// One-shot, bounded ESPN tennis verification. No polling or wager/model changes.
import {writeFile} from 'node:fs/promises';
const endpoint='https://fbis-espn-mcp.coachhornsby.workers.dev/mcp';const token=process.env.FBIS_ESPN_MCP_TOKEN;if(!token)throw Error('FBIS_ESPN_MCP_TOKEN required');
const date=process.env.FBIS_ESPN_DATE||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
const report={date,timeZone:'America/Chicago',startedAt:new Date().toISOString(),checks:[],failures:[],sports:[]};let id=0;
const check=(name,ok,detail={})=>{report.checks.push({name,ok,...detail});if(!ok)report.failures.push({name,...detail});};
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('MCP_HTTP_'+r.status);const p=await r.json();if(p.error)throw Error(p.error.message);return p.result;}
async function call(name,args){const r=await rpc('tools/call',{name,arguments:args});const p=JSON.parse(r.content[0].text);if(r.isError)throw Error(p.error||'MCP_TOOL_ERROR');return p;}
try{
 const tools=(await rpc('tools/list',{})).tools;check('Tennis tools advertised',tools.some(t=>t.name==='espn_tennis_scoreboard')&&tools.some(t=>t.name==='espn_tennis_match'));
 check('Read-only scope preserved',tools.every(t=>t.securitySchemes[0].scopes[0]==='espn:read'&&t.annotations.readOnlyHint===true));
 const status=await call('fbis_espn_status',{});report.status=status;check('Tennis capability status',status.version==='1.3.0'&&status.tennis?.supported===true);
 for(const tour of ['atp','wta']){
  const s={tour,draws:[]};report.sports.push(s);
  for(const match_type of ['singles','doubles']){
   const pages=[];let offset=0;do{const p=await call('espn_tennis_scoreboard',{tour,date,match_type,offset,limit:25});pages.push(p);offset=p.nextOffset;}while(offset!==null);
   const matches=pages.flatMap(p=>p.data.matches);const draw={matchType:match_type,total:matches.length,pages,matchesWithStatistics:matches.filter(m=>m.competitors.some(c=>c.statistics.length)).length};s.draws.push(draw);
   check(tour+' '+match_type+' scoreboard',pages.every(p=>p.httpStatus===200)&&matches.length===pages[0].totalRetrieved,{matches:matches.length});
   check(tour+' '+match_type+' participant IDs',matches.every(m=>m.competitors.length===2&&m.competitors.every(c=>c.players.length===(match_type==='singles'?1:2)&&c.players.every(p=>/^[1-9]\d*$/.test(p.id)&&p.displayName!=='TBD'))));
   check(tour+' '+match_type+' match dates',matches.every(m=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(m.date)).replaceAll('-','')===date));
   check(tour+' '+match_type+' final scores',matches.filter(m=>m.status?.type?.completed).every(m=>m.competitors.every(c=>c.scoreAvailable&&c.sets.length>0)));
   const sample=matches[0];if(sample){draw.matchSample=await call('espn_tennis_match',{tour,date,tournament_id:sample.tournamentId,competition_id:sample.competitionId});check(tour+' '+match_type+' detail identity',draw.matchSample.data.match.id===sample.id);}
  }
 }
 const nba=await call('espn_scoreboard',{league:'nba',date,limit:1});check('Existing NBA scoreboard regression',nba.httpStatus===200&&Array.isArray(nba.data.events));
}catch(e){report.failures.push({error:e.message});}
report.completedAt=new Date().toISOString();await writeFile(process.env.FBIS_ESPN_TENNIS_REPORT||'/tmp/fbis-espn-tennis-verification.json',JSON.stringify(report,null,2));
for(const c of report.checks)console.log(c.name+': '+(c.ok?'PASS':'FAIL')+(c.matches!==undefined?' ('+c.matches+' matches)':''));console.log('Failures: '+report.failures.length);if(report.failures.length)process.exitCode=1;
