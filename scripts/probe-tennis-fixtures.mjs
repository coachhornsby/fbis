// Public read-only diagnostics for the ESPN tennis schedule contract.
// No credentials or provider-price requests.
const date=new Date().toISOString().slice(0,10).replaceAll("-","");
for(const tour of ["atp","wta"]){
 const url="https://site.api.espn.com/apis/site/v2/sports/tennis/"+tour+"/scoreboard?dates="+date;
 try{
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
  const body=await response.json();
  const event=body?.events?.[0]||body?.tournaments?.[0]?.events?.[0];
  const comp=event?.competitions?.[0];
  console.log(JSON.stringify({source:"ESPN_PUBLIC",tour,httpStatus:response.status,
   keys:Object.keys(body||{}).slice(0,20),events:body?.events?.length??null,
   tournaments:body?.tournaments?.length??null,
   firstEventFields:Object.keys(event||{}).slice(0,20),
   competitionFields:Object.keys(comp||{}).slice(0,20),
   competitorFields:Object.keys(comp?.competitors?.[0]||{}).slice(0,20),
   sourceContractVerified:response.ok&&Array.isArray(body?.events||body?.tournaments)}));
 }catch(error){console.log(JSON.stringify({tour,source:"ESPN_PUBLIC",
  error:String(error?.message||error).slice(0,100),sourceContractVerified:false}));}
}
