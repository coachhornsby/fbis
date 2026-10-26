#!/usr/bin/env node
// Free/public Gamma discovery only. Never fetch order accounts or place orders.
// A provider-tag walk is candidate research, NOT certified complete prop coverage.
import {mkdir,writeFile} from 'node:fs/promises';
const secret=process.env.HARVEST_SECRET;
if(!secret)throw Error('HARVEST_SECRET_REQUIRED');
const base=(process.env.BASE||'https://fbis-myz.pages.dev')+'/api/polymarket-global-sport-catalog';
const sports=['nfl','cfb','nba','cbb','mlb','nhl','tennis'];
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const PAGE=20,PER_CYCLE=2;
const receipt={startedAt:new Date().toISOString(),day,sports:[],readOnly:true,
 canAuthorizeWager:false,priceKind:'GAMMA_REFERENCE_NOT_EXECUTABLE'};
async function status(sport){
 const u=new URL(base);u.searchParams.set('sport',sport);u.searchParams.set('day',day);
 const r=await fetch(u,{headers:{'x-harvest-secret':secret},signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('COVERAGE_STATUS_HTTP_'+r.status);
 return r.json();
}
async function capture(sport,offset,events){
 const r=await fetch(base,{method:'POST',headers:{'x-harvest-secret':secret,
  'content-type':'application/json'},body:JSON.stringify({sport,day,offset,events}),
  signal:AbortSignal.timeout(45000)});
 const body=await r.json();if(!r.ok||!body.ok)
  throw Error('PROGRESS_CAPTURE_REJECTED_'+(body.code||r.status));
 return body;
}
for(const sport of sports){
 const outcome={sport,pages:0,events:0,markets:0,status:'UNAVAILABLE'};
 try{
  const prior=await status(sport);
  let offset=prior.complete?0:prior.nextOffset;
  if(!Number.isSafeInteger(offset)||offset<0||offset%PAGE)
   throw Error('INVALID_PREVIOUS_CURSOR');
  for(let i=0;i<PER_CYCLE;i++){
   const u=new URL('https://gamma-api.polymarket.com/events');
   u.searchParams.set('tag_slug',sport);
   u.searchParams.set('active','true');
   u.searchParams.set('closed','false');
   u.searchParams.set('limit',String(PAGE));
   u.searchParams.set('offset',String(offset));
   const r=await fetch(u,{headers:{accept:'application/json'},
    signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw Error('GAMMA_HTTP_'+r.status);
   const events=await r.json();
   if(!Array.isArray(events)||events.length>PAGE||
       !events.every(e=>e&&typeof e.slug==='string'&&Array.isArray(e.markets)))
     throw Error('GAMMA_EVENT_MARKETS_SCHEMA_UNVERIFIED');
   const saved=await capture(sport,offset,events);
   outcome.pages++;
   outcome.events+=events.length;
   outcome.markets+=events.reduce((n,e)=>n+e.markets.length,0);
   outcome.status=saved.status;
   if(saved.complete)break;
   if(saved.nextOffset<=offset)throw Error('NONADVANCING_GAMMA_OFFSET');
   offset=saved.nextOffset;
  }
 }catch(e){outcome.status='DEGRADED';outcome.reason=String(e.message).slice(0,120);}
 receipt.sports.push(outcome);
}
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/polymarket-global-sport-catalog.json',JSON.stringify(receipt,null,2));
if(receipt.sports.some(s=>s.status==='DEGRADED'))throw Error('GAMMA_SPORT_CATALOG_INCOMPLETE');
console.log(JSON.stringify({day,sports:receipt.sports.map(x=>({sport:x.sport,status:x.status,pages:x.pages,events:x.events,markets:x.markets})),canAuthorizeWager:false}));
