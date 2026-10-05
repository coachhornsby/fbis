#!/usr/bin/env node
const league=process.argv[2]||"atp";
const date=process.argv[3]||"20250825";
const base=`https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard?dates=${date}&limit=1000`;
const r=await fetch(base,{headers:{"user-agent":"FBIS tennis ESPN market probe"}});
if(!r.ok)throw new Error(`scoreboard ${r.status}`);
const j=await r.json();
const out=[];
const firstEvent=(j.events||[])[0]||null;
for(const ev of j.events||[]){
  for(const c of ev.competitions||[]){
    const names=(c.competitors||[]).map(x=>x.athlete?.displayName||x.athlete?.shortName||x.team?.displayName||x.displayName||x.id);
    const oddsUrl=`https://sports.core.api.espn.com/v2/sports/tennis/leagues/${league}/events/${ev.id}/competitions/${c.id}/odds?limit=100`;
    let odds=null;try{const q=await fetch(oddsUrl,{headers:{"user-agent":"FBIS tennis ESPN market probe"}});if(q.ok)odds=await q.json();}catch{}
    out.push({eventId:ev.id,eventName:ev.name,competitionId:c.id,date:c.date,status:c.status?.type?.name,names,competitionOdds:c.odds||null,coreOdds:odds});
    if(out.length>=12)break;
  }
  if(out.length>=12)break;
}
const shape={};
if(firstEvent){
  for(const [k,v] of Object.entries(firstEvent)){
    shape[k]=Array.isArray(v)?{type:"array",length:v.length,firstKeys:v[0]&&typeof v[0]==="object"?Object.keys(v[0]):null}
      :v&&typeof v==="object"?{type:"object",keys:Object.keys(v)}
      :{type:typeof v,value:String(v).slice(0,200)};
  }
}
console.log(JSON.stringify({league,date,eventCount:(j.events||[]).length,eventKeys:firstEvent?Object.keys(firstEvent):[],shape,sample:out},null,2));
