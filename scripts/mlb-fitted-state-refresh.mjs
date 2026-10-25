import fs from 'node:fs/promises';
import {emptyFittedState,advanceFittedState} from '../functions/lib/mlbFittedRuntime.js';
if(!process.env.HARVEST_SECRET)throw Error('HARVEST_SECRET_REQUIRED');
const endpoint='https://fbis-myz.pages.dev/api/mlb-completion',out='artifacts/mlb-fitted-state';await fs.mkdir(out,{recursive:true});
async function post(body){let error;for(let n=0;n<3;n++){try{const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}),b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'FITTED_STATE_REQUEST_FAILED');return b;}catch(e){error=e;}}throw error;}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
if(today>'2026-11-05'){console.log(JSON.stringify({skipped:'POSTSEASON_WINDOW_COMPLETE',today}));process.exit(0);}
let state=(await post({operation:'fitted-state-read',date:today})).bundle?.state||emptyFittedState(),days=0;
state.pitchers={};state.batters={};const existingIds=Object.keys(state.playerShards||{});
for(let i=0;i<existingIds.length;i+=30){const r=await post({operation:'fitted-state-read',date:today,playerIds:existingIds.slice(i,i+30)});for(const p of r.players){state.pitchers[p.playerId]=p.pitcherDays;state.batters[p.playerId]=p.batterDays;}}
delete state.playerShards;
while(state.throughExclusive<today){const date=state.throughExclusive;state=advanceFittedState(state,await post({operation:'training-day',date}));days++;if(days%20===0)console.log(JSON.stringify({throughExclusive:state.throughExclusive,days}));}
if(state.throughExclusive!==today)throw Error('STATE_HORIZON_MISMATCH');
const playerIds=[...new Set([...Object.keys(state.pitchers),...Object.keys(state.batters)])],playerShards={};
for(let i=0;i<playerIds.length;i+=30){const players=playerIds.slice(i,i+30).map(playerId=>({playerId,pitcherDays:state.pitchers[playerId]||[],batterDays:state.batters[playerId]||[]}));Object.assign(playerShards,(await post({operation:'fitted-state-shards',date:today,players})).refs);}
state={...state,pitchers:{},batters:{},playerShards};
const published=await post({operation:'fitted-state-publish',date:today,state});await fs.writeFile(out+'/receipt.json',JSON.stringify({...published,days},null,2));console.log(JSON.stringify(published));
// Invoke capture immediately after publication, without waiting for a historical shard.
console.log(JSON.stringify(await post({operation:'capture',date:today})));
