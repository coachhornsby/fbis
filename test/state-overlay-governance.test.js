import test from "node:test";
import assert from "node:assert/strict";
import {
  governStateOverlay,
  assertNoImplicitStateMutation,
  OVERLAY_MODE,
  STATE_OVERLAY_GOVERNANCE_VERSION,
} from "../functions/lib/stateOverlayGovernance.js";

const base = { margin: 3.2, total: 47.5, pHome: 0.58 };
const qbChallenger = { margin: 2.1, total: 47.5, pHome: 0.55 };

test("persistent state is context-only by default", () => {
  const d = governStateOverlay({
    baseProjection: base,
    challengerProjection: qbChallenger,
    policy: { sport:"nfl", overlayId:"qb-personnel", gateId:"qb-burden-ge-0.30" },
  });
  assert.equal(d.version, STATE_OVERLAY_GOVERNANCE_VERSION);
  assert.deepEqual(d.productionProjection, base);
  assert.equal(d.shadowProjection, null);
  assert.equal(d.appliedToProduction, false);
  assert.equal(d.reason, "GATE_NOT_FIRED");
});

test("historically validated gated overlay may run in shadow without mutating champion", () => {
  const d = governStateOverlay({
    baseProjection: base,
    challengerProjection: qbChallenger,
    policy: {
      sport:"nfl",
      overlayId:"NFL-QB-PERSONNEL-v1",
      gateId:"QB_PERSONNEL_BURDEN_GE_0_30",
      gateFired:true,
      historicallyValidated:true,
      prospectivelyValidated:false,
      operatorApproved:false,
      mode:OVERLAY_MODE.SHADOW,
    },
  });
  assert.deepEqual(d.productionProjection, base);
  assert.deepEqual(d.shadowProjection, qbChallenger);
  assert.equal(d.appliedToProduction, false);
  assert.equal(d.reason, "SHADOW_ONLY");
  assert.equal(assertNoImplicitStateMutation(d), true);
});

test("historical validation alone can never change production", () => {
  const d = governStateOverlay({
    baseProjection: base,
    challengerProjection: qbChallenger,
    policy: {
      gateFired:true,
      historicallyValidated:true,
      mode:OVERLAY_MODE.PRODUCTION_APPROVED,
    },
  });
  assert.deepEqual(d.productionProjection, base);
  assert.equal(d.appliedToProduction, false);
  assert.equal(d.reason, "PROSPECTIVE_VALIDATION_REQUIRED");
});

test("production overlay requires gate + historical + prospective + operator approval", () => {
  const d = governStateOverlay({
    baseProjection: base,
    challengerProjection: qbChallenger,
    policy: {
      gateFired:true,
      historicallyValidated:true,
      prospectivelyValidated:true,
      operatorApproved:true,
      mode:OVERLAY_MODE.PRODUCTION_APPROVED,
    },
  });
  assert.deepEqual(d.productionProjection, qbChallenger);
  assert.equal(d.appliedToProduction, true);
  assert.equal(d.reason, "VALIDATED_OVERLAY_APPLIED");
  assert.equal(assertNoImplicitStateMutation(d), true);
});
