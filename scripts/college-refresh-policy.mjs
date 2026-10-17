/**
 * FBIS scheduled college acquisition owner. Date is evaluated in Chicago,
 * not runner UTC (DST-safe). Caller may only invoke existing approved jobs.
 * No provider access, D1 writes or model/wager authorization occurs here.
 */
const CHICAGO = "America/Chicago";
const DAILY = new Set(["cfb-postgame-harvest", "cbb-postgame-harvest"]);
const WEEKLY = new Set(["cfb-current-refresh", "cbb-current-refresh"]);
export const COLLEGE_REFRESH_JOBS = Object.freeze([...DAILY, ...WEEKLY, "college-health"]);

export function chicagoCollegeDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.valueOf())) throw Error("COLLEGE_REFRESH_INVALID_DATE");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short"
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return { year: Number(get("year")), month: Number(get("month")),
    day: Number(get("day")), weekday: get("weekday") };
}

/**
 * Daily settlement in season; weekly advanced/team enrichment every Monday.
 * CFB Jan postseason is active; CBB Nov-Apr includes tournament play.
 * Outside these windows, provider collection is manual/operator-approved.
 */
export function collegeRefreshDecision(job, now = new Date()) {
  if (!COLLEGE_REFRESH_JOBS.includes(job)) return {
    run: false, reason: "unrecognized_job", job
  };
  const date = chicagoCollegeDate(now);
  const monday = date.weekday === "Mon";
  const cfbActive = date.month >= 8 || date.month === 1;
  const cbbActive = date.month >= 11 || date.month <= 4;
  const isCfb = job.startsWith("cfb-");
  const active = isCfb ? cfbActive : cbbActive;
  const weekly = WEEKLY.has(job);
  const run = job === "college-health" || (active && (!weekly || monday));
  return { job, run, kind: job === "college-health" ? "health" : weekly ? "weekly" : "daily",
    reason: job === "college-health" ? "always" : !active ? "sport_out_of_season" :
      weekly && !monday ? "not_monday" : "scheduled", localDate:
      `${date.year}-${String(date.month).padStart(2,"0")}-${String(date.day).padStart(2,"0")}`,
    timezone: CHICAGO };
}

if (process.argv[1]?.endsWith("/college-refresh-policy.mjs")) {
  const job = process.argv[2];
  const decision = collegeRefreshDecision(job);
  console.log(JSON.stringify(decision));
  if (!decision.run) process.exitCode = 1;
}
