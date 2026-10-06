import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalPlayerId,
  membershipAt,
  normalizePlayerAlias,
  playerAt,
  rosterAt,
  rosterStatePermission
} from "../functions/lib/cfbPlayerDirectory.js";

test("stable provider athlete ID wins over name matching",()=> {
  assert.equal(
    buildCanonicalPlayerId({provider:"ESPN",providerPlayerId:4433975,fallbackKey:"same-name"}),
    "cfb:espn-player:4433975"
  );
});

test("same names do not collide when provider IDs differ",()=> {
  const a=buildCanonicalPlayerId({provider:"ESPN",providerPlayerId:1});
  const b=buildCanonicalPlayerId({provider:"ESPN",providerPlayerId:2});
  assert.notEqual(a,b);
});

test("name formatting changes normalize as aliases without changing identity",()=> {
  assert.equal(normalizePlayerAlias("D.J. Uiagalelei"),"d j uiagalelei");
  assert.equal(
    buildCanonicalPlayerId({provider:"ESPN",providerPlayerId:4428994}),
    buildCanonicalPlayerId({provider:"ESPN",providerPlayerId:4428994,fallbackKey:"different-name"})
  );
});

test("position and jersey changes do not create a new canonical identity",()=> {
  const id1=buildCanonicalPlayerId({provider:"ESPN",providerPlayerId:77});
  const id2=buildCanonicalPlayerId({provider:"ESPN",providerPlayerId:77});
  assert.equal(id1,id2);
});

test("verified program change keeps one player identity with distinct memberships",()=> {
  const playerId="cfb:espn-player:77";
  const rows=[
    {player_id:playerId,team_id:"cfb:espn:1",season:2024,effective_from:"2024-07-01T00:00:00Z",effective_to:"2025-07-01T00:00:00Z"},
    {player_id:playerId,team_id:"cfb:espn:2",season:2025,effective_from:"2025-07-01T00:00:00Z",effective_to:"2026-07-01T00:00:00Z"}
  ];
  assert.equal(membershipAt(rows,playerId,"2024-10-01T00:00:00Z")[0].team_id,"cfb:espn:1");
  assert.equal(membershipAt(rows,playerId,"2025-10-01T00:00:00Z")[0].team_id,"cfb:espn:2");
});

test("same-name records without stable evidence require distinct provisional keys",()=> {
  const a=buildCanonicalPlayerId({fallbackKey:"2024:1:john-smith:1"});
  const b=buildCanonicalPlayerId({fallbackKey:"2024:2:john-smith:1"});
  assert.notEqual(a,b);
});

test("PIT lookup cannot see next-season membership",()=> {
  const rows=[
    {player_id:"p1",team_id:"t1",effective_from:"2024-07-01T00:00:00Z",effective_to:"2025-07-01T00:00:00Z"},
    {player_id:"p1",team_id:"t2",effective_from:"2025-07-01T00:00:00Z",effective_to:"2026-07-01T00:00:00Z"}
  ];
  assert.deepEqual(membershipAt(rows,"p1","2024-11-01T00:00:00Z").map(x=>x.team_id),["t1"]);
  assert.deepEqual(rosterAt(rows,"t2","2024-11-01T00:00:00Z"),[]);
});

test("missing roster evidence remains unknown rather than fabricated",()=> {
  const out=playerAt([{player_id:"p1",canonical_name:"Player"}],[],"p1","2024-10-01T00:00:00Z");
  assert.deepEqual(out.memberships,[]);
  assert.equal(playerAt([],[],"missing","2024-10-01T00:00:00Z"),null);
});

test("roster state has zero projection, qualification, or wager authority",()=> {
  const p=rosterStatePermission();
  assert.equal(p.researchOnly,true);
  assert.equal(p.canInfluenceProjection,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorizeWager,false);
});


test("same-season later-team membership cannot leak backward",()=> {
  const rows=[
    {player_id:"p1",team_id:"old",pit_resolvable:1,effective_from:"2025-07-01T00:00:00Z",effective_to:"2025-10-15T00:00:00Z"},
    {player_id:"p1",team_id:"new",pit_resolvable:1,effective_from:"2025-10-15T00:00:00Z",effective_to:"2026-07-01T00:00:00Z"}
  ];
  assert.deepEqual(membershipAt(rows,"p1","2025-09-01T00:00:00Z").map(x=>x.team_id),["old"]);
  assert.deepEqual(membershipAt(rows,"p1","2025-11-01T00:00:00Z").map(x=>x.team_id),["new"]);
});

test("ambiguous same-season program state stays UNKNOWN for PIT lookup",()=> {
  const rows=[
    {player_id:"p1",team_id:"a",pit_resolvable:0,effective_from:"2025-07-01T00:00:00Z",effective_to:"2026-07-01T00:00:00Z"},
    {player_id:"p1",team_id:"b",pit_resolvable:0,effective_from:"2025-07-01T00:00:00Z",effective_to:"2026-07-01T00:00:00Z"}
  ];
  assert.deepEqual(membershipAt(rows,"p1","2025-10-01T00:00:00Z"),[]);
  assert.deepEqual(rosterAt(rows,"a","2025-10-01T00:00:00Z"),[]);
});
