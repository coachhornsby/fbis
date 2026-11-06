import {beginJobExecution} from './account-budget/jobScope.mjs';
export const EXCHANGE_DIAGNOSTIC_JOB='services/exchangeDiagnostics.mjs';
export async function recordExchangeDiagnostic(original,name,result){
 try{const env=await beginJobExecution(original,EXCHANGE_DIAGNOSTIC_JOB);const raw=String(result?.code||result?.error||result?.message||'UNKNOWN');const code=/^[A-Za-z0-9_:-]{1,100}$/.test(raw)?raw:'UNCLASSIFIED_FAILURE';await env.ARCHIVE.put('exchange-runtime/v1/'+name+'.json',JSON.stringify({capturedAt:new Date().toISOString(),ok:result?.ok===true,code,canAuthorizeWager:false}));}catch{}
}
