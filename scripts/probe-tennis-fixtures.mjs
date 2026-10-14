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
   groupingsType:Array.isArray(event?.groupings)?"array":typeof event?.groupings,
   groupingsLength:event?.groupings?.length??null,
   groupingFields:Object.keys(event?.groupings?.[0]||{}).slice(0,25),
   groupingSummary:(event?.groupings||[]).slice(0,3).map(g=>({name:g.name||null,keys:Object.keys(g||{}).slice(0,25),
    competitions:g.competitions?.length??null,groups:g.groups?.length??null,
    firstCompetitionFields:Object.keys(g.competitions?.[0]||{}).slice(0,22),
    sampleCompetition:(()=>{const c=g.competitions?.find(c=>c?.competitors?.length===2)||g.competitions?.[0];return c?{
     date:c.date,startDate:c.startDate,timeValid:c.timeValid,type:c.type,format:c.format,
     state:c.status?.type?.state,competitors:c.competitors?.length,
     firstCompetitorFields:Object.keys(c.competitors?.[0]||{}),
     firstAthleteFields:Object.keys(c.competitors?.[0]?.athlete||{}).slice(0,15),
     firstCompetitorName:c.competitors?.[0]?.athlete?.displayName||c.competitors?.[0]?.displayName||null
    }:null})(),
    firstGroupFields:Object.keys(g.groups?.[0]||{}).slice(0,22)})),
   sourceContractVerified:response.ok&&Array.isArray(body?.events||body?.tournaments)}));
 }catch(error){console.log(JSON.stringify({tour,source:"ESPN_PUBLIC",
  error:String(error?.message||error).slice(0,100),sourceContractVerified:false}));}
}
