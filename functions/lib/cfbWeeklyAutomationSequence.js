/**
 * CFB weekly automation sequence: collection → validation → freeze → settlement → accuracy.
 * Detects missed runs; quota-safe retries; persistent receipts.
 */

export const AUTOMATION_SEQUENCE_VERSION = "cfb-weekly-automation-sequence-v1";

export const WEEKLY_STEPS = Object.freeze([
  {
    id: "collection",
    jobIds: ["cfb-current-refresh", "cfb-postgame-harvest"],
    order: 1,
    mustCompleteBefore: "validation",
    receiptTables: ["cfb_collection_manifests", "team_feature_snapshots"],
    quotaSafeRetry: true,
  },
  {
    id: "validation",
    jobIds: ["cfb-e2e-weekly-validation"],
    order: 2,
    mustCompleteBefore: "freeze",
    receiptTables: ["cfb_e2e_validation_runs"],
    quotaSafeRetry: false,
    note: "Independent of collector self-success",
  },
  {
    id: "freeze",
    jobIds: ["cfb-pregame-freeze"],
    order: 3,
    mustCompleteBefore: "kickoff",
    receiptTables: ["cfb_pregame_feature_vectors"],
    quotaSafeRetry: true,
  },
  {
    id: "settlement",
    jobIds: ["cfb-postgame-harvest"],
    order: 4,
    mustCompleteBefore: "accuracy",
    receiptTables: ["model_predictions", "games observations"],
    quotaSafeRetry: true,
  },
  {
    id: "accuracy",
    jobIds: ["model-train-validate", "cfb-e2e-weekly-validation"],
    order: 5,
    mustCompleteBefore: null,
    receiptTables: ["cfb_e2e_validation_runs"],
    quotaSafeRetry: false,
    note: "Evaluates frozen preds vs verified finals — never rewrites freezes",
  },
]);

/**
 * Evaluate whether observed job receipts satisfy the sequence for a season/week.
 * @param {{
 *   season:number, week:number,
 *   receiptsByStep?: { [stepId:string]: { ranAt?:string, ok?:boolean, runId?:string } },
 *   now?: Date,
 *   freezeDeadline?: string|null,
 * }} opts
 */
export function evaluateWeeklyAutomationSequence({
  season,
  week,
  receiptsByStep = {},
  now = new Date(),
  freezeDeadline = null,
} = {}) {
  const steps = WEEKLY_STEPS.map((step) => {
    const receipt = receiptsByStep[step.id] || null;
    const ran = Boolean(receipt?.ranAt || receipt?.runId);
    const ok = receipt?.ok !== false && ran;
    return {
      ...step,
      receipt,
      ran,
      ok,
      missed: !ran,
    };
  });

  const orderViolations = [];
  for (let i = 1; i < steps.length; i += 1) {
    const prev = steps[i - 1];
    const cur = steps[i];
    if (cur.ran && prev.ran && prev.receipt?.ranAt && cur.receipt?.ranAt) {
      if (String(cur.receipt.ranAt) < String(prev.receipt.ranAt)) {
        orderViolations.push({
          earlier: cur.id,
          later: prev.id,
          detail: `${cur.id} timestamp precedes ${prev.id}`,
        });
      }
    }
    if (cur.ran && !prev.ran && cur.id !== "settlement") {
      // settlement may reuse postgame harvest job id
      if (!(cur.id === "accuracy" && prev.id === "settlement")) {
        orderViolations.push({
          earlier: cur.id,
          later: prev.id,
          detail: `${cur.id} ran without ${prev.id} receipt`,
        });
      }
    }
  }

  const freezePastDeadline =
    freezeDeadline && new Date(now).toISOString() > String(freezeDeadline) && !steps.find((s) => s.id === "freeze")?.ran;

  const missed = steps.filter((s) => s.missed).map((s) => s.id);

  return {
    version: AUTOMATION_SEQUENCE_VERSION,
    season,
    week,
    steps,
    orderViolations,
    missedRuns: missed,
    freezePastDeadline: Boolean(freezePastDeadline),
    pass: missed.filter((id) => id === "collection" || id === "validation").length === 0 && orderViolations.length === 0,
    sequenceNote:
      "Required order: collection → validation → freeze (pre-kickoff) → settlement → accuracy evaluation",
  };
}

export function describeQuotaSafeRetry(stepId) {
  const step = WEEKLY_STEPS.find((s) => s.id === stepId);
  if (!step) return { ok: false, reason: "unknown_step" };
  return {
    ok: true,
    stepId,
    quotaSafeRetry: step.quotaSafeRetry,
    policy: step.quotaSafeRetry
      ? "Retry only when shared CFBD allowance remaining > stop threshold; never burn quota on empty retries"
      : "No provider quota consumed; safe to re-run",
  };
}
