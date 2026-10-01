#!/usr/bin/env node
import fs from "node:fs";
import { projectBasketballForm } from "../functions/lib/basketballFormModel.js";

const WINDOWS={
  2023:["2023-05-19","2023-09-10"],
  2024:["2024-05-14","2024-09-19"],
  2025:["2025-05-16","2025-09-11"],
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function days(a,b){
  const s=Date.parse(a+"T12:00:00Z"),e=Date.parse(b+"T12:00:00Z"),out=[];
  for(let t=s;t<=e;t+=86400000) out.push(new Date(t).toISOString().slice(0,10));
  return out;
}
async function fetchDay(date){
  const stamp=date.replaceAll("-","");
  const url=`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${stamp}&limit=100`;
  let last=null;
  for(let k=0;k<3;k++){
    try{
      const r=await fetch(url,{headers:{"user-agent":"FBIS-WNBA-WF/1.0","accept":"application/json"}});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const j=await r.json();
      return (j.events||[]).flatMap(ev=>{
        const c=ev.competitions?.[0], cs=c?.competitors||[];
        const h=cs.find(x=>x.homeAway==="home"),a=cs.find(x=>x.homeAway==="away");
        const hs=finite(h?.score),as=finite(a?.score);
        const complete=ev.status?.type?.completed===true||c?.status?.type?.completed===true;
        if(!h||!a||!complete||hs==null||as==null) return [];
        return [{
          id:String(ev.id),date,start:ev.date,homeId:String(h.team?.id||h.id),awayId:String(a.team?.id||a.id),
          homeName:h.team?.displayName||"",awayName:a.team?.displayName||"",homeScore:hs,awayScore:as,
          neutralSite:Boolean(c?.neutralSite),
        }];
      });
    }catch(err){last=err;await sleep(250*(k+1));}
  }
  throw last||new Error("WNBA scoreboard unavailable");
}
function aggregate(games){
  const m=new Map();
  for(const g of games){
    for(const [id,pf,pa] of [[g.homeId,g.homeScore,g.awayScore],[g.awayId,g.awayScore,g.homeScore]]){
      const r=m.get(id)||{games:0,pointsFor:0,pointsAgainst:0};
      r.games++;r.pointsFor+=pf;r.pointsAgainst+=pa;m.set(id,r);
    }
  }
  return m;
}
const all={};
for(const year of [2023,2024,2025]){
  const [a,b]=WINDOWS[year], rows=[];
  for(const d of days(a,b)){
    rows.push(...await fetchDay(d));
    await sleep(35);
  }
  all[year]=[...new Map(rows.map(g=>[g.id,g])).values()].sort((x,y)=>Date.parse(x.start)-Date.parse(y.start));
  console.log(`WNBA ${year} games=${all[year].length}`);
}
const output=[];
for(const season of [2024,2025]){
  const prior=aggregate(all[season-1]);
  const current=[];
  for(const g of all[season]){
    const cur=aggregate(current);
    const proj=projectBasketballForm("wnba",{neutralSite:g.neutralSite},{
      homePrior:prior.get(g.homeId),awayPrior:prior.get(g.awayId),
      homeCurrent:cur.get(g.homeId),awayCurrent:cur.get(g.awayId),
    });
    if(proj.ok){
      const actualMargin=g.homeScore-g.awayScore,actualTotal=g.homeScore+g.awayScore;
      output.push({
        season,gameId:g.id,date:g.date,home:g.homeName,away:g.awayName,
        projectedHome:proj.home,projectedAway:proj.away,projectedMargin:proj.margin,projectedTotal:proj.total,
        actualHome:g.homeScore,actualAway:g.awayScore,
        marginAbsError:Math.abs(proj.margin-actualMargin),totalAbsError:Math.abs(proj.total-actualTotal),
        winnerCorrect:(proj.margin>0)===(actualMargin>0),
      });
    }
    current.push(g);
  }
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const perSeason={};
for(const y of [2024,2025]){
 const r=output.filter(x=>x.season===y);
 perSeason[y]={n:r.length,marginMae:mean(r.map(x=>x.marginAbsError)),totalMae:mean(r.map(x=>x.totalAbsError)),winnerAccuracy:r.length?r.filter(x=>x.winnerCorrect).length/r.length:null};
}
const report={
  generatedAt:new Date().toISOString(),modelId:"WNBA-FBIS-v1",method:"chronological-scoreboard-form-walk-forward",
  n:output.length,marginMae:mean(output.map(x=>x.marginAbsError)),totalMae:mean(output.map(x=>x.totalAbsError)),
  winnerAccuracy:output.length?output.filter(x=>x.winnerCorrect).length/output.length:null,perSeason,
  governance:{maturity:"RESEARCH",autoPromote:false,canQualify:false,canAuthorize:false,
    note:"Model features use only prior/current scoreboard results. Sportsbook/Action data is excluded; market-relative validation is separate."}
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/wnba-form-walkforward-report.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/wnba-form-walkforward-rows.jsonl",output.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
