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
  const text = u.pathname + "?" + [...u.searchParams.entries()].sort(([a,av],[b,bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&");
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { hash: [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join(""), endpoint:u.pathname };
}
export async function reserveCfbdRequest(env, url, now = Date.now()) {
  if (env.cfbdCacheOnly || env.cfbdNetworkAuthorized !== true) return { allowed:false, reason:"CFBD_OWNER_DENIED" };
  if (!env.DB?.prepare) return { allowed:false, reason:"CFBD_D1_REQUIRED" };
  const day=receiptDate(now), month=new Date(now).toISOString().slice(0,7);
  const {hash,endpoint}=await cfbdRequestHash(url);
  const daily=positive(env.CFBD_DAILY_NETWORK_BUDGET,45);
  const monthly=positive(env.CFBD_MONTHLY_NETWORK_BUDGET,1400);
  try {
    // One statement: atomic D1 quota checks + idempotent reservation.
    const res=await env.DB.prepare(`
      INSERT OR IGNORE INTO cfb_cfbd_acquisition_receipts
        (request_day,request_hash,request_month,endpoint,request_status,acquired_at)
      SELECT ?,?,?,?,'reserved',?
      WHERE (SELECT blocked_until_ms FROM cfb_cfbd_acquisition_control WHERE id=1) <= ?
        AND (SELECT COUNT(*) FROM cfb_cfbd_acquisition_receipts WHERE request_day=?) < ?
        AND (SELECT COUNT(*) FROM cfb_cfbd_acquisition_receipts WHERE request_month=?) < ?
        AND (SELECT COALESCE(SUM(quota_cost),0) FROM api_usage
          WHERE month=? AND source IN ('cfbd','cbbd')) < 27500
    `).bind(day,hash,month,endpoint,new Date(now).toISOString(),now,day,daily,month,monthly,month).run();
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
