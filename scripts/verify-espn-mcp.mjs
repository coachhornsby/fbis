// One-shot verification only. No schedules, model changes, or wagering actions.
import {writeFile} from 'node:fs/promises';
const url=process.env.FBIS_ESPN_MCP_URL||'https://fbis-espn-mcp.coachhornsby.workers.dev/mcp';
const token=process.env.FBIS_ESPN_MCP_TOKEN;if(!token)throw Error('FBIS_ESPN_MCP_TOKEN required');
const date=process.env.FBIS_ESPN_DATE||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
let id=0;const failures=[];
async function rpc(method,params){const r=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`HTTP_${r.status}`);const x=await r.json();if(x.error)throw Error(JSON.stringify(x.error));return x.result;}
async function call(name,args){try{const x=await rpc('tools/call',{name,arguments:args});const p=JSON.parse(x.content[0].text);if(x.isError){failures.push({name,args,...p});return null;}return p;}catch(e){failures.push({name,args,error:e.message});return null;}}
const report={date,timeZone:'America/Chicago',startedAt:new Date().toISOString(),endpoint:url,failures,sports:[]};
report.initialize=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'FBIS ESPN one-shot audit',version:'1.1.0'}});
report.tools=(await rpc('tools/list',{})).tools.map(x=>x.name);
report.sourceStatus=await call('fbis_espn_status',{});
for(const league of ['cfb','nba','cbb','nhl']){
 const s={league,scoreboardPages:[],directoryPages:[]};report.sports.push(s);let offset=0;
 do{const p=await call('espn_scoreboard',{league,date,offset});if(!p)break;s.scoreboardPages.push(p);offset=p.nextOffset;}while(offset!==null);
 const events=s.scoreboardPages.flatMap(p=>p.data.events);
 offset=0;do{const p=await call('espn_teams',{league,offset});if(!p)break;s.directoryPages.push(p);offset=p.nextOffset;}while(offset!==null);
 const teams=s.directoryPages.flatMap(p=>p.data.teams),ids=new Set(teams.map(t=>String(t.id)));
 s.eventCount=events.length;s.teamCount=teams.length;s.statusCounts={};s.directoryMissingCompetitors=[];
 for(const e of events){const state=e.status?.type?.name||'MISSING';s.statusCounts[state]=(s.statusCounts[state]||0)+1;if(!e.id||!e.date||!e.status?.type)failures.push({league,event:e.id,error:'MISSING_EVENT_FIELDS'});for(const c of e.competitions){if(c.competitors.length!==2)failures.push({league,event:e.id,error:'MISSING_COMPETITORS'});for(const x of c.competitors){if(!x.team.id||!x.team.displayName)failures.push({league,event:e.id,error:'MISSING_TEAM_IDENTITY'});if(!ids.has(String(x.team.id)))s.directoryMissingCompetitors.push({event:e.id,id:x.team.id,name:x.team.displayName});if(c.status?.type?.state!=='pre'&&x.score==null)failures.push({league,event:e.id,error:'MISSING_LIVE_OR_FINAL_SCORE'});}}}
 const selected=events.find(e=>e.status?.type?.state!=='pre')||events[0];if(selected)s.summary=await call('espn_summary',{league,event:selected.id});
 if(s.summary?.data.header.id!==selected?.id)failures.push({league,error:'SUMMARY_EVENT_MISMATCH'});
 s.timestampCoverage=s.scoreboardPages.map(p=>({receivedAt:p.receivedAt,sourceHttpDate:p.sourceHttpDate,sourceLastModified:p.sourceLastModified,sourceUpdatedAt:p.sourceUpdatedAt}));
 console.log(JSON.stringify({league,events:s.eventCount,teams:s.teamCount,status:s.statusCounts,directoryMissing:s.directoryMissingCompetitors.length,summary:!!s.summary}));
}
report.completedAt=new Date().toISOString();await writeFile(process.env.FBIS_ESPN_REPORT||'/tmp/fbis-espn-verification.json',JSON.stringify(report,null,2));console.log('API failures:',failures.length);if(failures.length)process.exitCode=1;
