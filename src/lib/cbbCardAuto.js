import {validateCbbCardSummary} from '../../functions/lib/cbbCardSummary.js';
export async function loadCbbCardSummary(date){
 const r=await fetch('/api/public/cbb/'+date,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error(r.status===404?'NO_CBB_SNAPSHOT':'CBB_OUTPUT_UNAVAILABLE');
 const v=await r.json();if(v.ok!==true||v.date!==date)throw Error('INVALID_CBB_RESPONSE');
 return {packet:validateCbbCardSummary(v.packet,{date}),offers:[]};
}

// R2 summary reads only. Never regenerates forecasts or calls a licensed provider.
export const CBB_SUMMARY_RECHECK_MS=20*60*1000;
export const CBB_SUMMARY_MIN_READ_MS=60*1000;
export function startCbbSummaryRefresh({date,onUpdate,onError,load=loadCbbCardSummary,
 now=Date.now,isVisible=()=>true,isCurrentDate=()=>true,
 setTimer=setInterval,clearTimer=clearInterval,listen}={}){
 let stopped=false,busy=false,lastAttempt=-Infinity,packet=null;
 async function refresh(force=false){
  if(stopped||busy||!isVisible()||now()-lastAttempt<CBB_SUMMARY_MIN_READ_MS)return;
  if(!force&&packet&&Date.parse(packet.expiresAt)>now())return;
  busy=true;lastAttempt=now();
  try{const result=await load(date);if(!stopped){packet=result.packet;onUpdate(result);}}
  catch(error){if(!stopped)onError?.(error);}
  finally{busy=false;}
 }
 // An initially hidden tab still gets its first read when visible, for any date.
 const tick=()=>{if(isCurrentDate()||lastAttempt===-Infinity)void refresh();};
 const timer=setTimer(tick,CBB_SUMMARY_RECHECK_MS),unlisten=listen?.(tick);
 void refresh(true);
 return {refresh:()=>refresh(true),stop(){stopped=true;clearTimer(timer);unlisten?.();}};
}
