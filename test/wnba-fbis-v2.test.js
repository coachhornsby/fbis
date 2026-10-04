import test from "node:test";
import assert from "node:assert/strict";
import { projectWnbaV2, WNBA_FBIS_V2_ID } from "../functions/lib/wnbaFbisV2.js";
import { canonicalizeProPlayerPropMarket, normalizeProPropSport } from "../functions/lib/proPlayerProps.js";

test("WNBA-FBIS-v2 converts possession efficiency into independent scores",()=>{
  const game={id:"g1",home:{id:"wnba-1",abbr:"LVA"},away:{id:"wnba-2",abbr:"NYL"},neutralSite:false};
  const ctx={league:{ortg:103,pace:80},byTeam:{
    "1":{games:12,ortg:108,drtg:101,pace:81},
    "2":{games:12,ortg:104,drtg:99,pace:79},
  }};
  const p=projectWnbaV2(game,ctx);
  assert.equal(p.ok,true);
  assert.equal(p.modelId,WNBA_FBIS_V2_ID);
  assert.ok(p.home>p.away);
  assert.ok(p.total>140&&p.total<190);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.provenance.marketUsed,false);
});

test("WNBA PrizePicks markets canonicalize through the shared prop registry",()=>{
  assert.equal(normalizeProPropSport("WNBA"),"wnba");
  assert.equal(canonicalizeProPlayerPropMarket("wnba","Pts + Rebs + Asts"),"points_rebounds_assists");
  assert.equal(canonicalizeProPlayerPropMarket("wnba","3 Pointers Made"),"three_pointers_made");
});
