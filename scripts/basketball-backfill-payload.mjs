#!/usr/bin/env node
const sport=String(process.argv[2]||"").toLowerCase();
const start=String(process.argv[3]||"");
const end=String(process.argv[4]||"");
if(!["nba","wnba"].includes(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start){
  console.error("usage: node scripts/basketball-backfill-payload.mjs <nba|wnba> <start> <end>");
  process.exit(2);
}
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const days=(a,b)=>{const s=Date.parse(a+"T12:00:00Z"),e=Date.parse(b+"T12:00:00Z"),out=[];for(let t=s;t<=e;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;};
const games=[];
for(const date of days(start,end)){
  const stamp=date.replaceAll("-","");
  const url=`https://site.api.espn.com/apis/site/v2/sports/basketball/${sport}/scoreboard?dates=${stamp}&limit=100`;
  const r=await fetch(url,{headers:{"user-agent":"FBIS-Basketball-Backfill-Runner/1.0",accept:"application/json"}});
  if(!r.ok) throw new Error(`${sport} ${date} HTTP ${r.status}`);
  const j=await r.json();
  for(const ev of j.events||[]){
    const c=ev.competitions?.[0],xs=c?.competitors||[],h=xs.find(x=>x.homeAway==="home"),a=xs.find(x=>x.homeAway==="away");
    const hs=finite(h?.score),as=finite(a?.score),done=ev.status?.type?.completed===true||c?.status?.type?.completed===true;
    if(!h||!a||!done||hs==null||as==null) continue;
    games.push({
      id:String(ev.id),date,startTime:ev.date,homeScore:hs,awayScore:as,
      home:{name:h.team?.displayName||h.team?.name||"",abbr:h.team?.abbreviation||"",espnId:h.team?.id!=null?String(h.team.id):null},
      away:{name:a.team?.displayName||a.team?.name||"",abbr:a.team?.abbreviation||"",espnId:a.team?.id!=null?String(a.team.id):null},
    });
  }
}
const uniq=[...new Map(games.map(g=>[g.id,g])).values()];
process.stdout.write(JSON.stringify({sport,start,end,games:uniq}));
