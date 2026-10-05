#!/usr/bin/env node
import fs from "node:fs";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const out=args.out||"artifacts/nba-official-injury-discovery.json";
const now=new Date();
const seasonStartYear=Number(args.seasonStartYear||((now.getUTCMonth()+1)>=7?now.getUTCFullYear():now.getUTCFullYear()-1));
const seasons=[seasonStartYear,seasonStartYear-1];

async function get(url){
  const r=await fetch(url,{headers:{"user-agent":"FBIS-NBA-Official-Availability/1.0",accept:"text/html,application/xhtml+xml"}});
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
  return {url:r.url,text:await r.text()};
}
function links(html,base){
  const out=[];
  const re=/href\s*=\s*["']([^"']+)["']/gi;let m;
  while((m=re.exec(html))){
    try{const u=new URL(m[1],base).toString();if(/\.pdf(?:$|\?)/i.test(u))out.push(u)}catch{}
  }
  return [...new Set(out)];
}
let found=null,attempts=[];
for(const y of seasons){
  const slug=`https://official.nba.com/nba-injury-report-${y}-${String((y+1)%100).padStart(2,"0")}-season/`;
  try{
    const page=await get(slug),pdfs=links(page.text,page.url).filter(u=>/injury|report|wp-content\/uploads/i.test(u));
    attempts.push({url:slug,ok:true,pdfs:pdfs.length});
    if(pdfs.length){found={season:`${y}-${String((y+1)%100).padStart(2,"0")}`,pageUrl:page.url,pdfs};break}
  }catch(e){attempts.push({url:slug,ok:false,error:String(e?.message||e)})}
}
if(!found){
  fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
  fs.writeFileSync(out,JSON.stringify({ok:false,attempts,reason:"no_official_pdf_links"},null,2)+"\n");
  console.log(JSON.stringify({ok:false,attempts,reason:"no_official_pdf_links"},null,2));
  process.exit(0);
}
const score=u=>{
  const name=decodeURIComponent(u.split("/").pop()||"");
  const nums=[...name.matchAll(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[-_]?(\d{2})?[-_]?(\d{2})?/g)].map(m=>Number(`${m[1]}${m[2]}${m[3]}${m[4]||"00"}${m[5]||"00"}`));
  return nums.length?Math.max(...nums):0;
};
const pdfs=[...found.pdfs].sort((a,b)=>score(a)-score(b));
const url=pdfs.at(-1);
const result={ok:true,season:found.season,pageUrl:found.pageUrl,url,pdfCount:pdfs.length,attempts,discoveredAt:new Date().toISOString()};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
