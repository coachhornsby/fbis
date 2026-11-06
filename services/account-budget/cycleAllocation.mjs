// Owner-approved fixed allocation; never an unlimited stale billing exception.
// Existing short-lived admission remains the default for every other policy.
export function validCycleAllocation(p, now) {
 const a=p?.cycleAllocation;
 if(!a||a.version!==1||a.ownerAuthorized!==true||a.source!=='CLOUDFLARE_BILLABLE_USAGE_BROWSER' ||
   !Number.isSafeInteger(a.observedUsageMicroUsd)||a.observedUsageMicroUsd<0||a.observedUsageMicroUsd>p.committedMicroUsd||
   !Number.isSafeInteger(a.maxReservedMicroUsd)||a.maxReservedMicroUsd<1||a.maxReservedMicroUsd>500000||
   p.committedMicroUsd<7000000||p.committedMicroUsd+a.maxReservedMicroUsd>8000000||
   p.expiresAtMs!==p.endMs||p.endMs-p.measuredAtMs>21*86400000||
   p.measuredAtMs>now||p.measuredAtMs<p.startMs||now>=p.endMs)return false;
 // These reserve only a portion of the verified remaining included allowances.
 const caps={requests:500000,r2Reads:2000000,r2Writes:500000,r2Lists:0,
   doDurationMs:2000000000,wsMessages:8000000,d1Queries:0,reads:0,writes:0};
 for(const [k,cap]of Object.entries(caps))if(!Number.isSafeInteger(p.unitCeilings?.[k])||p.unitCeilings[k]<0||p.unitCeilings[k]>cap)return false;
 return true;
}
