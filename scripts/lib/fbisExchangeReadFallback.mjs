/**
 * Split an expensive all-sport exchange read only when its provenance/transport
 * is incomplete. Sport reads may succeed independently of a 503 on the global
 * aggregation path. Never infer a missing provider contract from a failed read.
 */
const cleanError=e=>String(e?.message||e||'READ_FAILED').slice(0,160);
const complete=x=>Array.isArray(x?.rows)&&x.degraded!==true&&
 !(x.diagnostics||[]).some(d=>d?.status==='READ_FAILED'||d?.truncated===true);
export async function readExchangeWithSportFallback({request,sports=[],date,timeoutMs=95000}={}){
 const scope=[...new Set(sports)].filter(s=>typeof s==='string'&&/^[a-z]{2,12}$/.test(s));
 if(!scope.length)return {exchange:{rows:[],coverage:[],collectorCoverage:[],diagnostics:[]},
  failedSports:[],fallbackUsed:false,initialFailure:null};
 const path=s=>'/api/exchange-player-props?'+new URLSearchParams({sport:s,date});
 let initialFailure=null;
 try {
  const combined=await request(path('all'),{timeoutMs});
  if(complete(combined))return {exchange:combined,failedSports:[],fallbackUsed:false,initialFailure:null};
  initialFailure='ALL_SPORT_RESPONSE_INCOMPLETE';
 }catch(e){initialFailure=cleanError(e);}
 const results=new Array(scope.length),failures=new Array(scope.length);
 let cursor=0;
 async function worker(){
  while(cursor<scope.length){
   const i=cursor++,sport=scope[i];
   try {
    const data=await request(path(sport),{timeoutMs});
    if(!complete(data))throw Error('SPORT_RESPONSE_INCOMPLETE');
    // Do not accept another sport's rows from a sport-specific fallback.
    if(data.rows.some(r=>r.sport!==sport))throw Error('SPORT_RESPONSE_SCOPE_MISMATCH');
    results[i]=data;
   }catch(e){failures[i]={sport,reason:cleanError(e)};}
  }
 }
 await Promise.all(Array.from({length:Math.min(2,scope.length)},()=>worker()));
 const valid=results.filter(Boolean);
 return {exchange:{
  rows:valid.flatMap(r=>r.rows),
  coverage:valid.flatMap(r=>Array.isArray(r.coverage)?r.coverage:[]),
  collectorCoverage:valid.flatMap(r=>Array.isArray(r.collectorCoverage)?r.collectorCoverage:[]),
  diagnostics:valid.flatMap(r=>Array.isArray(r.diagnostics)?r.diagnostics:[]),
  degraded:failures.some(Boolean),ok:!failures.some(Boolean)
 },failedSports:failures.filter(Boolean),fallbackUsed:true,initialFailure};
}
