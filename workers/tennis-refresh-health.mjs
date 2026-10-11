/**
 * Independent Cloudflare-cron watchdog for GitHub's Tennis canonical refresh.
 * Read-only R2 latest markers; NEVER invokes paid collectors, refresh writes,
 * wagering/promotion hooks, or GitHub dispatches. Real scheduler != configured cron.
 */
export const TENNIS_HEALTH_CRON="37 * * * *";
export const TENNIS_MAX_AGE_MINUTES=Object.freeze({current:115,full:480});
const scopes=["current","full"];
const goodDate=value=>{
  const n=Date.parse(value||"");
  return Number.isFinite(n)?n:null;
};

export function evaluateTennisRefreshScope(scope,health,manifest,now=Date.now()) {
  const maxAge=TENNIS_MAX_AGE_MINUTES[scope];
  if(!maxAge)return {scope,state:"INVALID_SCOPE",ok:false};
  if(!health||!manifest)return {scope,state:"MISSING",ok:false,maxAgeMinutes:maxAge};
  const observed=goodDate(health.refreshCompletedAt);
  const started=goodDate(health.refreshStartedAt);
  const created=goodDate(manifest.refreshCompletedAt);
  const ageMinutes=observed==null?null:Math.max(0,(now-observed)/60000);
  const consistent=health.ok===true&&health.scope===scope&&manifest.scope===scope&&
    health.bet===false&&started!=null&&observed!=null&&started<=observed&&
    observed<=now+60000&&created===observed&&
    manifest.refreshStartedAt===health.refreshStartedAt&&
    Array.isArray(manifest.files)&&manifest.files.length===Number(health.files)&&
    Number(health.canonicalMatches)>0&&Number(health.players)>0&&
    Number.isInteger(Number(health.identityCollisions))&&
    Number(health.identityCollisions)>=0;
  const state=!consistent?"INVALID"
    :ageMinutes>maxAge?"STALE":"HEALTHY";
  return {
    scope,state,ok:state==="HEALTHY",
    lastCompletedAt:health.refreshCompletedAt||null,
    ageMinutes:ageMinutes==null?null:Math.round(ageMinutes*10)/10,
    maxAgeMinutes:maxAge,
    canonicalMatches:Number(health.canonicalMatches)||0,
    players:Number(health.players)||0,
    collisions:Number(health.identityCollisions)||0,
    files:Number(health.files)||0,
    workflowRunId:health.workflowRunId||null,
    bet:false,
  };
}

async function getR2Json(bucket,key) {
  const obj=await bucket.get(key);
  if(!obj)return null;
  return obj.json();
}

export async function checkTennisRefreshHealth(env,{now=Date.now()}={}) {
  if(!env?.R2_ARCHIVE?.get) {
    return {ok:false,status:"BLOCKED",reason:"R2_HEALTH_BINDING_MISSING",checkedAt:new Date(now).toISOString(),scopes:[]};
  }
  const results=await Promise.all(scopes.map(async scope=>{
    const prefix=`tennis/canonical/${scope}/latest/`;
    try{
      const [health,manifest]=await Promise.all([
        getR2Json(env.R2_ARCHIVE,prefix+"refresh-health.json"),
        getR2Json(env.R2_ARCHIVE,prefix+"source-manifest.json"),
      ]);
      return evaluateTennisRefreshScope(scope,health,manifest,now);
    }catch(error){
      return {scope,state:"READ_ERROR",ok:false,reason:String(error?.message||error).slice(0,130)};
    }
  }));
  const ok=results.every(r=>r.ok);
  return {ok,status:ok?"HEALTHY":"DEGRADED",scheduler:"CLOUDFLARE_INDEPENDENT_CRON",checkedAt:new Date(now).toISOString(),scopes:results};
}

export async function runTennisHealthCron(env,options={}) {
  const status=await checkTennisRefreshHealth(env,options);
  const event=status.ok?"tennis_refresh_scheduler_healthy":"tennis_refresh_scheduler_alert";
  (status.ok?console.log:console.error)(JSON.stringify({event,...status}));
  if(!status.ok)throw new Error("TENNIS_CANONICAL_REFRESH_STALE_OR_UNVERIFIED");
  return status;
}
