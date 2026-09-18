export const ACTION_COST_DEFAULTS = Object.freeze({
  // Keep ACTION inside the user's <=$30/mo total operating ceiling while
  // reserving enough room for the pro-player-prop snapshots that actually matter.
  monthlyBudgetUsd: 15,
  dailyBudgetUsd: 1.0,
  maxSuccessfulRunsPerDay: 1,
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

export function actionCostPolicyFromEnv(env = {}, now = new Date()) {
  const configuredMonthlyBudgetUsd = finitePositive(
    env.ACTION_APIFY_HARD_MONTHLY_BUDGET_USD,
    ACTION_COST_DEFAULTS.monthlyBudgetUsd,
  );
  // Temporary recovery allowance authorized for September 2026 after the
  // retired multi-run orchestration exhausted the normal monthly ceiling.
  // This automatically disappears on October 1, 2026.
  const september2026Recovery =
    now.getUTCFullYear() === 2026 && now.getUTCMonth() === 8 ? 25 : 0;

  return {
    monthlyBudgetUsd: Math.max(configuredMonthlyBudgetUsd, september2026Recovery),
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

export function evaluateActionSpendGuard({
  now = new Date(),
  monthToDateUsd = 0,
  dayToDateUsd = 0,
  successfulRunsToday = 0,
  lastSuccessAt = null,
  profile = "BASE",
  lifecycle = "pregame",
  env = {},
} = {}) {
  const policy = actionCostPolicyFromEnv(env, now);
  const cooldownMinutes = actionCooldownMinutes({ profile, lifecycle, env });
  const blocks = [];

  const mtd = Number(monthToDateUsd) || 0;
  const dtd = Number(dayToDateUsd) || 0;
  const runs = Number(successfulRunsToday) || 0;

  if (mtd >= policy.monthlyBudgetUsd - 1e-9) {
    blocks.push({
      code: "HARD_MONTHLY_BUDGET",
      message: `ACTION hard monthly budget reached (${mtd.toFixed(2)} / ${policy.monthlyBudgetUsd.toFixed(2)})`,
    });
  }

  if (dtd >= policy.dailyBudgetUsd - 1e-9) {
    blocks.push({
      code: "HARD_DAILY_BUDGET",
      message: `ACTION hard daily budget reached (${dtd.toFixed(2)} / ${policy.dailyBudgetUsd.toFixed(2)})`,
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
          message: `ACTION ${String(profile || "BASE").toUpperCase()} cooldown active (${Math.floor(elapsedMinutes)}m elapsed; ${cooldownMinutes}m required)`,
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
    monthToDateUsd: mtd,
    dayToDateUsd: dtd,
    successfulRunsToday: runs,
  };
}
