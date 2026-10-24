#!/usr/bin/env node
import fs from 'node:fs/promises';
import {parseStatcastCsv} from '../functions/lib/mlbPitchMatchupFeed.js';
import {MLB_STATCAST_LAB_VERSION} from '../functions/lib/mlbStatcastLab.js';
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const base=args.base||'https://fbis-myz.pages.dev',cutoffDay=new Date().toISOString().slice(0,10),year=Number(cutoffDay.slice(0,4));
if(new URL(base).origin!=='https://fbis-myz.pages.dev'&&args.persist==='true')throw Error('CANONICAL_FBIS_DESTINATION_REQUIRED');
const seasons=(args.seasons||String(year)).split(',').map(Number);if(!seasons.length||seasons.length>3||seasons.some(s=>!Number.isInteger(s)||s<2024||s>year))throw Error('SEASONS_2024_TO_CURRENT_REQUIRED');
const dir=args.out||'artifacts/mlb-statcast-lab';await fs.mkdir(dir,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,mode='json'){
 let error;for(let attempt=0;attempt<3;attempt++)try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; FBIS-PlayerLab/1.0)',referer:'https://baseballsavant.mlb.com/'},signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('SOURCE_HTTP_'+r.status);return mode==='json'?await r.json():await r.text();}catch(e){error=e;await pause(1000*(attempt+1));}throw error;
}
if(args.persist==='true'){
 if(!process.env.HARVEST_SECRET)throw Error('HARVEST_SECRET_REQUIRED');
 let ready=false;for(let i=0;i<30;i++){try{const r=await fetch(`${base}/api/mlb-statcast-lab?playerId=669373&season=2024`,{signal:AbortSignal.timeout(10000)}),b=await r.json();if(r.ok&&b.version===MLB_STATCAST_LAB_VERSION){ready=true;break;}}catch{}await pause(15000);}if(!ready)throw Error('DEPLOYED_LAB_API_NOT_READY');
}
let players=[];
if(args.players){for(const item of args.players.split(',')){const [id,role='pitcher']=item.split(':');if(!/^\d+$/.test(id)||!['pitcher','batter'].includes(role))throw Error('INVALID_PLAYER_SCOPE');players.push({id,role});}}
else{
 const shard=Number(args.teamShard),teams=(await get('https://statsapi.mlb.com/api/v1/teams?sportId=1')).teams.sort((a,b)=>a.id-b.id);
 if(!Number.isInteger(shard)||shard<0||shard>=teams.length)throw Error('TEAM_SHARD_0_TO_29_REQUIRED');
 const team=teams[shard],roster=await get(`https://statsapi.mlb.com/api/v1/teams/${team.id}/roster?rosterType=40Man&hydrate=person`);
 players=(roster.roster||[]).map(p=>({id:String(p.person?.id||''),role:p.position?.type==='Pitcher'?'pitcher':'batter'})).filter(p=>/^\d+$/.test(p.id));
}
players=[...new Map(players.map(p=>[p.id+':'+p.role,p])).values()];if(players.length>60)throw Error('PLAYER_BATCH_LIMIT_EXCEEDED');
const finalGames=new Map();for(const season of seasons){const s=await get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&gameTypes=R,F,D,L,W`);finalGames.set(season,(s.dates||[]).flatMap(d=>d.games||[]).filter(g=>g.status?.codedGameState==='F'&&String(g.officialDate)<cutoffDay).map(g=>String(g.gamePk)));}
const receipt={version:MLB_STATCAST_LAB_VERSION,startedAt:new Date().toISOString(),scope:{players,seasons,cutoffDay},processed:[],errors:[],complete:false};
for(const p of players)for(const season of seasons){
 try{
  const u=new URL('https://baseballsavant.mlb.com/statcast_search/csv');const end=season<year?`${season}-12-31`:new Date(Date.parse(cutoffDay)-86400000).toISOString().slice(0,10);
  for(const [k,v]of Object.entries({all:'true',type:'details',player_type:p.role,game_date_gt:`${season}-01-01`,game_date_lt:end,hfGT:'R|PO|',min_pitches:'0',min_results:'0',min_pas:'0'}))u.searchParams.set(k,v);
  u.searchParams.set(p.role==='pitcher'?'pitchers_lookup[]':'batters_lookup[]',p.id);
  const rawCsv=await get(u.toString(),'text');if(Buffer.byteLength(rawCsv)>18000000)throw Error('SOURCE_BYTE_BUDGET_EXCEEDED');
  const payload={playerId:p.id,role:p.role,season,cutoffDay,sourceUrl:u.toString(),finalGameIds:finalGames.get(season),rawCsv};
  let result={ok:true,dryRun:true,pitches:parseStatcastCsv(rawCsv).length};
  if(args.persist==='true'){const r=await fetch(`${base}/api/mlb-statcast-lab`,{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET},body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)});result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'LAB_PERSIST_FAILED');}
  else await fs.writeFile(`${dir}/${p.id}-${p.role}-${season}.json`,JSON.stringify(payload));
  receipt.processed.push({playerId:p.id,role:p.role,season,...result});
 }catch(error){receipt.errors.push({playerId:p.id,role:p.role,season,error:String(error.message)});}
 await fs.writeFile(`${dir}/receipt.json`,JSON.stringify(receipt,null,2));await pause(750);
}
receipt.complete=receipt.errors.length===0&&receipt.processed.length===players.length*seasons.length;receipt.finishedAt=new Date().toISOString();await fs.writeFile(`${dir}/receipt.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));if(!receipt.complete)process.exitCode=1;
