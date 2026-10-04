import test from "node:test";
import assert from "node:assert/strict";
import { loadNflVerseFeatures } from "../functions/lib/nflVerseFeed.js";

test("NFL runtime feature load uses R2 snapshot and never fans out to nflverse", async () => {
  let fetchCalls = 0;
  const snapshot = {
    season: 2026,
    byTeam: { DAL: { offenseEpa: 0.1 }, HOU: { offenseEpa: 0.05 } },
    playersByTeam: { DAL: [], HOU: [] },
    meta: { snapshotSchema: "nflverse-features-v2", builtAt: new Date().toISOString(), source: "test" },
  };
  const env = {
    ARCHIVE: {
      get: async (key) => {
        assert.equal(key, "nfl/features/latest.json");
        return { text: async () => JSON.stringify(snapshot) };
      },
    },
  };
  const out = await loadNflVerseFeatures(env, {
    now: Date.now(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("network should not run"); },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(out.meta.runtimeSource, "r2-precomputed");
  assert.equal(out.byTeam.DAL.offenseEpa, 0.1);
});

test("NFL runtime feature load fails fast when snapshot is missing", async () => {
  let fetchCalls = 0;
  const env = { ARCHIVE: { get: async () => null } };
  const out = await loadNflVerseFeatures(env, {
    now: Date.now(),
    fetchFn: async () => { fetchCalls += 1; throw new Error("network should not run"); },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(out.meta.runtimeNetworkDisabled, true);
  assert.equal(out.meta.runtimeSource, "snapshot-missing");
  assert.deepEqual(out.byTeam, {});
});
