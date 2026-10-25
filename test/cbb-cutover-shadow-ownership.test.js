import test from "node:test";
import assert from "node:assert/strict";
import {
  SPORT_PREFIX_TABLES,
  sportMigrationScope,
  copySportPrefixTables,
} from "../functions/lib/sportWorkingCopy.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const requiredOwners = [
  "cbb_canonical_teams",
  "cbb_conference_membership",
  "cbb_team_aliases",
  "cbb_players",
  "cbb_player_aliases",
  "cbb_player_provider_ids",
  "cbb_roster_membership",
  "cbb_roster_observations",
  "cbb_schedule_items",
  "cbb_team_profile_snapshots",
  "cbb_team_state_snapshots",
  "cbb_player_state_snapshots",
  "cbb_game_state_snapshots",
  "cbb_availability_observations",
  "cbb_state_events",
  "cbb_rotation_observations",
  "cbb_team_context_observations",
  "cbb_directory_population_runs",
  "cbb_directory_phase_b_runs",
  "cbb_state_overlay_governance",
  "cbb_shadow_challenger_definitions",
];

test("CBB cutover cannot omit current PRIMARY-owned non-prop research tables", () => {
  const declared = SPORT_PREFIX_TABLES.cbb;
  assert.equal(declared.length, requiredOwners.length);
  assert.deepEqual([...declared].sort(), [...requiredOwners].sort());
  assert.equal(declared.includes("cbb_player_prop_signals"), false,
    "Player props require separate ownership and authorization");
  const scope = sportMigrationScope("cbb");
  assert.equal(scope.syncEligible, true);
  assert.equal(scope.cutoverAuthorized, false);
  assert.equal(scope.canAuthorizeWager, false);
  assert.equal(scope.deferredPlayerProps, true);
});

test("CBB shadow and unapproved strict sport modes never reach the private owner", async () => {
  const primary = { prepare() {} }, shard = { prepare() {} };
  const shadow = { DB: primary, CBB_DB: shard, SPORT_DB_MODE_CBB: "shadow" };
  const routed = productSportDbHandle(shadow, "cbb", { mode: "sport" });
  assert.equal(routed.db, primary);
  assert.notEqual(routed.db, shard);
  assert.equal(routed.productIoUsesSportDb, false);
  const strict = { ...shadow, SPORT_DB_MODE_CBB: "sport", SPORT_DB_STRICT_CBB: "true" };
  for (const opts of [
    {},
    { SPORT_CUTOVER_RECEIPT_CBB: "unapproved-receipt" },
    { SPORT_CUTOVER_RECEIPT_CBB: "unapproved-receipt", __fbisCutoverApprovals: new Map() },
  ]) {
    const denied = productSportDbHandle({ ...strict, ...opts }, "cbb");
    assert.equal(denied.db, null);
    assert.equal(denied.productIoUsesSportDb, false);
    assert.equal(denied.canAuthorizeWager, false);
  }
  const refused = await copySportPrefixTables(strict, "cbb");
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "SHADOW_SYNC_REFUSED_SPORT_MODE");
});
