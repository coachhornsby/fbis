// Bounded official-source contract audit only. Never writes a fixture or prediction.
import { mkdir, writeFile } from 'node:fs/promises';
const root='https://api.wtatennis.com/tennis',out='artifacts/tennis-official-schedule-probe';
await mkdir(out,{recursive:true});
const now=new Date(),from=new Date(+now-7*86400000).toISOString().slice(0,10),to=new Date(+now+7*86400000).toISOString().slice(0,10);
const results=[];
async function read(path,file){try{const r=await fetch(root+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(25000)}),raw=await r.text();await writeFile(`${out}/${file}.json`,raw.slice(0,2000000));let data;try{data=JSON.parse(raw)}catch{}results.push({path,status:r.status,bytes:raw.length,observedAt:new Date().toISOString(),keys:data&&!Array.isArray(data)?Object.keys(data):null});return r.ok?data:null;}catch(e){results.push({path,error:e.message,observedAt:new Date().toISOString()});return null;}}
const data=await read(`/tournaments/?page=0&pageSize=100&excludeLevels=ITF&from=${from}&to=${to}`,'tournaments');
const rows=Array.isArray(data)?data:data?.content||[];
const current=rows.filter(t=>Number(t.year)===now.getUTCFullYear()).slice(0,3);
for(const t of current){const id=String(t.tournamentGroup?.id??t.tournamentGroupId??t.id??'');if(/^\d+$/.test(id))await read(`/tournaments/${id}/${t.year}/matches`,`matches-${id}`);}
await writeFile(`${out}/summary.json`,JSON.stringify({asOf:now.toISOString(),source:'WTA_OFFICIAL',from,to,providerTournamentRows:rows.length,tournamentsProbed:current.length,results,researchOnly:true,canAuthorizeWager:false},null,2));
console.log(JSON.stringify({providerTournamentRows:rows.length,tournamentsProbed:current.length,results}));
