import test from "node:test";
import assert from "node:assert/strict";
import {
  CFB_STAFF_ROLES, normalizeStaffAlias, buildCfbdStaffId,
  staffRoleAt, explicitPlayCallerAt, coachStatePermission
} from "../functions/lib/cfbCoachDirectory.js";

test("CFB staff identity uses stable provider IDs and names are not identity keys", () => {
  assert.equal(buildCfbdStaffId(123), "cfb:cfbd-staff:123");
  assert.equal(buildCfbdStaffId(null), null);
  assert.equal(normalizeStaffAlias("  José  Smith Jr. "), "jose smith jr");
  assert.notEqual(buildCfbdStaffId(1), buildCfbdStaffId(2));
});

test("season role can be known while exact PIT date remains fail closed", () => {
  const rows=[{team_id:"t1",role:"HEAD_COACH",season:2026,pit_resolvable:0,effective_from:null,effective_to:null}];
  assert.equal(staffRoleAt(rows,"t1","HEAD_COACH",2026), rows[0]);
  assert.equal(staffRoleAt(rows,"t1","HEAD_COACH",2026,"2026-10-01T00:00:00Z"), null);
});

test("historical query never exposes a future season assignment", () => {
  const rows=[
    {team_id:"a",role:"HEAD_COACH",season:2025,pit_resolvable:0},
    {team_id:"b",role:"HEAD_COACH",season:2026,pit_resolvable:0},
  ];
  assert.equal(staffRoleAt(rows,"a","HEAD_COACH",2025), rows[0]);
  assert.equal(staffRoleAt(rows,"b","HEAD_COACH",2025), null);
});

test("coordinator identity never implies play-caller identity", () => {
  const rows=[{team_id:"t",role:CFB_STAFF_ROLES.OFFENSIVE_COORDINATOR,season:2026,pit_resolvable:0}];
  assert.equal(explicitPlayCallerAt(rows,"t","offense",2026), null);
});

test("explicit play caller is returned only from explicit role evidence", () => {
  const pc={team_id:"t",role:CFB_STAFF_ROLES.OFFENSIVE_PLAY_CALLER,season:2026,pit_resolvable:0};
  assert.equal(explicitPlayCallerAt([pc],"t","offense",2026), pc);
});

test("multiple simultaneous coordinator roles remain representable", () => {
  const rows=[
    {person_id:"p1",team_id:"t",role:CFB_STAFF_ROLES.OFFENSIVE_COORDINATOR,season:2026},
    {person_id:"p2",team_id:"t",role:CFB_STAFF_ROLES.OFFENSIVE_COORDINATOR,season:2026},
  ];
  assert.equal(rows.filter(r=>r.role===CFB_STAFF_ROLES.OFFENSIVE_COORDINATOR).length,2);
});

test("coach state authority fails closed", () => {
  assert.equal(coachStatePermission({can_influence_projection:0,can_qualify:0,can_authorize_wager:0}),false);
  assert.equal(coachStatePermission({can_influence_projection:1,can_qualify:1,can_authorize_wager:1}),true);
});
