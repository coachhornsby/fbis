import {mkdir,writeFile,appendFile} from "node:fs/promises";
const base=process.env.BASE||"https://fbis-myz.pages.dev";
const secret=process.env.HARVEST_SECRET;
if(!secret)throw Error("EXISTING_COLLECTION_AUTH_REQUIRED");
const day=new Date();day.setUTCHours(0,0,0,0);
const results=[],errors=[];
for(const offset of [0,1,2]){
 const date=new Date(day.getTime()+86400000*offset).toISOString().slice(0,10).replaceAll("-","");
 for(const tour of ["atp","wta"]){
  try{
   const response=await fetch(base+"/api/tennis-external-fixtures",{
    method:"POST",headers:{"content-type":"application/json","x-harvest-secret":secret},
    body:JSON.stringify({tour,date}),signal:AbortSignal.timeout(50000)});
   const result=await response.json();
   if(!response.ok||result.ok!==true)throw Error("SOURCE_HTTP_"+response.status+"_"+result.error);
   results.push({tour,date,providerEvents:result.providerEvents,
    verifiedFixtures:result.verifiedFixtures,persisted:result.persisted,
    rejects:result.rejections,rawHash:result.rawHash});
  }catch(error){errors.push({tour,date,error:String(error?.message||error).slice(0,160)})}
 }
}
const summary={ok:errors.length===0,source:"ESPN_PUBLIC",collectedAt:new Date().toISOString(),
 results,errors,verifiedFixtures:results.reduce((n,r)=>n+r.verifiedFixtures,0),
 coveredRequests:results.length,expectedRequests:6,complete:results.length===6,
 sourceOfficial:false,modelAuthorityChanged:false,actionNetworkTouched:false,
 paidPinnoddsCalls:0,canAuthorizeWager:false};
await mkdir("artifacts",{recursive:true});
await writeFile("artifacts/tennis-external-fixtures.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
 "### Tennis independent fixtures (research only)\n"+
 "ESPN requests: "+results.length+"/6; verified fixtures: "+summary.verifiedFixtures+
 "; failed scopes: "+errors.length+"\n");
if(errors.length)process.exitCode=1;
