import test from "node:test";
import assert from "node:assert/strict";
import {buildCbbPlayerId,buildCbbStateEvent,directoryPermission,normalizeCbbIdentity,unknownAvailability} from "../functions/lib/cbbPersistentDirectory.js";

test("CBB player identity is team-scoped when provider ID is absent",()=>{
  assert.notEqual(buildCbbPlayerId({teamId:"cbb-1",name:"John Smith"}),buildCbbPlayerId({teamId:"cbb-2",name:"John Smith"}));
});
test("CBB aliases normalize without becoming availability evidence",()=>{
  assert.equal(normalizeCbbIdentity("D.J. Smith"),"d j smith");
  assert.deepEqual(unknownAvailability(),{status:"UNKNOWN",injuryStatus:"UNKNOWN",verified:false});
});
test("CBB directory has zero production authority",()=>{
  const p=directoryPermission(); assert.equal(p.researchOnly,true);assert.equal(p.canInfluenceProjection,false);assert.equal(p.canQualify,false);assert.equal(p.canAuthorizeWager,false);
});
test("state events preserve PIT temporal/provenance contract",()=>{
  const e=buildCbbStateEvent({id:"e1",entityType:"player",entityId:"p1",teamId:"t1",gameId:"g1",season:2025,stateFamily:"ROTATION_PARTICIPATION",value:{seen:true},observedAt:"2025-01-02T00:00:00Z",effectiveAt:"2025-01-01T20:00:00Z",ingestedAt:"2025-01-02T00:01:00Z",source:"CBB-PIT-RESEARCH-v1-37411381038",provenance:{run:37411381038},confidence:.9});
  assert.equal(e.version,"FBIS-PERSISTENT-STATE-v1");assert.equal(e.pitEligible,true);assert.equal(e.canInfluenceProjection,false);assert.equal(e.provenance.run,37411381038);
});
