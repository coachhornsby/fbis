// Independent prospective recovery for delayed/dropped GitHub cron deliveries.
// No historical dates, paid odds refresh, tracker cleanup, or authority changes.
export const RECOVERY_CRON = "*/10 * * * *";
export const RECOVERY_SPORTS = ["mlb", "nba", "wnba", "nhl", "nfl", "cfb", "cbb", "soccer"];

export async function recoverCurrentPipeline(env, controller, request = fetch, now = new Date()) {
  if (!env.HARVEST_SECRET) throw new Error("HARVEST_SECRET missing");
  const base = env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
  const scheduledAt = new Date(controller.scheduledTime).toISOString();
  if (Math.abs(now.getTime() - controller.scheduledTime) > 5 * 60 * 1000) {
    throw new Error("Stale scheduled event; historical replay blocked");
  }
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const readHealth = async () => {
    const response = await request(`${base}/api/health?_t=${Date.now()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`health HTTP ${response.status}`);
    const health = await response.json();
    if (!/^[0-9a-f]{40}$/i.test(health.deploymentCommit || "")) throw new Error("Live production SHA unavailable");
    return health;
  };
  const health = await readHealth();
  const sha = health.deploymentCommit;
  const needsRecovery = (name, state) => ["missed", "never observed"].includes(state)
    || (health.staleChecks || []).some(check => check.name === name);
  const collect = needsRecovery("scheduled-collect", health.pipeline?.schedule?.collect?.state);
  const harvest = needsRecovery("scheduled-harvest", health.pipeline?.schedule?.harvest?.state);
  if (!health.pipeline?.schedule) throw new Error("Pipeline schedule unavailable");
  const result = { scheduledAt, currentDate, productionSha: sha, collect, harvest, calls: [] };
  if (!collect && !harvest) return { ...result, status: "not_due" };
  const invoke = async (job, sport) => {
    if ((await readHealth()).deploymentCommit !== sha) throw new Error("Production SHA changed; writes blocked");
    const url = new URL(`${base}/api/${job}`);
    const params = { sport, trigger: "schedule", scheduledSlot: `cloudflare-current-recovery:${scheduledAt}`,
      runUrl: `https://fbis-orchestrator.coachhornsby.workers.dev/health?scheduledAt=${encodeURIComponent(scheduledAt)}` };
    if (job === "collect") Object.assign(params, { odds: "cache", dayOffset: "0" });
    else Object.assign(params, { date: currentDate, settleOnly: "1", gradeResearch: "1" });
    url.search = new URLSearchParams(params).toString();
    const response = await request(url.toString(), {
      headers: { "x-harvest-secret": env.HARVEST_SECRET, accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const body = await response.json();
    const ok = response.status === 200 && body.ok === true && body.status === "success";
    result.calls.push({ job, sport, http: response.status, status: body.status, ok });
    if (!ok) throw new Error(`${job} ${sport} failed HTTP ${response.status} status=${body.status}`);
  };
  // Full cycle is bounded to 8 current-date calls per mode, with no retries.
  // Abort on failure rather than report a partial cycle as successful.
  if (collect) for (const sport of RECOVERY_SPORTS) await invoke("collect", sport);
  if (harvest) for (const sport of RECOVERY_SPORTS) await invoke("harvest", sport);
  const after = await readHealth();
  return { ...result, status: "completed", healthState: after.state, failures: after.failures };
}
