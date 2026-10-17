// Authoritative CFBD acquisition receipts. D1 is required for production HTTP.
// One permitted URL/query per America/Chicago day across all Pages isolates.
// No bearer tokens, payloads or private headers are stored in receipts.
const receiptDate = (now) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year:"numeric", month:"2-digit", day:"2-digit" })
    .formatToParts(new Date(now));
  const get = t => p.find(x => x.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const positive = (value, fallback) => {
  const v = Number(value);
  return Number.isInteger(v) && v > 0 ? v : fallback;
};
export async function cfbdRequestHash(url) {
  const u = new URL(url);
  // Preserve historical CFBD hashes while separating CBBD requests with the
  // same path/query (the two APIs share the subscription quota).
  // GraphQL uses the same CFBD entitlement; a smaller response is NOT assumed cheaper.
  const sourcePrefix=u.hostname==="api.collegebasketballdata.com"?"cbbd:"
    :u.hostname==="graphql.collegefootballdata.com"?"cfbd-graphql:":"";
  const text = sourcePrefix + u.pathname + "?" + [...u.searchParams.entries()].sort(([a,av],[b,bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&");
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { hash: [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join(""), endpoint:sourcePrefix+u.pathname };
}
export async function reserveCfbdRequest(env, url, now = Date.now()) {
  const hostname=new URL(url).hostname;
  const basketball=hostname==="api.collegebasketballdata.com";
  const graphql=hostname==="graphql.collegefootballdata.com";
  if (!basketball && !graphql && hostname!=="api.collegefootballdata.com") return {allowed:false,reason:"COLLEGE_UNKNOWN_HOST"};
  // GraphQL shares the CFBD owner flag and the shared monthly budget with REST.
  if (basketball ?
      (env.cbbdCacheOnly || env.cbbdNetworkAuthorized !== true) :
      (env.cfbdCacheOnly || env.cfbdNetworkAuthorized !== true))
    return { allowed:false, reason:"COLLEGE_OWNER_DENIED" };
  if (!env.DB?.prepare) return { allowed:false, reason:"CFBD_D1_REQUIRED" };
  const day=receiptDate(now), month=new Date(now).toISOString().slice(0,7);
  const {hash,endpoint}=await cfbdRequestHash(url);
  const daily=positive(env.CFBD_DAILY_NETWORK_BUDGET,45);
  const monthly=positive(env.CFBD_MONTHLY_NETWORK_BUDGET,1400);
  // Tier 3 provider allowance is 75k; retain 5k safety reserve.
  // This is not a substitute for the provider-confirmed remaining-call stop.
  const providerSafe=Math.min(67500,positive(env.CFBD_SHARED_PROVIDER_SAFE_BUDGET,67500));
  try {
    // One statement: atomic D1 quota checks + idempotent reservation.
    const res=await env.DB.prepare(`
      INSERT OR IGNORE INTO cfb_cfbd_acquisition_receipts
        (request_day,request_hash,request_month,endpoint,request_status,acquired_at)
      SELECT ?,?,?,?,'reserved',?
      WHERE (SELECT blocked_until_ms FROM cfb_cfbd_acquisition_control WHERE id=1) <= ?
        AND (SELECT COUNT(*) FROM cfb_cfbd_acquisition_receipts WHERE request_day=?) < ?
        AND (SELECT COUNT(*) FROM cfb_cfbd_acquisition_receipts WHERE request_month=?) < ?
        AND (
          (SELECT COALESCE(last_remaining,1000000) FROM cfb_cfbd_acquisition_control WHERE id=1) > 100
          OR COALESCE((SELECT request_month FROM cfb_cfbd_acquisition_receipts
            WHERE provider_remaining IS NOT NULL ORDER BY acquired_at DESC LIMIT 1),'') <> ?
        )
        AND (SELECT COALESCE(SUM(quota_cost),0) FROM api_usage
          WHERE month=? AND source IN ('cfbd','cbbd')) < ?
    `).bind(day,hash,month,endpoint,new Date(now).toISOString(),now,day,daily,month,monthly,month,month,providerSafe).run();
    if(Number(res?.meta?.changes||0)!==1)return {allowed:false,reason:"CFBD_DUPLICATE_COOLDOWN_OR_BUDGET"};
    return {allowed:true,day,hash,endpoint};
  } catch {
    return {allowed:false,reason:"CFBD_RECEIPTS_UNAVAILABLE"};
  }
}
export async function completeCfbdRequest(env,permit, status, response, now=Date.now()) {
  if (!permit?.allowed || !env.DB?.prepare)return;
  const remainingRaw=response?.headers?.get?.("X-CallLimit-Remaining");
  const remaining=remainingRaw!=null && /^\d+$/.test(String(remainingRaw))?Number(remainingRaw):null;
  const kind=status===429?"rate_limited":status>=200&&status<300?"ok":status===0?"transport_error":"http_error";
  try {
    await env.DB.prepare(`UPDATE cfb_cfbd_acquisition_receipts SET
      request_status=?,http_status=?,provider_remaining=?,finished_at=?
      WHERE request_day=? AND request_hash=?`)
      .bind(kind,status,remaining,new Date(now).toISOString(),permit.day,permit.hash).run();
    if (remaining!==null) {
      await env.DB.prepare("UPDATE cfb_cfbd_acquisition_control SET last_remaining=? WHERE id=1").bind(remaining).run();
    }
    if(status===429) {
      const retry=response?.headers?.get?.("Retry-After");
      const seconds=/^\d+(?:\.\d+)?$/.test(String(retry||""))?Number(retry):null;
      const parsed=seconds==null?Date.parse(retry||""):now+seconds*1000;
      const until=Math.max(now+15*60_000,Number.isFinite(parsed)?parsed:now+60*60_000);
      await env.DB.prepare(`UPDATE cfb_cfbd_acquisition_control
        SET blocked_until_ms=MAX(blocked_until_ms,?),last_429_at=? WHERE id=1`)
        .bind(until,new Date(now).toISOString()).run();
    }
  } catch {
    // Original reservation remains durable and blocks automatic replay.
  }
}

export async function cfbCfbdAcquisitionHealth(env, now=Date.now()) {
  if(!env.DB?.prepare)return {bound:false,status:"unavailable"};
  const day=receiptDate(now), month=new Date(now).toISOString().slice(0,7);
  try {
    const usage=await env.DB.prepare(`
      SELECT COUNT(*) attempts,
       SUM(CASE WHEN request_status='ok' THEN 1 ELSE 0 END) succeeded,
       SUM(CASE WHEN request_status='rate_limited' THEN 1 ELSE 0 END) rate_limited
      FROM cfb_cfbd_acquisition_receipts WHERE request_month=?`).bind(month).first();
    const today=await env.DB.prepare(`SELECT COUNT(*) attempts FROM cfb_cfbd_acquisition_receipts WHERE request_day=?`).bind(day).first();
    const control=await env.DB.prepare("SELECT blocked_until_ms,last_429_at,last_remaining FROM cfb_cfbd_acquisition_control WHERE id=1").first();
    return {bound:true,month,day,attempts:Number(usage?.attempts||0),
      successes:Number(usage?.succeeded||0),rateLimited:Number(usage?.rate_limited||0),
      attemptsToday:Number(today?.attempts||0),maxDaily:positive(env.CFBD_DAILY_NETWORK_BUDGET,45),
      maxMonthly:positive(env.CFBD_MONTHLY_NETWORK_BUDGET,1400),
      providerRemaining:control?.last_remaining??null,
      last429At:control?.last_429_at??null,
      blockedUntil:Number(control?.blocked_until_ms||0)>now?
       new Date(Number(control.blocked_until_ms)).toISOString():null};
  }catch{return {bound:true,status:"receipt-read-error"};}
}

/**
 * Operator-approved acknowledgement that the shared CFBD/CBBD subscription
 * was replenished. Clears the stale last_remaining=0 pause so the governor
 * can observe a fresh X-CallLimit-Remaining on the next owned request.
 * Does not invent network calls or bypass daily/monthly receipt caps.
 */
export async function acknowledgeCfbdQuotaReplenishment(env, {
  remaining = 75000,
  operatorApproved = false,
  now = Date.now(),
} = {}) {
  if (!operatorApproved) {
    return { ok: false, reason: "OPERATOR_APPROVAL_REQUIRED", canAuthorizeWager: false };
  }
  const next = Number(remaining);
  if (!Number.isInteger(next) || next < 0 || next > 200000) {
    return { ok: false, reason: "INVALID_REMAINING", canAuthorizeWager: false };
  }
  if (!env.DB?.prepare) return { ok: false, reason: "CFBD_D1_REQUIRED", canAuthorizeWager: false };
  try {
    await env.DB.prepare(`
      UPDATE cfb_cfbd_acquisition_control
      SET last_remaining=?, blocked_until_ms=0
      WHERE id=1
    `).bind(next).run();
    return {
      ok: true,
      providerRemaining: next,
      acknowledgedAt: new Date(now).toISOString(),
      note: "Stale exhaustion cleared; next owned CFBD call will refresh remaining from provider headers.",
      canAuthorizeWager: false,
    };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), canAuthorizeWager: false };
  }
}
