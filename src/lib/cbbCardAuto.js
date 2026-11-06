import {validateCbbCardSummary} from '../../functions/lib/cbbCardSummary.js';
export async function loadCbbCardSummary(date){
 const r=await fetch('/api/public/cbb/'+date,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error(r.status===404?'NO_CBB_SNAPSHOT':'CBB_OUTPUT_UNAVAILABLE');
 const v=await r.json();if(v.ok!==true||v.date!==date)throw Error('INVALID_CBB_RESPONSE');
 return {packet:validateCbbCardSummary(v.packet,{date}),offers:[]};
}
