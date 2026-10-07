// Independent prospective recovery for delayed/dropped GitHub cron deliveries.
// No historical dates, paid odds refresh, tracker cleanup, or authority changes.
export const RECOVERY_CRON = "*/10 * * * *";
export const RECOVERY_SPORTS = ["mlb", "nba", "wnba", "nhl", "nfl", "cfb", "cbb", "soccer"];

export async function recoverCurrentPipeline(env, controller, request = fetch, now = new Date(), clock = Date.now) {
  if (!env.HARVEST_SECRET) throw new Error("HARVEST_SECRET missing");
  const base = env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
  const deadline = clock() + 8 * 60 * 1000;
  const boundedTimeout = (maximum) => {
    const remaining = deadline - clock();
    if (remaining <= 0) throw new Error("Recovery cycle time budget exhausted");
    return AbortSignal.timeout(Math.min(maximum, remaining));
  };
  const scheduledAt = new Date(controller.scheduledTime).toISOString();
  if (Math.abs(now.getTime() - controller.scheduledTime) > 5 * 60 * 1000) {
    throw new Error("Stale scheduled event; historical replay blocked");
  }
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const readHealth = async () => {
    let response;
    try {
      response = await request(`${base}/api/health?_t=${clock()}`, {
        signal: boundedTimeout(40000),
      });
    } catch (error) {
      throw new Error(`Production health read failed: ${error.message}`);
    }
    if (!response.ok) throw new Error(`health HTTP ${response.status}`);
    const health = await response.json();
    if (!/^[0-9a-f]{40}$/i.test(health.deploymentCommit || "")) throw new Error("Live production SHA unavailable");
    return health;
  };
  const health = await readHealth();
  const sha = health.deploymentCommit;
  const coverageUrl = new URL(`${base}/api/collect-current`);
  coverageUrl.search = new URLSearchParams({ status: "1", trigger: "schedule", expectedSha: sha }).toString();
  const coverageResponse = await request(coverageUrl.toString(), {
    headers: { "x-harvest-secret": env.HARVEST_SECRET, accept: "application/json" },
    signal: boundedTimeout(40000),
  });
  if (!coverageResponse.ok) throw new Error(`Current collection coverage HTTP ${coverageResponse.status}`);
  const coverage = await coverageResponse.json();
  if (!coverage.ok || !Array.isArray(coverage.missingSports)
    || coverage.missingSports.some(s => !RECOVERY_SPORTS.includes(s))
    || !Array.isArray(coverage.missingHarvestSports)
    || coverage.missingHarvestSports.some(s => !RECOVERY_SPORTS.includes(s))) throw new Error("Current collection coverage unavailable");
  const needsRecovery = (name, state) => ["missed", "never observed"].includes(state)
    || (health.staleChecks || []).some(check => check.name === name);
  const collect = needsRecovery("scheduled-collect", health.pipeline?.schedule?.collect?.state)
    || coverage.initializing === true || coverage.inProgress === true || coverage.overdue === true;
  const collectSports = collect ? (coverage.missingSports.length ? coverage.missingSports : RECOVERY_SPORTS) : [];
  const harvestSchedule = health.pipeline?.schedule?.harvest;
  // GitHub also owns an hourly settlement cron. Cover a missing hourly delivery
  // prospectively, without waiting for the much wider release-health window.
  const hourlyHarvestGap = now.getTime() - Date.parse(harvestSchedule?.lastObservedAt) >= 60 * 60 * 1000;
  const harvest = needsRecovery("scheduled-harvest", harvestSchedule?.state) || hourlyHarvestGap
    || coverage.missingHarvestSports.length > 0;
  const harvestSports = harvest ? (coverage.missingHarvestSports.length ? coverage.missingHarvestSports : RECOVERY_SPORTS) : [];
  if (!health.pipeline?.schedule) throw new Error("Pipeline schedule unavailable");
  const result = { scheduledAt, currentDate, productionSha: sha, collect, harvest,
    harvestReason: harvest ? (hourlyHarvestGap ? "hourly_delivery_gap" : coverage.missingHarvestSports.length ? "per_sport_hourly_delivery_gap" : "missed_or_stale") : null, calls: [] };
  if (!collect && !harvest) return { ...result, status: "not_due", healthState: health.state, failures: health.failures };
  const invoke = async (job, sport) => {
    if ((await readHealth()).deploymentCommit !== sha) throw new Error("Production SHA changed; writes blocked");
    const url = new URL(`${base}/api/${job === "collect" ? "collect-current" : job}`);
    const params = { sport, trigger: "schedule", expectedSha: sha, scheduledSlot: `cloudflare-current-recovery:${scheduledAt}`,
      runUrl: `https://fbis-orchestrator.coachhornsby.workers.dev/health?scheduledAt=${encodeURIComponent(scheduledAt)}` };
    if (job === "collect") Object.assign(params, { odds: "cache", dayOffset: "0" });
    else Object.assign(params, { date: currentDate, settleOnly: "1", gradeResearch: "1" });
    url.search = new URLSearchParams(params).toString();
    const response = await request(url.toString(), {
      headers: { "x-harvest-secret": env.HARVEST_SECRET, accept: "application/json" },
      signal: boundedTimeout(60000),
    });
    const body = await response.json();
    const ok = response.status === 200 && body.ok === true && body.status === "success";
    result.calls.push({ job, sport, http: response.status, status: body.status, ok });
    if (!ok) throw new Error(`${job} ${sport} failed HTTP ${response.status} status=${body.status}`);
  };
  // Full cycle is bounded to 8 current-date calls per mode, with no retries.
  // Abort on failure rather than report a partial cycle as successful.
  if (collect) for (const sport of collectSports) await invoke("collect", sport);
  if (harvest) for (const sport of harvestSports) await invoke("harvest", sport);
  const after = await readHealth();
  return { ...result, status: "completed", healthState: after.state, failures: after.failures };
}
