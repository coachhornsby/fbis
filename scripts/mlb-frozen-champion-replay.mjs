import fs from 'node:fs/promises';
import {emptyFittedState,advanceFittedState,fittedDesignRow} from '../functions/lib/mlbFittedRuntime.js';
import {frozenCurrentForecasts,normalizeReplayForecasts,validateReplayModels,pairFrozenForecast,summarizeChampionReplay} from '../functions/lib/mlbChampionReplay.js';
import {sha256Hex} from '../functions/lib/sha256Hex.js';
const root='research/mlb/champion-replay-20261025/inputs',out=process.env.REPLAY_OUT||'artifacts/mlb-champion-replay';await fs.mkdir(out,{recursive:true});
const read=async p=>JSON.parse(await fs.readFile(root+'/'+p,'utf8'));
const [report,archived,freeze,grade]=await Promise.all(['fitted-report.json','archived-production-points.json','production-freeze.json','production-grade.json'].map(read));
const models=validateReplayModels(report),forecasts=normalizeReplayForecasts(archived,frozenCurrentForecasts(freeze,grade)),pairs=[],excluded=[];
const byDate=new Map();for(const f of forecasts){const xs=byDate.get(f.event_date)||[];xs.push(f);byDate.set(f.event_date,xs);}
const hashes={fittedReport:sha256Hex(JSON.stringify(report)),archivedProduction:sha256Hex(JSON.stringify(archived)),currentFreeze:freeze.sourceHash};
if(process.argv.includes('--design')){
 const design=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--design')+1],'utf8'));
 for(const f of forecasts){const rows=design[f.market==='pitcher_k'?'pitcherK':f.market]||[],row=rows.find(r=>r.gameId===f.event_id&&r.playerId===f.player_id&&r.date===f.event_date),r=pairFrozenForecast(f,row,models[f.market]);if(r.pair)pairs.push(r.pair);else excluded.push({evidenceId:f.id,gameId:f.event_id,market:f.market,reason:r.excluded});}
}else{
 if(!process.env.HARVEST_SECRET)throw Error('HARVEST_SECRET_REQUIRED');
 async function day(date){let error;for(let n=0;n<3;n++){try{const r=await fetch('https://fbis-myz.pages.dev/api/mlb-completion',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET},body:JSON.stringify({date,operation:'training-day'}),signal:AbortSignal.timeout(120000)}),b=await r.json();if(!r.ok||!b.ok||b.date!==date)throw Error(b.error||'TRAINING_SOURCE_INVALID');return b;}catch(e){error=e;}}throw error;}
 let state=emptyFittedState();const last=[...byDate.keys()].sort().at(-1),dates=[];
 for(let t=Date.parse(state.throughExclusive);t<=Date.parse(last);t+=86400000){const d=new Date(t).toISOString().slice(0,10),m=Number(d.slice(5,7));if(m>=3&&m<=11)dates.push(d);}
 for(let at=0;at<dates.length;at+=4){const batch=await Promise.all(dates.slice(at,at+4).map(day));for(const d of batch){
  for(const f of byDate.get(d.date)||[]){const g=d.games.find(g=>g.gameId===f.event_id),role=f.market==='pitcher_k'?'pitching':'batting',p=g?.players.find(p=>p.playerId===f.player_id&&p.group===role&&p.starter);
   // Select the opposing pitcher from the frozen player's official game identity, not today's roster.
   const opponentPitcher=p&&g.players.find(x=>x.group==='pitching'&&x.starter&&x.teamId===p.opponentId);
   const row=p&&fittedDesignRow(state,{market:f.market,playerId:p.playerId,opponentId:p.opponentId,opponentPitcherId:opponentPitcher?.playerId,date:d.date});
   const target=p?.stats[{pitcher_k:'strikeOuts',hits:'hits',total_bases:'totalBases',home_runs:'homeRuns'}[f.market]];
   const result=pairFrozenForecast(f,row?{...row,gameId:g.gameId,playerId:p.playerId,date:d.date,scope:g.gameType==='R'?'regular':'postseason',target,classification:'RETROSPECTIVE',sourceHash:g.sourceHash}:null,models[f.market]);if(result.pair)pairs.push(result.pair);else excluded.push({evidenceId:f.id,gameId:f.event_id,market:f.market,reason:result.excluded});
  }
  state=advanceFittedState(state,d);
 }
 if(at%40===0){const progress={days:at+batch.length,throughExclusive:state.throughExclusive,paired:pairs.length,excluded:excluded.length};await fs.writeFile(out+'/progress.json',JSON.stringify(progress));console.log(JSON.stringify(progress));}}
 hashes.trainingSourceManifest=sha256Hex(JSON.stringify(state.sources));
}
const result=summarizeChampionReplay(pairs,{excluded,corpus:{productionForecasts:forecasts.length,productionGames:new Set(forecasts.map(f=>f.event_id)).size,matchedGames:new Set(pairs.map(r=>r.gameId)).size,source:'R2 verified competitive training days and immutable production snapshots'},inputHashes:hashes});
await fs.writeFile(out+'/paired-rows.json',JSON.stringify(pairs));await fs.writeFile(out+'/report.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({decision:result.decision,rows:pairs.length,excluded:excluded.length,cohorts:result.cohorts.map(c=>({market:c.market,current:c.currentVersion,n:c.champion.n,games:c.champion.distinctGames,championMae:c.champion.mae,candidateMae:c.candidate.mae}))}));
