/**
 * Independent fail-closed GitHub Actions recovery for a missed Tennis canonical
 * refresh. Cloudflare supplies the clock; the original restricted GitHub
 * runner performs the computational rebuild and R2 immutable/latest writes.
 *
 * The only permitted write is workflow_dispatch of tennis-refresh.yml on
 * main for current or full. No betting authority, paid provider fallback,
 * untrusted source import, or historical snapshot changes.
 */
import { checkTennisRefreshHealth } from "./tennis-refresh-health.mjs";

export const TENNIS_RECOVERY_CRON="27,57 * * * *";
export const TENNIS_RECOVERY_WORKFLOW="tennis-refresh.yml";
export const TENNIS_RECOVERY_REPOSITORY="coachhornsby/fbis";
export const TENNIS_RECOVERY_AGE_MINUTES=Object.freeze({current:85,full:405});
export const TENNIS_RECOVERY_GLOBAL_COOLDOWN_MINUTES=50;
export const TENNIS_RECOVERY_SCOPE_COOLDOWN_MINUTES=Object.freeze({current:85,full:330});
const ACTIVE=new Set(["queued","pending","waiting","requested","in_progress"]);
const MAX_RUN_LOOKBACK_MINUTES=60;
const LAST_DISPATCH_KEY="tennis/ops/recovery/last-dispatch.json";
const SCOPE_KEYS=Object.freeze({
  current:"tennis/ops/recovery/current-last-dispatch.json",
  full:"tennis/ops/recovery/full-last-dispatch.json",
});
const nowIso=(now)=>new Date(now).toISOString();
const minutesSince=(value,now)=>{
  const t=Date.parse(value||"");
  return Number.isFinite(t)?(now-t)/60000:null;
};
const status=(state,props={})=>({state,...props,bet:false,canQualify:false,canAuthorizeWager:false});
const enabled=env=>String(env?.TENNIS_RECOVERY_ENABLED||"false").toLowerCase()==="true";

export function selectTennisRecoveryScope(health,{now=Date.now()}={}) {
  if(!health || !Array.isArray(health.scopes) || health.scopes.length!==2)
    return {scope:null,reason:"HEALTH_EVIDENCE_UNAVAILABLE"};
  const current=health.scopes.find(s=>s.scope==="current");
  const full=health.scopes.find(s=>s.scope==="full");
  if(!current||!full)return {scope:null,reason:"HEALTH_EVIDENCE_INCOMPLETE"};
  // Malformed source evidence is an identity/integrity incident, not a
  // scheduling failure. Never auto-rebuild over unknown contamination.
  if([current,full].some(s=>!["HEALTHY","STALE"].includes(s.state)))
    return {scope:null,reason:"SOURCE_INTEGRITY_UNVERIFIED"};
  if(full.state==="STALE" &&
     full.ageMinutes>=TENNIS_RECOVERY_AGE_MINUTES.full)
    return {scope:"full",reason:"FULL_SCHEDULE_MISSED",ageMinutes:full.ageMinutes};
  if(current.state==="STALE" &&
     current.ageMinutes>=TENNIS_RECOVERY_AGE_MINUTES.current)
    return {scope:"current",reason:"CURRENT_SCHEDULE_MISSED",ageMinutes:current.ageMinutes};
  return {scope:null,reason:health.ok?"FRESH":"NOT_PAST_RECOVERY_THRESHOLD"};
}

async function readMarker(bucket,key) {
  const obj=await bucket.get(key);
  if(!obj)return null;
  const value=await obj.json();
  if(!value||typeof value!=="object")throw new Error("RECOVERY_MARKER_INVALID");
  return value;
}

export function reviewRecentTennisRuns(runs,now=Date.now()) {
  if(!Array.isArray(runs))return {ok:false,reason:"GITHUB_RUN_LIST_MALFORMED"};
  for(const run of runs){
    if(run?.head_branch && run.head_branch!=="main")continue;
    const ago=minutesSince(run?.created_at,now);
    if(ago==null || ago < -2)continue;
    if(ACTIVE.has(String(run.status||"")))
      return {ok:true,blocked:true,reason:"GITHUB_REFRESH_ALREADY_RUNNING",runId:run.id||null};
    if(run.event==="workflow_dispatch" && ago<MAX_RUN_LOOKBACK_MINUTES)
      return {ok:true,blocked:true,reason:"RECENT_DISPATCH_ALREADY_OBSERVED",runId:run.id||null};
  }
  return {ok:true,blocked:false};
}

function bearerHeaders(token) {
  return {
    "authorization":`Bearer ${token}`,
    "accept":"application/vnd.github+json",
    "x-github-api-version":"2022-11-28",
    "user-agent":"fbis-tennis-cloudflare-recovery",
  };
}

async function githubGetRuns(token,request) {
  const base=`https://api.github.com/repos/${TENNIS_RECOVERY_REPOSITORY}/actions/workflows/${TENNIS_RECOVERY_WORKFLOW}/runs`;
  const response=await request(`${base}?per_page=50&branch=main`,{
    headers:bearerHeaders(token),
    signal:AbortSignal.timeout(16000),
  });
  if(!response.ok)throw new Error(`GITHUB_WORKFLOW_READ_HTTP_${response.status}`);
  const body=await response.json();
  if(!Array.isArray(body.workflow_runs))throw new Error("GITHUB_WORKFLOW_RUNS_MALFORMED");
  return body.workflow_runs;
}

async function dispatch(token,scope,slot,request) {
  const url=`https://api.github.com/repos/${TENNIS_RECOVERY_REPOSITORY}/actions/workflows/${TENNIS_RECOVERY_WORKFLOW}/dispatches`;
  const response=await request(url,{
    method:"POST",
    headers:{...bearerHeaders(token),"content-type":"application/json"},
    body:JSON.stringify({ref:"main",inputs:{scope,recovery_slot:slot}}),
    signal:AbortSignal.timeout(16000),
  });
  // NEVER retry a dispatch with an ambiguous outcome; GitHub might already
  // have accepted it despite a connection loss.
  if(response.status!==204)throw new Error(`GITHUB_WORKFLOW_DISPATCH_HTTP_${response.status}`);
}

/**
 * No mutation is allowed before health evidence, GitHub in-flight check and
 * persistent marker cooldown gates. Cron receives at most one dispatch/scope.
 */
export async function recoverStaleTennis(env,{
  now=Date.now(),request=fetch,health=null,scheduledTime=now,
}={}) {
  const checkedAt=nowIso(now);
  if(!enabled(env))return status("DISABLED",{checkedAt});
  if(!env?.R2_ARCHIVE?.get||!env?.R2_ARCHIVE?.put)
    return status("BLOCKED",{checkedAt,reason:"R2_RECOVERY_STATE_UNAVAILABLE"});
  const token=String(env?.TENNIS_GITHUB_DISPATCH_TOKEN||"").trim();
  if(!token)return status("BLOCKED",{checkedAt,reason:"GITHUB_DISPATCH_CREDENTIAL_NOT_CONFIGURED"});
  if(!Number.isFinite(Number(scheduledTime)) ||
     Math.abs(now-Number(scheduledTime))>5*60000)
    return status("BLOCKED",{checkedAt,reason:"STALE_CLOUDFLARE_SCHEDULE_EVENT"});
  const evidence=health||await checkTennisRefreshHealth(env,{now});
  const target=selectTennisRecoveryScope(evidence,{now});
  if(!target.scope)return status(target.reason==="FRESH"?"NOT_DUE":"BLOCKED",{
    checkedAt,reason:target.reason,
  });
  const scope=target.scope;
  const global=await readMarker(env.R2_ARCHIVE,LAST_DISPATCH_KEY);
  const scopeMarker=await readMarker(env.R2_ARCHIVE,SCOPE_KEYS[scope]);
  const globalAgo=minutesSince(global?.dispatchedAt,now);
  const scopeAgo=minutesSince(scopeMarker?.dispatchedAt,now);
  if(global && (globalAgo==null||globalAgo<0 ||
      globalAgo<TENNIS_RECOVERY_GLOBAL_COOLDOWN_MINUTES))
    return status("COOLDOWN",{checkedAt,scope,reason:"GLOBAL_DISPATCH_COOLDOWN"});
  if(scopeMarker && (scopeAgo==null||scopeAgo<0 ||
      scopeAgo<TENNIS_RECOVERY_SCOPE_COOLDOWN_MINUTES[scope]))
    return status("COOLDOWN",{checkedAt,scope,reason:"SCOPE_DISPATCH_COOLDOWN"});
  const observed=reviewRecentTennisRuns(await githubGetRuns(token,request),now);
  if(!observed.ok)throw new Error(observed.reason);
  if(observed.blocked)return status("IN_PROGRESS",{
    checkedAt,scope,reason:observed.reason,existingRunId:observed.runId,
  });
  const slot=nowIso(scheduledTime);
  await dispatch(token,scope,slot,request);
  const marker={version:1,scope,dispatchedAt:checkedAt,slot,reason:target.reason,
    ageMinutes:target.ageMinutes,source:"CLOUDFLARE_CANONICAL_RECOVERY"};
  // No keys, tokens or user data in R2. This marker is NOT an assertion that
  // the workflow completed or that the data became healthy.
  await env.R2_ARCHIVE.put(LAST_DISPATCH_KEY,JSON.stringify(marker));
  await env.R2_ARCHIVE.put(SCOPE_KEYS[scope],JSON.stringify(marker));
  return status("DISPATCHED",{checkedAt,scope,slot,reason:target.reason});
}

export async function runTennisRecoveryCron(env,{scheduledTime,now=Date.now(),
  request=fetch}={}) {
  const health=await checkTennisRefreshHealth(env,{now});
  const result=await recoverStaleTennis(env,{now,scheduledTime,request,health});
  console.log(JSON.stringify({
    event:"tennis_canonical_recovery_cron",
    health:health.status,
    result,
  }));
  if(result.state==="BLOCKED"&&result.reason!=="NOT_PAST_RECOVERY_THRESHOLD")
    throw new Error(`TENNIS_RECOVERY_BLOCKED_${result.reason}`);
  return {ok:health.ok||["DISPATCHED","IN_PROGRESS","COOLDOWN","NOT_DUE"].includes(result.state),
    health:health.status,recovery:result};
}
