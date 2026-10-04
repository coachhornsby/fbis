import test from "node:test";
import assert from "node:assert/strict";
import {buildCbbPro,SIDE_EDGE_MIN} from "../functions/lib/cbbProModel.js";
import {FBIS_CBB_V2_TOTAL_ID} from "../functions/lib/cbbFbisV2Total.js";

const fbis=()=>({ok:true,total:150,possessions:72.0509515,paceAdjustment:-0.01629131,homeEff:98.94032957,awayEff:98.14600372,reliability:0.22443635,hca:5.03567988,
 matchup:{home:{efg:1.31932395,twoPt:1.59611771,threePt:0.60801314,orebVsDrb:1.15955698,drbRate:72.35599142,turnover:0.58762826,ftr:0.92901543},
 away:{efg:1.45985439,twoPt:1.73520387,threePt:0.69136861,orebVsDrb:1.05462795,drbRate:72.5602724,turnover:0.45241759,ftr:1.01291402}},
 schedule:{home:{sos:2.26953594,conferenceStrength:3.58387109},away:{sos:2.13688084,conferenceStrength:2.82645912}}});
const g=(x={})=>({sport:"cbb",neutralSite:!!x.neutral,home:{abbr:"H"},away:{abbr:"A"},odds:{pinSpread:x.spread??-4,pinTotal:x.total??150},challengers:{
 "CBB-KENPOM-RATINGS-v1":{ok:true,margin:x.kpMargin??10,total:x.kpTotal??154,home:82,away:72},
 "CBB-CBBD-RATINGS-v1":{ok:true,margin:x.cbMargin??8,total:x.cbTotal??152,home:80,away:72},
 "FBIS-CBB-RATINGS-v2":x.fbis??fbis()
}});
test("fixed side gate",()=>{const p=buildCbbPro(g());assert.equal(SIDE_EDGE_MIN,4);assert.equal(p.side.qualified,true);assert.equal(p.side.kenpomEdge,6);assert.equal(p.side.cbbdEdge,4)});
test("sub four rejected",()=>assert.equal(buildCbbPro(g({kpMargin:7})).side.qualified,false));
test("opposite confirmation rejected",()=>assert.equal(buildCbbPro(g({cbMargin:2})).side.qualified,false));
test("subset tags retained",()=>{const p=buildCbbPro(g({cbMargin:9,neutral:true}));assert.ok(p.side.tags.includes("CBBD_CONFIRM_GE2"));assert.ok(p.side.tags.includes("KENPOM_EDGE_GE6"));assert.ok(p.side.tags.includes("NEUTRAL_SITE"))});
test("validated FBIS total is production projection only",()=>{
 const p=buildCbbPro(g({total:148}));
 assert.equal(p.totalDecision.modelId,FBIS_CBB_V2_TOTAL_ID);
 assert.equal(p.totalDecision.projectedTotal,141.7);
 assert.equal(p.totalDecision.qualified,false);
 assert.equal(p.totalDecision.researchCandidate,false);
 assert.equal(p.totalDecision.authority.canQualify,false);
 assert.equal(p.total,141.7);
 assert.equal(p.margin,10);
 assert.equal(p.home,75.9);
 assert.equal(p.away,65.9);
});
