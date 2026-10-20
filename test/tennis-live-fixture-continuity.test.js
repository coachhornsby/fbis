import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("Tennis independently observed live fixtures remain research-only and clearly stale",()=>{
 const src=readFileSync(new URL("../functions/lib/tennisIntelligenceBank.js",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../src/components/board/TennisMatchCard.jsx",import.meta.url),"utf8");
 assert.match(src,/12 \* 3600000/);
 assert.match(src,/fixtureFreshness:fixtureAgeMs<=3\*3600000\?"CURRENT":"STALE"/);
 assert.match(src,/STALE_FIXTURE_STATUS/);
 assert.match(src,/canQualify: false, canAuthorizeWager: false/);
 assert.match(ui,/STATUS STALE/);
});
