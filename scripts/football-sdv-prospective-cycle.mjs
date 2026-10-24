#!/usr/bin/env node
/** Controlled prospective snapshot capture and postgame grading. */
import fs from "node:fs";
const root=(process.env.FBIS_URL||"https://fbis-myz.pages.dev").replace(/\/$/,"");
const secret=process.env.HARVEST_SECRET;
if(!secret)throw Error("HARVEST_SECRET_REQUIRED");
const headers={"x-harvest-secret":secret,"content-type":"application/json"};
const summary={capturedAt:new Date().toISOString(),sport:{},canAuthorizeWager:false};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(url,body){
 const x=await fetch(root+url,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined,
  signal:AbortSignal.timeout(100000)});
 let json;
 try{json=await x.json()}catch{throw Error("INVALID_PROSPECTIVE_RESPONSE:"+x.status+":"+String(x.headers.get("content-type"))?.slice(0,80))}
 return {status:x.status,body:json};
}
// Initial on-push workflow may start before Pages deploy finishes. Require JSON
// from the exact live API before any pregame capture writes.
let ready=false;
for(let attempt=0;attempt<60;attempt++){
 try{
  const result=await request("/api/football-sdv-prospective?sport=nfl");
  if(result.status===200&&result.body?.ok===true&&result.body.canAuthorizeWager===false){
   ready=true;break;
  }
 }catch(e){console.log("prospective API not live, attempt",attempt+1,String(e).slice(0,100))}
 await sleep(15000);
}
if(!ready)throw Error("PROSPECTIVE_API_NOT_DEPLOYED_OR_UNHEALTHY");
for(const sport of ["nfl","cfb"]){
 const s=summary.sport[sport]={slate:0,new:0,existing:0,skipped:{},failures:0,grades:null};
 const response=await request("/api/football-sdv-prospective?sport="+sport);
 if(response.status!==200||response.body.ok!==true||response.body.canAuthorizeWager!==false)
  throw Error("PROSPECTIVE_SLATE_UNAVAILABLE:"+sport);
 const slate=response.body.upcoming.slice(0,80);
 s.slate=slate.length;
 for(const g of slate){
  try{
   const r=await request("/api/football-sdv-prospective?sport="+sport,
    {action:"capture",gameId:g.gameId});
   if(r.body.ok===true&&r.body.canAuthorizeWager===false){
    if(r.body.status==="NEW")s.new++;else s.existing++;
   }else if(r.status===422&&r.body.canAuthorizeWager===false){
    const reason=r.body.reason||r.body.error||"NO_EVIDENCE";
    s.skipped[reason]=(s.skipped[reason]||0)+1;
   }else{s.failures++;console.log(sport,g.gameId,"capture rejected",r.status,r.body.error)}
  }catch(e){s.failures++;console.log(sport,g.gameId,String(e))}
 }
 const grade=await request("/api/football-sdv-prospective?sport="+sport,{action:"grade"});
 if(grade.status!==200||grade.body.ok!==true||grade.body.canAuthorizeWager!==false)
  throw Error("PROSPECTIVE_GRADING_FAILED:"+sport);
 s.grades=grade.body;
 const performance=await request("/api/football-sdv-prospective?sport="+sport+"&mode=performance");
 if(performance.status!==200||performance.body.sport!==sport||
   performance.body.canAuthorizeWager!==false||performance.body.calibrated!==false)
  throw Error("PROSPECTIVE_PERFORMANCE_UNSAFE:"+sport);
 s.gradedSample=performance.body.n;
 s.metricState=performance.body.status;
}
console.log(JSON.stringify(summary,null,2));
fs.mkdirSync("artifacts/football-sdv",{recursive:true});
fs.writeFileSync("artifacts/football-sdv/prospective-cycle.json",JSON.stringify(summary,null,2));
if(summary.sport.nfl.failures+summary.sport.cfb.failures>0)
 throw Error("PROSPECTIVE_CAPTURE_HAS_SERVICE_FAILURES");
