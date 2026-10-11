import test from "node:test";
import assert from "node:assert/strict";
import { buildNflFrozenAuditPacket } from "../functions/lib/nflFrozenPublicationAudit.js";

const match={pass:0,rush:0,explosive:0,pressure:0,trenches:0,total:0};
const side=(power,hfa)=>({teamPower:power,matchup:{...match},qb:{value:0},tracking:{value:0},specialTeams:0,context:0,hfa});
const shadow={ok:true,modelId:"NFL-PRO-v1",version:"v1.2",home:23.5,away:21.5,margin:2,total:45,decomposition:{baseLeaguePpg:22.5,home:side(1,0),away:side(-1,0)}};
test("future frozen audit preserves exact pregame inputs while denying PIT certification",()=>{
 const game={nflProShadow:shadow,model:{projHome:23.5,projAway:21.5},nflFeatures:{home:{offenseEpa:0.1},away:{defenseEpa:0.2}}};
 const packet=buildNflFrozenAuditPacket(game,{research:{nflVerse:{builtAt:"2026-10-11T01:00:00Z"}}});
 assert.equal(packet.ok,true);
 assert.equal(packet.replay.reconciled,true);
 assert.equal(packet.publishedScoreMatches,true);
 assert.equal(packet.pitVerified,false);
 assert.equal(packet.canQualify,false);
 assert.equal(packet.inputSnapshot.home.offenseEpa,0.1);
});
test("unavailable decomposition fails closed",()=>{
 assert.equal(buildNflFrozenAuditPacket({}).ok,false);
});
test("display mismatch is an explicit diagnostic",()=>{
 const packet=buildNflFrozenAuditPacket({nflProShadow:shadow,model:{projHome:18,projAway:18}});
 assert.equal(packet.ok,false);
 assert.equal(packet.reason,"displayed-score-diverges-from-shadow");
 assert.equal(packet.publishedScoreMatches,false);
});

test("cannot claim complete audit when contemporaneous feature input missing",()=>{
 const packet=buildNflFrozenAuditPacket({nflProShadow:shadow,model:{projHome:23.5,projAway:21.5}});
 assert.equal(packet.ok,false);
 assert.equal(packet.reason,"frozen-feature-inputs-unavailable");
 assert.equal(packet.pitVerified,false);
});
