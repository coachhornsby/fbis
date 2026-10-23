#!/usr/bin/env node
/** Upload immutable, locally verified research rows; no model or wager updates. */
import fs from "node:fs";
import readline from "node:readline";
const dir=process.env.SDV_OUT||"artifacts/football-sdv";
const secret=process.env.HARVEST_SECRET,base=(process.env.FBIS_URL||"https://fbis-myz.pages.dev").replace(/\/$/,"");
if(!secret)throw Error("HARVEST_SECRET_REQUIRED");
const data={nfl:[],cfb:[]};
for await(const line of readline.createInterface({input:fs.createReadStream(dir+"/normalized-research-games.jsonl")})){
 if(!line.trim())continue;
 const g=JSON.parse(line);
 if(!["nfl","cfb"].includes(g.sport)||g.evidenceClass!=="POSTGAME_RECONSTRUCTED"||
   g.prospective!==false||g.officialScoreMatched!==true)throw Error("UNSAFE_ARCHIVE_RECORD");
 data[g.sport].push(g);
}
const summary={source:"SDV_POSTGAME_RECONSTRUCTED",canAuthorizeWager:false,bySport:{}};
for(const sport of ["nfl","cfb"]){
 let uploaded=0,inserted=0;
 const url=base+"/api/football-sdv-ingest";
 for(let i=0;i<data[sport].length;i+=8){
  const rows=data[sport].slice(i,i+8);
  const r=await fetch(url,{method:"POST",headers:{"x-harvest-secret":secret,"content-type":"application/json"},
   body:JSON.stringify({sport,games:rows})});
  const body=await r.json();
  if(!r.ok||body.ok!==true||body.canAuthorizeWager!==false||body.received!==rows.length)
   throw Error("D1_SDV_UPLOAD_FAILED:"+sport+":"+r.status+":"+String(body.error||"partial").slice(0,80));
  uploaded+=rows.length;inserted+=body.inserted||0;
 }
 const status=await fetch(url+"?sport="+sport,{headers:{"x-harvest-secret":secret}});
 const body=await status.json();
 if(!status.ok||body.ok!==true||body.canAuthorizeWager!==false||
   Number(body.counts?.games||0)<uploaded)throw Error("D1_SDV_READBACK_INCOMPLETE:"+sport);
 summary.bySport[sport]={uploaded,inserted,d1Games:body.counts.games,
  d1Drives:body.counts.drives};
 console.log(sport+" verified "+uploaded+" games inserted="+inserted+" stored="+body.counts.games);
}
fs.writeFileSync(dir+"/d1-upload-verified.json",JSON.stringify(summary,null,2));
