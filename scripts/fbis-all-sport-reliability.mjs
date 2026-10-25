#!/usr/bin/env node
/** FBIS all-sport production audit. Safe recovery = one retry of source reads;
 * no price fabrication, shadow promotion, betting, migrations or paid harvests.
 */
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {assessFbisCoverage} from './lib/fbisCoveragePolicy.mjs';
const BASE=process.env.FBIS_BASE_URL||'https://fbis-myz.pages.dev';
const sports=['nfl','cfb','nba','wnba','nhl','mlb','cbb','soccer','tennis','npb','kbo'];
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const parse=async path=>{
 const uri=BASE+path+(path.includes('?')?'&':'?')+'_t='+Date.now();
 for(let attempt=0;attempt<2;attempt++){
  try{const response=await fetch(uri,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(35000)});
   const body=await response.json();
   if(!response.ok||body.ok===false)throw Error('HTTP_'+response.status);
   return body;
  }catch(e){if(attempt===1)return {ok:false,error:String(e.message).slice(0,120)};}
 }
};
const now=Date.now();
const board=await parse('/api/today?date='+date);
const models={},contracts={};
await Promise.all(sports.map(async sport=>{
 const params=new URLSearchParams({sport,date});
 const [m,c]=await Promise.all([parse('/api/prop-projections?'+params),parse('/api/exchange-player-props?'+params)]);
 models[sport]=m;contracts[sport]=c;
}));
const report=assessFbisCoverage({board,models,contracts,now});
if(!Array.isArray(board.games)||board.error)report.incidents.unshift({code:'GAME_BOARD_UNAVAILABLE',detail:String(board.error||'No board games array')});
report.ok=report.incidents.length===0;
report.date=date;report.scope=sports;report.transport={gameBoard:board.ok!==false,
 modelFailures:sports.filter(s=>models[s].ok===false),exchangeFailures:sports.filter(s=>contracts[s].ok===false)};
report.recovery={attempts:'ONE_IDEMPOTENT_READ_RETRY',writes:0,priceOverrides:0,modelOverrides:0,
 reason:'Collectors remain controlled by existing provider-specific budgeted workflows'};
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/fbis-all-sport-reliability.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,date,summary:report.summary,incidentCount:report.incidents.length,
 sample:report.incidents.slice(0,25),recovery:report.recovery},null,2));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
 '## FBIS all-sport coverage\n\n'+sports.join(', ')+'\n\n'+JSON.stringify(report.summary)+'\n\nIncidents: '+report.incidents.length+'\n');
if(!report.ok)process.exitCode=1;
