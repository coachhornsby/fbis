#!/usr/bin/env node
import fs from "node:fs";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/nba-official-injury-discovery.json";
const explicitDate=args.date||null;
const base="https://ak-static.cms.nba.com/referee/injury/";

function etParts(d=new Date()){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(d);
  const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,hour:Number(m.hour),minute:Number(m.minute)};
}
function candidateTimes(maxMinute){
  const xs=[];
  for(let m=Math.floor(maxMinute/15)*15;m>=0;m-=15){
    const h=Math.floor(m/60),min=m%60,ampm=h>=12?"PM":"AM",h12=((h+11)%12)+1;
    xs.push(`${String(h12).padStart(2,"0")}_${String(min).padStart(2,"0")}${ampm}`);
  }
  return xs;
}
async function exists(url){
  try{
    let r=await fetch(url,{method:"HEAD",headers:{"user-agent":"FBIS-NBA-Official-Availability/1.0"}});
    if(r.ok&&/pdf/i.test(r.headers.get("content-type")||""))return true;
    if([403,405].includes(r.status)){
      r=await fetch(url,{headers:{"user-agent":"FBIS-NBA-Official-Availability/1.0","range":"bytes=0-32"}});
      return r.ok;
    }
  }catch{}
  return false;
}
async function findForDate(date,maxMinute){
  const times=candidateTimes(maxMinute);
  for(let i=0;i<times.length;i+=12){
    const batch=times.slice(i,i+12);
    const checks=await Promise.all(batch.map(async t=>{
      const url=`${base}Injury-Report_${date}_${t}.pdf`;
      return {t,url,ok:await exists(url)};
    }));
    const hit=checks.find(x=>x.ok);
    if(hit)return hit;
  }
  return null;
}

const now=new Date(),et=etParts(now);
const dates=[];
if(explicitDate)dates.push({date:explicitDate,maxMinute:23*60+59});
else{
  dates.push({date:et.date,maxMinute:et.hour*60+et.minute});
  const y=new Date(now.getTime()-86400000),yp=etParts(y);
  dates.push({date:yp.date,maxMinute:23*60+59});
}
let found=null;
for(const d of dates){found=await findForDate(d.date,d.maxMinute);if(found)break}
const result=found
  ? {ok:true,date:found.url.match(/Injury-Report_(\d{4}-\d{2}-\d{2})_/)[1],url:found.url,discoveredAt:new Date().toISOString(),source:"NBA_OFFICIAL_INJURY_REPORT"}
  : {ok:false,reason:"no_official_report_found",datesTried:dates.map(x=>x.date),discoveredAt:new Date().toISOString(),source:"NBA_OFFICIAL_INJURY_REPORT"};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
