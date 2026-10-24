import {poolMlbLeagueDays} from '../lib/mlbLeagueBenchmarks.js';
export async function onRequestGet({env,request}){
 const year=Number(new URL(request.url).searchParams.get('season')||new Date().getUTCFullYear());
 if(![2024,2025,2026].includes(year))return Response.json({ok:false,error:'Season 2024–2026 required'},{status:400});
 const months=[];if(env.ARCHIVE?.get)for(let n=3;n<=11;n++){const object=await env.ARCHIVE.get(`models/mlb/league/v1/months/${year}-${String(n).padStart(2,'0')}.json`);if(object)months.push(await object.json());}
 // Month rollups retain summed metric operands; pooling does not average averages.
 const pooled=poolMlbLeagueDays(months.map(m=>({...m,date:m.month,sourceHash:m.sources.map(s=>s.sourceHash).join(':'),observedAt:m.sources.map(s=>s.observedAt).sort().at(-1)})));
 return Response.json({ok:true,season:year,available:months.length>0,coverage:{months:months.map(m=>({month:m.month,complete:m.complete,acquiredDays:m.days,expectedDays:m.expectedDays,missingDays:m.missingDays})),seasonComplete:months.length===9&&months.every(m=>m.complete)},...pooled},{headers:{'cache-control':'public,max-age=300'}});
}
