// Shared two-attempt Central-day policy. No source requests or timestamp renewal.
const DAY=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
const dayOf=now=>{const p=DAY.formatToParts(new Date(now)),v=t=>p.find(x=>x.type===t).value;return `${v('year')}-${v('month')}-${v('day')}`;};
export async function reserveCbbDailyCapture({bucket,now=Date.now(),existingCaptureAt=null,existingCaptureVerified=false,sameDayUnledgeredCaptureCount=null}={}){
 if(!bucket?.get||!bucket?.put)throw Error('CBB_DURABLE_STORAGE_REQUIRED');
 const date=dayOf(now),prefix=`private/cbb/refresh-budget/${date}/`,key=n=>prefix+`attempt-${n}.json`;
 async function read(n){const obj=await bucket.get(key(n));if(!obj)return null;const raw=await obj.text();if(raw.length>8192)throw Error('CBB_BUDGET_RECORD_TOO_LARGE');const r=JSON.parse(raw);if(r.date!==date||r.slot!==n||!Number.isFinite(Date.parse(r.startedAt))||Date.parse(r.startedAt)>now)throw Error('CBB_BUDGET_RECORD_INVALID');return r;}
 let slots=[await read(1),await read(2)];
 // Reconcile a verified same-day capture from the old runner, which lacked a claim.
 // This consumes capacity; it never erases a receipt or pretends a new request occurred.
 if(!slots.some(Boolean)&&existingCaptureAt!==null){
  const capture=Date.parse(existingCaptureAt);
  if(!existingCaptureVerified||!Number.isFinite(capture)||capture>now)throw Error('CBB_EXISTING_CAPTURE_UNVERIFIED');
  if(dayOf(capture)===date){
   if(sameDayUnledgeredCaptureCount!==1)throw Error('CBB_UNLEDGERED_ATTEMPTS_UNRECONCILED');
   await bucket.put(key(1),JSON.stringify({date,slot:1,startedAt:existingCaptureAt,status:'RECONCILED_VERIFIED_CAPTURE',source:'existing-private-packet'}),{onlyIf:{etagDoesNotMatch:'*'}});
   slots=[await read(1),await read(2)];
   if(!slots[0])throw Error('CBB_RECONCILIATION_UNCONFIRMED');
  }
 }
 if(slots.filter(Boolean).length>=2)return {allowed:false,reason:'CBB_DAILY_ATTEMPTS_EXHAUSTED',date};
 if(slots.some(r=>r&&now-Date.parse(r.startedAt)<3*3600000))return {allowed:false,reason:'CBB_THREE_HOUR_COOLDOWN',date};
 const slot=slots[0]?2:1,claim={date,slot,startedAt:new Date(now).toISOString(),status:'ATTEMPT_RESERVED',source:'bounded-runner'};
 const written=await bucket.put(key(slot),JSON.stringify(claim),{onlyIf:{etagDoesNotMatch:'*'}});
 if(!written)return {allowed:false,reason:'CBB_CONCURRENT_CLAIM',date};
 return {allowed:true,date,slot,maxDailyAttempts:2,maxProviderCalls:1};
}
