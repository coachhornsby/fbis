import fs from 'node:fs/promises';
const args=Object.fromEntries(process.argv.slice(2).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
const base='https://fbis-myz.pages.dev',out=args.out||'artifacts/mlb-completion';await fs.mkdir(out,{recursive:true});
if(!process.env.HARVEST_SECRET)throw Error('HARVEST_SECRET_REQUIRED');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function official(url,text=false){let error;for(let i=0;i<3;i++){try{const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (compatible; FBIS-MLB-Research/1.0)',referer:'https://baseballsavant.mlb.com/'},signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('SOURCE_HTTP_'+r.status);return text?await r.text():await r.json();}catch(e){error=e;await pause(1000*(i+1));}}throw error;}
async function post(body){let error;for(let i=0;i<3;i++){try{const r=await fetch(base+'/api/mlb-completion',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':process.env.HARVEST_SECRET},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)}),b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'OPERATION_FAILED');return b;}catch(e){error=e;await pause(1500*(i+1));}}throw error;}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10),month=args.month;
const receipt={startedAt:new Date().toISOString(),days:[],errors:[],classification:month?'RETROSPECTIVE_COLLECTION':'PROSPECTIVE_CAPTURE_AND_FINALS'};
if(!month){receipt.capture=await post({operation:'capture',date:today});}
const start=month?month+'-01':yesterday,end=month?new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).toISOString().slice(0,10):yesterday;
if(month&&!/^202[4-6]-(0[3-9]|1[01])$/.test(month))throw Error('BOUNDED_MARCH_NOVEMBER_2024_2026_REQUIRED');
if(month&&month>new Date().toISOString().slice(0,7)){console.log(JSON.stringify({skipped:'FUTURE_MONTH',month}));process.exit(0);}
const schedule=await official(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}&gameTypes=R,F,D,L,W`);
if(!Array.isArray(schedule.dates)||!Number.isFinite(schedule.totalGames))throw Error('INVALID_OFFICIAL_SCHEDULE');
const byDate=new Map((schedule.dates||[]).map(d=>[d.date,(d.games||[]).filter(g=>g.status?.codedGameState==='F').map(g=>String(g.gamePk))]));
for(let at=Date.parse(start);at<=Date.parse(end)&&at<Date.parse(new Date().toISOString().slice(0,10));at+=86400000){
 const date=new Date(at).toISOString().slice(0,10),ids=byDate.get(date)||[];
 try{
  const status=await post({operation:'status',date});if(status.game?.complete&&JSON.stringify([...status.game.expectedGameIds].sort())!==JSON.stringify([...ids].sort())){status.game.complete=false;status.league=null;}if(status.game?.complete&&status.league?.complete&&args.force!=='true'&&month){receipt.days.push({date,reused:true});continue;}
  if(!month&&status.game?.complete)for(const id of ids){const feed=await official(`https://statsapi.mlb.com/api/v1.1/game/${id}/feed/live`);await post({operation:'grade',date,feed});}
  if(!status.game?.complete||args.force==='true')for(const id of ids){const feed=await official(`https://statsapi.mlb.com/api/v1.1/game/${id}/feed/live`);await post({operation:'game',date,feed});await post({operation:'grade',date,feed});await pause(150);}
  const manifest=await post({operation:'manifest',date,finalGameIds:ids});
  let league=status.league;
  if(!league?.complete||args.force==='true'){
   const u=new URL('https://baseballsavant.mlb.com/statcast_search/csv');for(const [k,v] of Object.entries({all:'true',type:'details',player_type:'pitcher',game_date_gt:date,game_date_lt:date,hfGT:'R|PO|',min_pitches:'0',min_results:'0',min_pas:'0'}))u.searchParams.set(k,v);
   const rawCsv=ids.length?await official(u.toString(),true):'"pitch_type"\n';league=await post({operation:'league',date,rawCsv,finalGameIds:ids});
  }
  if(!manifest.complete||!league.complete)throw Error('INCOMPLETE_FINAL_GAME_OR_STATCAST_COVERAGE');
  receipt.days.push({date,games:ids.length,complete:true});
 }catch(e){receipt.errors.push({date,error:e.message});}
 await fs.writeFile(out+'/receipt.json',JSON.stringify(receipt,null,2));
}
receipt.month=await post({operation:'month',date:start});receipt.finishedAt=new Date().toISOString();receipt.complete=!receipt.errors.length;
await fs.writeFile(out+'/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify({complete:receipt.complete,days:receipt.days.length,errors:receipt.errors}));if(!receipt.complete)process.exitCode=1;
