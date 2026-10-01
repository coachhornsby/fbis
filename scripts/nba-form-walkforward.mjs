#!/usr/bin/env node
import fs from "node:fs";
import { projectBasketballForm } from "../functions/lib/basketballFormModel.js";

const SEASONS=[
  {label:"2024-25",prior:["2023-10-24","2024-06-17"],target:["2024-10-22","2025-06-22"]},
  {label:"2025-26",prior:["2024-10-22","2025-06-22"],target:["2025-10-21","2026-06-21"]},
];
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function days(a,b){const s=Date.parse(a+"T12:00:00Z"),e=Date.parse(b+"T12:00:00Z"),out=[];for(let t=s;t<=e;t+=86400000)out.push(new Date(t).toISOString().slice(0,10));return out;}
async function loadRange([a,b]){
  const rows=[];
  for(const date of days(a,b)){
    const stamp=date.replaceAll("-","");
    const url=`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${stamp}&limit=100`;
    let last=null;
    for(let k=0;k<3;k++){
      try{
        const r=await fetch(url,{headers:{"user-agent":"FBIS-NBA-WF/1.0",accept:"application/json"}});
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const j=await r.json();
        for(const ev of j.events||[]){
          const c=ev.competitions?.[0],xs=c?.competitors||[],h=xs.find(x=>x.homeAway==="home"),aw=xs.find(x=>x.homeAway==="away");
          const hs=finite(h?.score),as=finite(aw?.score),done=ev.status?.type?.completed===true||c?.status?.type?.completed===true;
          if(!h||!aw||!done||hs==null||as==null)continue;
          rows.push({id:String(ev.id),date,start:ev.date,homeId:String(h.team?.id||h.id),awayId:String(aw.team?.id||aw.id),homeName:h.team?.displayName||"",awayName:aw.team?.displayName||"",homeScore:hs,awayScore:as,neutralSite:Boolean(c?.neutralSite)});
        }
        last=null;break;
      }catch(err){last=err;await sleep(150*(k+1));}
    }
    if(last) throw last;
    await sleep(15);
  }
  return [...new Map(rows.map(g=>[g.id,g])).values()].sort((x,y)=>Date.parse(x.start)-Date.parse(y.start));
}
function agg(games){const m=new Map();for(const g of games)for(const [id,pf,pa] of [[g.homeId,g.homeScore,g.awayScore],[g.awayId,g.awayScore,g.homeScore]]){const r=m.get(id)||{games:0,pointsFor:0,pointsAgainst:0};r.games++;r.pointsFor+=pf;r.pointsAgainst+=pa;m.set(id,r);}return m;}
const output=[];
for(const s of SEASONS){
  const prior=await loadRange(s.prior),target=await loadRange(s.target);
  console.log(`NBA ${s.label} prior=${prior.length} target=${target.length}`);
  const pmap=agg(prior),seen=[];
  for(const g of target){
    const cur=agg(seen);
    const p=projectBasketballForm("nba",{neutralSite:g.neutralSite},{homePrior:pmap.get(g.homeId),awayPrior:pmap.get(g.awayId),homeCurrent:cur.get(g.homeId),awayCurrent:cur.get(g.awayId)});
    if(p.ok){
      const am=g.homeScore-g.awayScore,at=g.homeScore+g.awayScore;
      output.push({season:s.label,gameId:g.id,date:g.date,home:g.homeName,away:g.awayName,projectedHome:p.home,projectedAway:p.away,projectedMargin:p.margin,projectedTotal:p.total,actualHome:g.homeScore,actualAway:g.awayScore,marginAbsError:Math.abs(p.margin-am),totalAbsError:Math.abs(p.total-at),winnerCorrect:(p.margin>0)===(am>0)});
    }
    seen.push(g);
  }
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const perSeason={};
for(const s of SEASONS){const r=output.filter(x=>x.season===s.label);perSeason[s.label]={n:r.length,marginMae:mean(r.map(x=>x.marginAbsError)),totalMae:mean(r.map(x=>x.totalAbsError)),winnerAccuracy:r.length?r.filter(x=>x.winnerCorrect).length/r.length:null};}
const report={generatedAt:new Date().toISOString(),modelId:"NBA-FBIS-FORM-v1",method:"chronological-scoreboard-form-walk-forward",n:output.length,marginMae:mean(output.map(x=>x.marginAbsError)),totalMae:mean(output.map(x=>x.totalAbsError)),winnerAccuracy:output.length?output.filter(x=>x.winnerCorrect).length/output.length:null,perSeason,governance:{maturity:"RESEARCH",autoPromote:false,canQualify:false,canAuthorize:false,marketValidationRequired:true}};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/nba-form-walkforward-report.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/nba-form-walkforward-rows.jsonl",output.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
