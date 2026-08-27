/**
 * GitHub cron is UTC. Operator timezone is America/Chicago.
 * CDT = UTC-5 (~second Sunday Mar–first Sunday Nov). CST = UTC-6 otherwise.
 * Concurrency group fbis-research-pipeline prevents overlapping runs.
 * Diagnostic minute-7/37 jobs are cache-only health and must never select collect-full.
 */

export const PRODUCTION_COLLECT_HOURS_UTC = [0, 2, 13, 16, 18, 20, 22];
export const PRODUCTION_HARVEST_UTC = { hour: 11, minute: 20 };
export const DIAGNOSTIC_MINUTES = [7, 37];

export const CRON_CHICAGO = [
  { utc: "00:00", cdt: "19:00 previous day", cst: "18:00 previous day", job: "collect-cache" },
  { utc: "02:00", cdt: "21:00", cst: "20:00", job: "collect-cache" },
  { utc: "11:20", cdt: "06:20", cst: "05:20", job: "harvest" },
  { utc: "13:00", cdt: "08:00", cst: "07:00", job: "collect-full" },
  { utc: "16:00", cdt: "11:00", cst: "10:00", job: "collect-full" },
  { utc: "18:00", cdt: "13:00", cst: "12:00", job: "collect-cache" },
  { utc: "20:00", cdt: "15:00", cst: "14:00", job: "collect-cache" },
  { utc: "22:00", cdt: "17:00", cst: "16:00", job: "collect-cache" },
];

export function triggerFromEvent(eventName) {
  if (eventName === "schedule") return "schedule";
  if (eventName === "workflow_dispatch") return "workflow_dispatch";
  return "http";
}

export function isDiagnosticMinute(minuteUtc) {
  return DIAGNOSTIC_MINUTES.includes(Number(minuteUtc));
}

/**
 * Job selection for the GitHub pipeline. Diagnostic schedule minutes never
 * spend Parlay or Pal quota (health = cache-only).
 */
export function selectPipelineJob({ hourUtc, minuteUtc, eventName, jobInput, diagnostic = false } = {}) {
  const trigger = triggerFromEvent(eventName || (jobInput ? "workflow_dispatch" : "schedule"));
  if (jobInput) return { job: jobInput, trigger };
  const hour = Number(hourUtc);
  const minute = Number(minuteUtc);
  if (diagnostic && eventName === "schedule" && isDiagnosticMinute(minute)) {
    return { job: "health", trigger: "schedule" };
  }
  if (hour === 11 && minute >= 15) return { job: "harvest", trigger };
  if (hour === 13 || hour === 16) return { job: "collect-full", trigger };
  return { job: "collect-cache", trigger };
}

export function chicagoZoneName(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "short",
  }).formatToParts(now instanceof Date ? now : new Date(now));
  return parts.find((p) => p.type === "timeZoneName")?.value || "CT";
}

export function utcHourToChicago(hourUtc, zone) {
  const offset = zone === "CST" ? -6 : -5;
  let h = Number(hourUtc) + offset;
  const prev = h < 0;
  if (h < 0) h += 24;
  return { hour: h, previousDay: prev };
}

export function nextCronUtc(now = new Date(), crons = PRODUCTION_COLLECT_HOURS_UTC) {
  const t = now instanceof Date ? now : new Date(now);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const d = t.getUTCDate();
  const slots = [];
  for (const add of [0, 1]) {
    for (const hour of crons) {
      slots.push(Date.UTC(y, m, d + add, hour, 0, 0));
    }
  }
  const harvestToday = Date.UTC(y, m, d, PRODUCTION_HARVEST_UTC.hour, PRODUCTION_HARVEST_UTC.minute, 0);
  const harvestTomorrow = Date.UTC(y, m, d + 1, PRODUCTION_HARVEST_UTC.hour, PRODUCTION_HARVEST_UTC.minute, 0);
  const all = [...slots, harvestToday, harvestTomorrow].filter((ms) => ms > t.getTime()).sort((a, b) => a - b);
  return all[0] ? new Date(all[0]).toISOString() : null;
}

export function lastExpectedCollectUtc(now = new Date()) {
  const t = now instanceof Date ? now : new Date(now);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const d = t.getUTCDate();
  const slots = [];
  for (const add of [-1, 0]) {
    for (const hour of PRODUCTION_COLLECT_HOURS_UTC) {
      slots.push(Date.UTC(y, m, d + add, hour, 0, 0));
    }
  }
  const past = slots.filter((ms) => ms <= t.getTime()).sort((a, b) => b - a);
  return past[0] ? new Date(past[0]).toISOString() : null;
}

export function lastExpectedHarvestUtc(now = new Date()) {
  const t = now instanceof Date ? now : new Date(now);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const d = t.getUTCDate();
  const today = Date.UTC(y, m, d, PRODUCTION_HARVEST_UTC.hour, PRODUCTION_HARVEST_UTC.minute, 0);
  const yest = Date.UTC(y, m, d - 1, PRODUCTION_HARVEST_UTC.hour, PRODUCTION_HARVEST_UTC.minute, 0);
  const ms = today <= t.getTime() ? today : yest;
  return new Date(ms).toISOString();
}

const GRACE_MS = 45 * 60 * 1000;

export function scheduledPipelineState({ lastScheduledSuccessAt, lastExpectedAt, now = new Date(), neverObserved = false, disabled = false } = {}) {
  if (disabled) return { state: "disabled", lastExpectedAt, lastObservedAt: lastScheduledSuccessAt || null };
  if (neverObserved || !lastScheduledSuccessAt) {
    return { state: "never observed", lastExpectedAt, lastObservedAt: null };
  }
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const expected = lastExpectedAt ? Date.parse(lastExpectedAt) : NaN;
  const observed = Date.parse(lastScheduledSuccessAt);
  if (!Number.isFinite(observed)) return { state: "unknown", lastExpectedAt, lastObservedAt: lastScheduledSuccessAt };
  if (Number.isFinite(expected) && observed + 60 * 1000 >= expected) {
    return { state: "healthy", lastExpectedAt, lastObservedAt: lastScheduledSuccessAt };
  }
  if (Number.isFinite(expected) && nowMs < expected + GRACE_MS) {
    return { state: "delayed", lastExpectedAt, lastObservedAt: lastScheduledSuccessAt };
  }
  if (Number.isFinite(expected) && nowMs >= expected + GRACE_MS) {
    return { state: "missed", lastExpectedAt, lastObservedAt: lastScheduledSuccessAt };
  }
  const ageH = (nowMs - observed) / 3600000;
  if (ageH > 14) return { state: "missed", lastExpectedAt, lastObservedAt: lastScheduledSuccessAt };
  return { state: "healthy", lastExpectedAt, lastObservedAt: lastScheduledSuccessAt };
}
