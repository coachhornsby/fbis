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
  if(result.status===200&&result.body?.ok===true&&result.body.canAuthorizeWager===false&&result.body.slateCapacity>=240&&
    result.body.gradingContract==="SDV_FINALS_V3_REVISION_AUDIT"&&
    result.body.readinessContract==="SDV_READINESS_V1"&&
    result.body.supportedVariants?.includes("nfl-sdv-v031")){
   ready=true;break;
  }
 }catch(e){console.log("prospective API not live, attempt",attempt+1,String(e).slice(0,100))}
 await sleep(15000);
}
if(!ready)throw Error("PROSPECTIVE_API_NOT_DEPLOYED_OR_UNHEALTHY");
for(const sport of ["nfl","cfb"]){
 const s=summary.sport[sport]={slate:0,new:0,existing:0,skipped:{},failures:0,grades:null,variants:{}};
 const response=await request("/api/football-sdv-prospective?sport="+sport);
 if(response.status!==200||response.body.ok!==true||response.body.canAuthorizeWager!==false||
    response.body.gradingContract!=="SDV_FINALS_V3_REVISION_AUDIT"||
    response.body.readinessContract!=="SDV_READINESS_V1")
  throw Error("PROSPECTIVE_SLATE_UNAVAILABLE:"+sport);
 const slate=response.body.upcoming.slice(0,240);
 s.slate=slate.length;
 const variants=sport==="nfl"?["standard","nfl-sdv-v031"]:["standard"];
 if(!variants.every(v=>response.body.supportedVariants?.includes(v)))
  throw Error("PROSPECTIVE_VARIANT_RELEASE_NOT_READY:"+sport);
 for(const variant of variants)s.variants[variant]={new:0,existing:0,skipped:{}};
 for(const g of slate){
  for(const variant of variants){
   const v=s.variants[variant];
   try{
    const r=await request("/api/football-sdv-prospective?sport="+sport,
     {action:"capture",gameId:g.gameId,variant});
    if(r.body.ok===true&&r.body.canAuthorizeWager===false&&r.body.variant===variant&&
      (variant!=="nfl-sdv-v031"||r.body.modelId==="NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3.1")){
     if(r.body.status==="NEW"){s.new++;v.new++}
     else{s.existing++;v.existing++}
    }else if(r.status===422&&r.body.canAuthorizeWager===false){
     const reason=r.body.reason||r.body.error||"NO_EVIDENCE";
     s.skipped[variant+":"+reason]=(s.skipped[variant+":"+reason]||0)+1;
     v.skipped[reason]=(v.skipped[reason]||0)+1;
    }else{s.failures++;console.log(sport,g.gameId,variant,"capture rejected",r.status,r.body.error)}
   }catch(e){s.failures++;console.log(sport,g.gameId,variant,String(e))}
  }
 }
 const grade=await request("/api/football-sdv-prospective?sport="+sport,{action:"grade"});
 if(grade.status!==200||grade.body.ok!==true||grade.body.canAuthorizeWager!==false)
  throw Error("PROSPECTIVE_GRADING_FAILED:"+sport);
 s.grades=grade.body;
 const integrity=await request("/api/football-sdv-prospective?sport="+sport+"&mode=integrity");
 if(integrity.status!==200||integrity.body?.canAuthorizeWager!==false ||
    integrity.body?.canQualify!==false ||
    !Number.isInteger(integrity.body.checked)||
    !Number.isInteger(integrity.body.incidentCount)||
    integrity.body.incidentCount>0 ||
    !["NO_GRADED_PROSPECTIVE_EVIDENCE","CONSISTENT_WITH_VERIFIED_SOURCE"].includes(integrity.body.status))
  throw Error("PROSPECTIVE_POST_GRADE_SOURCE_INTEGRITY_FAILURE:"+sport+":"+
    JSON.stringify(integrity.body).slice(0,300));
 s.postGradeIntegrity={checked:integrity.body.checked,
  incidentCount:integrity.body.incidentCount,status:integrity.body.status};
 if(!Number.isInteger(s.grades.sourceConflicts) ||
    s.grades.sourceConflicts>0 ||
    !Number.isInteger(s.grades.pendingNotGraded) ||
    s.grades.canAuthorizeWager!==false)
  throw Error("PROSPECTIVE_GRADE_LEDGER_INTEGRITY_FAILURE:"+sport);
 const performance=await request("/api/football-sdv-prospective?sport="+sport+"&mode=performance");
 if(performance.status!==200||performance.body.sport!==sport||
   performance.body.canAuthorizeWager!==false||performance.body.calibrated!==false)
  throw Error("PROSPECTIVE_PERFORMANCE_UNSAFE:"+sport);
 const readiness=await request("/api/football-sdv-prospective?sport="+sport+"&mode=readiness");
 if(readiness.status!==200||readiness.body?.sport!==sport||readiness.body.canAuthorizeWager!==false||!Number.isInteger(readiness.body.receiptCount))throw Error("PROSPECTIVE_READINESS_REPORT_UNAVAILABLE:"+sport);
 s.readiness={receipts:readiness.body.receiptCount,physicalGames:readiness.body.distinctPhysicalGames,overduePhysicalGames:readiness.body.overduePhysicalGames,sourceAgeHours:readiness.body.sourceAgeHours,models:readiness.body.models};
 s.gradedSample=performance.body.n;
 s.metricState=performance.body.status;
 s.gradedPerModel=performance.body.gradedPerModel||{};
 const pairedPath=sport==="nfl"?"/api/football-sdv-prospective?sport=nfl&mode=paired":
   "/api/cfb-sdv-prospective-paired";
 const pair=await request(pairedPath);
 if(pair.status!==200||pair.body?.canAuthorizeWager!==false ||
   pair.body?.canQualify!==false ||!Number.isInteger(pair.body?.n))
  throw Error("PROSPECTIVE_PAIRED_EVALUATION_UNAVAILABLE:"+sport);
 s.paired={n:pair.body.n,status:pair.body.status,
  baseline:pair.body.standardModelId||pair.body.championModelId,
  challenger:pair.body.transitionModelId||pair.body.challengerModelId,
  canAuthorizeWager:false};
}
console.log(JSON.stringify(summary,null,2));
fs.mkdirSync("artifacts/football-sdv",{recursive:true});
fs.writeFileSync("artifacts/football-sdv/prospective-cycle.json",JSON.stringify(summary,null,2));
if(summary.sport.nfl.failures+summary.sport.cfb.failures>0)
 throw Error("PROSPECTIVE_CAPTURE_HAS_SERVICE_FAILURES");
