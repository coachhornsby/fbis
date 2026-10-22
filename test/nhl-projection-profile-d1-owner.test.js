import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const source=readFileSync(new URL("../functions/lib/slateEngine.js",import.meta.url),"utf8");
test("NHL-PRO-v2 scoring context never binds persistent profiles to a hard-coded PRIMARY db",()=>{
 assert.match(source,/loadNhlProV2Context\(slate\.date \|\| date, slate\.games \|\| \[\], \{ DB: productSportDbHandle\(env, "nhl"\)\.db \}\)/);
 assert.doesNotMatch(source,/loadNhlProV2Context\([^\n]+\{ DB: env\.DB \}/);
});
test("NHL scoring profile owner resolves to PRIMARY in shadow and NHL D1 after CORE approval",()=>{
 const DB={prepare(){}}, NHL_DB={prepare(){}}, receipt="approved";
 const env={DB,NHL_DB,SPORT_DB_MODE_NHL:"shadow",SPORT_DB_STRICT_NHL:"true",
  SPORT_CUTOVER_RECEIPT_NHL:receipt,
  __fbisCutoverApprovals:new Map([["nhl:"+receipt,{status:"APPROVED",receipt_id:receipt}]])};
 assert.equal(productSportDbHandle(env,"nhl").db,DB);
 env.SPORT_DB_MODE_NHL="sport";
 assert.equal(productSportDbHandle(env,"nhl").db,NHL_DB);
 env.__fbisCutoverApprovals.clear();
 assert.equal(productSportDbHandle(env,"nhl").db,null);
});
