import test from "node:test";
import assert from "node:assert/strict";
import { resolveWagerAuthority } from "../functions/api/wager-feed.js";
import { MODEL_REGISTRY } from "../functions/lib/canonical/modelRegistry.js";

test("wager authority fails closed for qualified-but-not-authorized model", () => {
  const out = resolveWagerAuthority("MLB-SAVANT-RPG-SP");
  assert.equal(out.modelId, "MLB-SAVANT-RPG-SP");
  assert.equal(out.authorized, false);
  assert.equal(out.source, "MODEL_REGISTRY");
});

test("wager authority fails closed for unknown model identity", () => {
  const out = resolveWagerAuthority("UNKNOWN-MODEL");
  assert.equal(out.authorized, false);
  assert.equal(out.modelId, null);
  assert.equal(out.source, "UNKNOWN_MODEL_FAIL_CLOSED");
});

test("current registry does not silently authorize wagers", () => {
  assert.equal(MODEL_REGISTRY.some((m) => m.canAuthorizeWager === true), false);
});

test("version suffix resolves to canonical model authority", () => {
  const out = resolveWagerAuthority("MLB-SAVANT-RPG-SP@2026-10");
  assert.equal(out.modelId, "MLB-SAVANT-RPG-SP");
  assert.equal(out.authorized, false);
});
