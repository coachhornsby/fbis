import test from "node:test";
import assert from "node:assert/strict";
import {buildCanonicalTeamId,conferenceAt,normalizeTeamAlias,stateOverlayPermission} from "../functions/lib/cfbTeamDirectory.js";

test("team identity uses provider ID instead of school-name relational key",()=> {
  assert.equal(buildCanonicalTeamId({provider:"CFBD",providerTeamId:251,schoolName:"Texas"}),"cfb:cfbd:251");
});
test("aliases normalize without becoming canonical IDs",()=>assert.equal(normalizeTeamAlias("Miami (FL)"),"miami fl"));
test("conference lookup is point-in-time across realignment",()=> {
  const rows=[
    {team_id:"t1",conference_name:"Pac-12",effective_from:"2023-07-01T00:00:00Z",effective_to:"2024-07-01T00:00:00Z"},
    {team_id:"t1",conference_name:"Big Ten",effective_from:"2024-07-01T00:00:00Z",effective_to:null}
  ];
  assert.equal(conferenceAt(rows,"t1","2023-10-01T00:00:00Z").conference_name,"Pac-12");
  assert.equal(conferenceAt(rows,"t1","2024-10-01T00:00:00Z").conference_name,"Big Ten");
});
test("new directory state is forbidden from projection/qualification/wager authority",()=> {
 const p=stateOverlayPermission();
 assert.equal(p.researchOnly,true); assert.equal(p.canInfluenceProjection,false); assert.equal(p.canQualify,false); assert.equal(p.canAuthorizeWager,false);
});
test("UNKNOWN identity is not fabricated",()=>assert.throws(()=>buildCanonicalTeamId({}),/requires/));
