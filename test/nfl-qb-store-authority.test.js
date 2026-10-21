import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const shadow=readFileSync(new URL("../functions/api/nfl-qb-shadow.js",import.meta.url),"utf8");
const status=readFileSync(new URL("../functions/api/nfl-research-status.js",import.meta.url),"utf8");
test("NFL QB research table operations require sport handle",()=>{
 assert.match(shadow,/productSportDbHandle\(context\.env, 'nfl'\)\.db\.prepare\(`\s*INSERT OR IGNORE INTO nfl_qb_personnel_shadow_predictions/);
 assert.match(shadow,/productSportDbHandle\(context\.env, 'nfl'\)\.db\.prepare\(`\s*UPDATE nfl_qb_personnel_shadow_predictions/);
 assert.match(shadow,/summary\(context\.env\.DB,productSportDbHandle\(context\.env,'nfl'\)\.db\)/);
 assert.match(status,/productSportDbHandle\(context\.env,'nfl'\)\.db\.prepare\("SELECT \* FROM nfl_qb_personnel_shadow_predictions/);
});
test("Cross-sport canonical outcome evidence must remain in PRIMARY",()=>{
 assert.match(shadow,/persistCanonicalProspectiveEvidence\(context\.env\.DB,/);
 assert.match(shadow,/persistCanonicalEconomicGrade\(context\.env\.DB,/);
});
