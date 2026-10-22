import test from "node:test";
import assert from "node:assert/strict";
import {harvestCfbVerifiedDriveWeek} from "../functions/lib/cfbDriveWeekHarvest.js";
import {COLLEGE_JOBS} from "../functions/lib/collegeJobs.js";
import {parseCollegeJobOptions} from "../functions/api/college.js";
test("CFB week-only operator job is routed by existing authorized college workflow",()=>{
 assert.equal(COLLEGE_JOBS.includes("cfb-drive-week6-harvest"),true);
 const r=parseCollegeJobOptions(new Request("https://a.test/api/college?job=cfb-drive-week6-harvest&trigger=workflow_dispatch&operatorApproved=true&year=2026&week=6"));
 assert.equal(r.year,2026);assert.equal(r.week,6);
 assert.equal(r.operatorApproved,true);assert.equal(r.trigger,"workflow_dispatch");
});
test("CFB week-only harvest rejects unauthenticated, unowned and unbound requests before provider calls",async()=>{
 const valid={year:2026,week:6,operatorApproved:true,trigger:"workflow_dispatch"};
 assert.match((await harvestCfbVerifiedDriveWeek({},valid)).reason,/OPERATOR_APPROVAL_REQUIRED/);
 assert.match((await harvestCfbVerifiedDriveWeek({cfbdNetworkAuthorized:true},valid)).reason,/CFB_DB_UNBOUND/);
 const env={cfbdNetworkAuthorized:true,cfbdCacheOnly:false,CFB_DB:{prepare(){}},CFB_DRIVE_RESEARCH_COLLECTION:"enabled"};
 assert.match((await harvestCfbVerifiedDriveWeek(env,{...valid,week:5})).reason,/WEEK_NOT_APPROVED/);
 assert.match((await harvestCfbVerifiedDriveWeek(env,{...valid,operatorApproved:false})).reason,/OPERATOR_APPROVAL_REQUIRED/);
 assert.match((await harvestCfbVerifiedDriveWeek(env,{...valid,year:2027})).reason,/INVALID_CFB_SEASON_WEEK/);
});
