import {readFileSync,writeFileSync,mkdirSync} from "node:fs";

const predictionsPath=process.argv[2]||"artifacts/cbb-fbis-native-v1-predictions.json";
const rows=JSON.parse(readFileSync(predictionsPath,"utf8"));
const ARENAS_URL="https://raw.githubusercontent.com/dilernia/NCAA/master/ncaa_arenas_full.csv";
const ALTITUDE_URL="https://api.open-meteo.com/v1/elevation";

const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const norm=v=>String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim()
  .replace(/\buniversity\b/g,"").replace(/\bst\.?\b/g,"state").replace(/\s+/g," ").trim();

const alias={
 "uconn":"connecticut","umass":"massachusetts","miami fl":"miami florida","miami oh":"miami ohio",
 "nc state":"north carolina state","unc":"north carolina","usc":"southern california",
 "loyola chicago":"loyola chicago","saint marys":"st marys","st marys ca":"st marys",
 "cal state bakersfield":"csu bakersfield","cal state fullerton":"cal state fullerton",
 "ut rio grande valley":"utrgv","middle tennessee":"middle tennessee",
 "florida atlantic":"fau","houston christian":"houston baptist",
 "texas arlington":"ut arlington","ut arlington":"ut arlington",
 "texas san antonio":"utsa","ut san antonio":"utsa","east tennessee state":"east tennessee state",
 "college of charleston":"college of charleston","charleston":"college of charleston"
};
const canon=v=>alias[norm(v)]||norm(v);

function parseCsv(text){
 const lines=String(text).trim().split(/\r?\n/),out=[];let head=null;
 for(const line of lines){
  const cells=[];let s="",q=false;
  for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(ch===","&&!q){cells.push(s);s=""}else s+=ch}cells.push(s);
  if(!head){head=cells;continue}
  out.push(Object.fromEntries(head.map((h,i)=>[h,cells[i]??""])));
 }
 return out;
}

function collectLatest(){
 const latest=new Map();
 for(const r of rows){
  const date=String(r.date||"");
  for(const side of ["home","away"]){
   const school=r[side],rating=r[side+"Rating"];
   if(!school||!rating||!Number.isFinite(num(rating.hca)))continue;
   const k=canon(school),prev=latest.get(k);
   if(!prev||date>prev.date)latest.set(k,{school,date,conference:rating.conference||null,hcaPpg:num(rating.hca),hcaGames:num(rating.hcaGames)||0,reliability:num(rating.reliability)});
  }
 }
 return latest;
}

async function elevations(points){
 const result=new Map();
 for(let i=0;i<points.length;i+=75){
  const batch=points.slice(i,i+75),lats=batch.map(x=>x.lat).join(","),lons=batch.map(x=>x.lng).join(",");
  try{
   const res=await fetch(ALTITUDE_URL+"?latitude="+encodeURIComponent(lats)+"&longitude="+encodeURIComponent(lons));
   if(!res.ok)throw new Error("HTTP "+res.status);
   const body=await res.json(),vals=Array.isArray(body.elevation)?body.elevation:[body.elevation];
   batch.forEach((p,j)=>{const m=num(vals[j]);if(m!=null)result.set(p.key,m)});
  }catch(err){console.warn("elevation batch failed",i,String(err?.message||err))}
 }
 return result;
}

const latest=collectLatest();
const arenaRes=await fetch(ARENAS_URL);if(!arenaRes.ok)throw new Error("arena source HTTP "+arenaRes.status);
const arenaRows=parseCsv(await arenaRes.text());
const arenaMap=new Map();
for(const a of arenaRows){
 const k=canon(a.team);if(!arenaMap.has(k))arenaMap.set(k,a);
}
const matched=[];
for(const [key,rec] of latest){
 let arena=arenaMap.get(key);
 if(!arena){
  // Unique containment fallback for source naming variants.
  const hits=arenaRows.filter(a=>canon(a.team).includes(key)||key.includes(canon(a.team)));
  if(hits.length===1)arena=hits[0];
 }
 matched.push({key,rec,arena:arena||null});
}
const points=matched.filter(x=>x.arena&&num(x.arena.lat)!=null&&num(x.arena.lng)!=null)
 .map(x=>({key:x.key,lat:num(x.arena.lat),lng:num(x.arena.lng)}));
const elev=await elevations(points);
let data=matched.map(x=>({
 school:x.rec.school,
 arena:x.arena?.arena||null,
 capacity:num(x.arena?.capacity),
 altitudeFt:elev.has(x.key)?Math.round(elev.get(x.key)*3.28084):null,
 hcaPpg:Number(x.rec.hcaPpg.toFixed(3)),
 hcaGames:x.rec.hcaGames,
 conference:x.rec.conference,
 reliability:x.rec.reliability,
 dataThrough:x.rec.date,
 venueSource:x.arena?"dilernia/NCAA ncaa_arenas_full.csv":null,
 altitudeSource:elev.has(x.key)?"Open-Meteo Elevation API at arena coordinates":null
}));
data.sort((a,b)=>b.hcaPpg-a.hcaPpg||a.school.localeCompare(b.school));
data=data.map((r,i)=>({rank:i+1,...r}));
const venueCoverage=data.length?100*data.filter(x=>x.arena&&x.capacity!=null).length/data.length:0;
const altitudeCoverage=data.length?100*data.filter(x=>x.altitudeFt!=null).length/data.length:0;
const report={id:"FBIS-CBB-HCA-RANKINGS-v1",generatedAt:new Date().toISOString(),model:"FBIS-CBB-HCA-v1",independent:true,kenpomInput:false,teams:data.length,venueCoveragePct:Number(venueCoverage.toFixed(2)),altitudeCoveragePct:Number(altitudeCoverage.toFixed(2)),data};
mkdirSync("artifacts",{recursive:true});
writeFileSync("artifacts/cbb-hca-rankings-v1.json",JSON.stringify(report,null,2));
const esc=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
const header=["Rank","School","Arena","Capacity","Altitude (ft)","FBIS HCA PPG","HCA Home Games","Conference","Reliability","Data Through","Venue Source","Altitude Source"];
const csv=[header.map(esc).join(","),...data.map(r=>[r.rank,r.school,r.arena,r.capacity,r.altitudeFt,r.hcaPpg,r.hcaGames,r.conference,r.reliability,r.dataThrough,r.venueSource,r.altitudeSource].map(esc).join(","))].join("\n");
writeFileSync("artifacts/cbb-hca-rankings-v1.csv",csv);
console.log(JSON.stringify({teams:data.length,venueCoveragePct:report.venueCoveragePct,altitudeCoveragePct:report.altitudeCoveragePct,top10:data.slice(0,10)},null,2));
