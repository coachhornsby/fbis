export const STATE_OVERLAY_GOVERNANCE_VERSION = "FBIS-STATE-OVERLAY-v1";

export const OVERLAY_MODE = Object.freeze({
  CONTEXT_ONLY: "CONTEXT_ONLY",
  SHADOW: "SHADOW",
  PRODUCTION_APPROVED: "PRODUCTION_APPROVED",
});

function normalizeId(v) {
  return String(v || "").trim();
}

function freezeDecision(baseProjection = {}, challengerProjection = null, policy = {}) {
  const gateFired = policy.gateFired === true;
  const historicallyValidated = policy.historicallyValidated === true;
  const prospectivelyValidated = policy.prospectivelyValidated === true;
  const operatorApproved = policy.operatorApproved === true;
  const mode = String(policy.mode || OVERLAY_MODE.CONTEXT_ONLY).toUpperCase();

  const productionEligible =
    gateFired &&
    historicallyValidated &&
    prospectivelyValidated &&
    operatorApproved &&
    mode === OVERLAY_MODE.PRODUCTION_APPROVED;

  return {
    version: STATE_OVERLAY_GOVERNANCE_VERSION,
    overlayId: normalizeId(policy.overlayId),
    sport: normalizeId(policy.sport).toLowerCase(),
    gateId: normalizeId(policy.gateId),
    mode,
    gateFired,
    historicallyValidated,
    prospectivelyValidated,
    operatorApproved,
    productionEligible,
    appliedToProduction: productionEligible,
    productionProjection: productionEligible && challengerProjection ? challengerProjection : baseProjection,
    shadowProjection: gateFired && historicallyValidated && challengerProjection ? challengerProjection : null,
    reason: productionEligible
      ? "VALIDATED_OVERLAY_APPLIED"
      : !gateFired
        ? "GATE_NOT_FIRED"
        : !historicallyValidated
          ? "HISTORICAL_VALIDATION_REQUIRED"
          : mode === OVERLAY_MODE.SHADOW
            ? "SHADOW_ONLY"
            : !prospectivelyValidated
              ? "PROSPECTIVE_VALIDATION_REQUIRED"
              : !operatorApproved
                ? "OPERATOR_APPROVAL_REQUIRED"
                : "CONTEXT_ONLY",
  };
}

/**
 * Hard FBIS rule:
 * persistent state may be attached broadly, but it may not replace/mutate the
 * champion projection unless an explicitly gated overlay is historically
 * validated, prospectively validated, and operator-approved for production.
 *
 * Historical-only challengers may be frozen and graded in SHADOW mode without
 * changing the production projection.
 */
export function governStateOverlay({
  baseProjection = {},
  challengerProjection = null,
  policy = {},
} = {}) {
  return freezeDecision(baseProjection, challengerProjection, policy);
}

export function assertNoImplicitStateMutation(decision = {}) {
  if (decision.appliedToProduction !== true) return true;
  return (
    decision.historicallyValidated === true &&
    decision.prospectivelyValidated === true &&
    decision.operatorApproved === true &&
    decision.mode === OVERLAY_MODE.PRODUCTION_APPROVED &&
    decision.gateFired === true
  );
}
