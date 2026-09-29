import fs from "node:fs";
const report=JSON.parse(fs.readFileSync(process.env.REPORT,"utf8"));
const payload=JSON.parse(fs.readFileSync(process.env.FINALS,"utf8"));
const sport=String(process.env.SPORT||"").toUpperCase();
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const snaps=(report.audit||[]).filter(r=>String(r.sport||"").toUpperCase()===sport && r.actualHome==null && r.actualAway==null);
const finals=payload.finals||[];
for(const s of snaps){
  const st=Date.parse(s.start||"");
  if(!Number.isFinite(st)) continue;
  const exactTime=finals.filter(f=>{
    const ft=Date.parse(f.start||"");
    return Number.isFinite(ft) && Math.abs(ft-st)<=10*60*1000;
  });
  if(!exactTime.length) continue;
  const [sa="",sh=""]=String(s.matchup||"").split("@").map(x=>x.trim());
  const scored=exactTime.map(f=>{
    const fa=f.away?.name||f.away?.abbr||"";
    const fh=f.home?.name||f.home?.abbr||"";
    const score=(norm(sa)===norm(fa)?1:0)+(norm(sh)===norm(fh)?1:0);
    return {f,score};
  }).sort((a,b)=>b.score-a.score);
  const best=scored[0];
  console.log(JSON.stringify({
    gameId:s.gameId,date:s.date,start:s.start,matchup:s.matchup,
    candidateCount:exactTime.length,bestExactSides:best?.score||0,
    final:best?{
      id:best.f.id,start:best.f.start,
      away:best.f.away?.name||best.f.away?.abbr,
      home:best.f.home?.name||best.f.home?.abbr,
      awayScore:best.f.away?.score??best.f.awayScore,
      homeScore:best.f.home?.score??best.f.homeScore
    }:null
  }));
}
