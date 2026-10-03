import test from "node:test";
import assert from "node:assert/strict";
import {buildCbbPro,SIDE_EDGE_MIN} from "../functions/lib/cbbProModel.js";
const g=(x={})=>({sport:"cbb",neutralSite:!!x.neutral,home:{abbr:"H"},away:{abbr:"A"},odds:{pinSpread:x.spread??-4,pinTotal:x.total??150},challengers:{"CBB-KENPOM-RATINGS-v1":{ok:true,margin:x.kpMargin??10,total:x.kpTotal??154,home:82,away:72},"CBB-CBBD-RATINGS-v1":{ok:true,margin:x.cbMargin??8,total:x.cbTotal??152,home:80,away:72}}});
test("fixed side gate",()=>{const p=buildCbbPro(g());assert.equal(SIDE_EDGE_MIN,4);assert.equal(p.side.qualified,true);assert.equal(p.side.kenpomEdge,6);assert.equal(p.side.cbbdEdge,4)});
test("sub four rejected",()=>assert.equal(buildCbbPro(g({kpMargin:7})).side.qualified,false));
test("opposite confirmation rejected",()=>assert.equal(buildCbbPro(g({cbMargin:2})).side.qualified,false));
test("subset tags retained",()=>{const p=buildCbbPro(g({cbMargin:9,neutral:true}));assert.ok(p.side.tags.includes("CBBD_CONFIRM_GE2"));assert.ok(p.side.tags.includes("KENPOM_EDGE_GE6"));assert.ok(p.side.tags.includes("NEUTRAL_SITE"))});
test("total is separate",()=>{const p=buildCbbPro(g({total:148,kpTotal:154,cbTotal:152}));assert.equal(p.totalDecision.projectedTotal,153);assert.equal(p.totalDecision.researchCandidate,true);assert.equal(p.totalDecision.qualified,false)});
