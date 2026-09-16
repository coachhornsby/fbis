export const ACTION_COST_DEFAULTS = Object.freeze({
  // Total ACTION budget remains comfortably inside the user's <=$30/mo
  // operating ceiling. Daily ceilings below reserve spend for later, higher-value
  // windows instead of letting early BASE calls consume the entire day.
  monthlyBudgetUsd: 22,
  dailyBudgetUsd: 0.9,
  maxSuccessfulRunsPerDay: 6,
  profileDailyCeilingsUsd: Object.freeze({
    BASE: 0.35,
    PLAYER_PROPS: 0.72,
    MLB_F5: 0.72,
    MOVEMENT: 0.9,
    FINAL: 0.9,
    CAPABILITY_AUDIT: 0.9,
  }),
});

const PROFILE_COOLDOWN_MINUTES = Object.freeze({
  BASE: 240,
  PLAYER_PROPS: 180,
  MOVEMENT: 90,
  FINAL: 90,
  MLB_F5: 180,
  CAPABILITY_AUDIT: 360,
});

function finitePositive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function actionCostPolicyFromEnv(env = {}) {
  return {
    monthlyBudgetUsd: finitePositive(
      env.ACTION_APIFY_HARD_MONTHLY_BUDGET_USD,
      ACTION_COST_DEFAULTS.monthlyBudgetUsd,
    ),
    dailyBudgetUsd: finitePositive(
      env.ACTION_APIFY_HARD_DAILY_BUDGET_USD,
      ACTION_COST_DEFAULTS.dailyBudgetUsd,
    ),
    maxSuccessfulRunsPerDay: Math.max(
      1,
      Math.floor(
        finitePositive(
          env.ACTION_APIFY_MAX_SUCCESSFUL_RUNS_PER_DAY,
          ACTION_COST_DEFAULTS.maxSuccessfulRunsPerDay,
        ),
      ),
    ),
  };
}

export function actionCooldownMinutes({ profile, lifecycle, env = {} } = {}) {
  const explicit = Number(env.ACTION_APIFY_MIN_INTERVAL_MINUTES);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const p = String(profile || "BASE").toUpperCase();
  const lc = String(lifecycle || "").toLowerCase();
  if (lc === "final_pregame") return 90;
  return PROFILE_COOLDOWN_MINUTES[p] || 240;
}

export function profileDailyCeilingUsd(profile, env = {}) {
  const p = String(profile || "BASE").toUpperCase();
  const explicit = Number(env[`ACTION_APIFY_DAILY_CEILING_${p}_USD`]);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return ACTION_COST_DEFAULTS.profileDailyCeilingsUsd[p] ?? ACTION_COST_DEFAULTS.dailyBudgetUsd;
}

/** Conservative preflight estimate. Observed ACTION runs have been ~0.0076/item. */
export function estimateActionRunUsd(maxItems) {
  const n = Math.max(1, Math.min(200, Number(maxItems) || 20));
  return Math.max(0.05, n * 0.008);
}

export function evaluateActionSpendGuard({
  now = new Date(),
  monthToDateUsd = 0,
  dayToDateUsd = 0,
  successfulRunsToday = 0,
  lastSuccessAt = null,
  profile = "BASE",
  lifecycle = "pregame",
  maxItems = 20,
  env = {},
} = {}) {
  const policy = actionCostPolicyFromEnv(env);
  const cooldownMinutes = actionCooldownMinutes({ profile, lifecycle, env });
  const blocks = [];

  const p = String(profile || "BASE").toUpperCase();
  const mtd = Number(monthToDateUsd) || 0;
  const dtd = Number(dayToDateUsd) || 0;
  const runs = Number(successfulRunsToday) || 0;
  const estimatedNextRunUsd = estimateActionRunUsd(maxItems);
  const profileCeilingUsd = Math.min(policy.dailyBudgetUsd, profileDailyCeilingUsd(p, env));

  if (mtd + estimatedNextRunUsd > policy.monthlyBudgetUsd + 1e-9) {
    blocks.push({
      code: "HARD_MONTHLY_BUDGET",
      message: `ACTION next run would exceed monthly budget (${mtd.toFixed(2)} + ${estimatedNextRunUsd.toFixed(2)} > ${policy.monthlyBudgetUsd.toFixed(2)})`,
    });
  }

  if (dtd + estimatedNextRunUsd > policy.dailyBudgetUsd + 1e-9) {
    blocks.push({
      code: "HARD_DAILY_BUDGET",
      message: `ACTION next run would exceed daily budget (${dtd.toFixed(2)} + ${estimatedNextRunUsd.toFixed(2)} > ${policy.dailyBudgetUsd.toFixed(2)})`,
    });
  }

  // Information-value reservation: low-value BASE calls stop early so later
  // PLAYER_PROPS and FINAL_PREGAME windows retain spend headroom.
  if (dtd + estimatedNextRunUsd > profileCeilingUsd + 1e-9) {
    blocks.push({
      code: "PROFILE_DAILY_RESERVE",
      message: `ACTION ${p} daily allocation exhausted (${dtd.toFixed(2)} + ${estimatedNextRunUsd.toFixed(2)} > ${profileCeilingUsd.toFixed(2)})`,
    });
  }

  if (runs >= policy.maxSuccessfulRunsPerDay) {
    blocks.push({
      code: "DAILY_RUN_CAP",
      message: `ACTION daily successful-run cap reached (${runs} / ${policy.maxSuccessfulRunsPerDay})`,
    });
  }

  if (lastSuccessAt) {
    const lastMs = Date.parse(lastSuccessAt);
    if (Number.isFinite(lastMs)) {
      const elapsedMinutes = (now.getTime() - lastMs) / 60000;
      if (elapsedMinutes >= 0 && elapsedMinutes < cooldownMinutes) {
        blocks.push({
          code: "COLLECTION_COOLDOWN",
          message: `ACTION ${p} cooldown active (${Math.floor(elapsedMinutes)}m elapsed; ${cooldownMinutes}m required)`,
          retryAfterMinutes: Math.ceil(cooldownMinutes - elapsedMinutes),
        });
      }
    }
  }

  return {
    allowed: blocks.length === 0,
    blocks,
    policy,
    cooldownMinutes,
    profileDailyCeilingUsd: profileCeilingUsd,
    estimatedNextRunUsd,
    monthToDateUsd: mtd,
    dayToDateUsd: dtd,
    successfulRunsToday: runs,
  };
}
