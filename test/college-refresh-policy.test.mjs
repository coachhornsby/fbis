import test from "node:test";
import assert from "node:assert/strict";
import {chicagoCollegeDate,collegeRefreshDecision,COLLEGE_REFRESH_JOBS} from "../scripts/college-refresh-policy.mjs";

test("reliable Central calendar across spring and fall DST",()=>{
  assert.equal(chicagoCollegeDate("2026-03-09T02:30:00Z").weekday, "Sun");
  assert.equal(chicagoCollegeDate("2026-03-09T02:30:00Z").day, 8);
  assert.equal(chicagoCollegeDate("2026-11-02T13:30:00Z").weekday, "Mon");
  assert.equal(chicagoCollegeDate("2026-11-02T13:30:00Z").day, 2);
});
test("CFB advances every Monday during August-January and settles every in-season morning",()=>{
  assert.equal(collegeRefreshDecision("cfb-current-refresh","2026-10-19T12:30:00Z").run,true);
  assert.equal(collegeRefreshDecision("cfb-current-refresh","2026-10-20T12:30:00Z").run,false);
  assert.equal(collegeRefreshDecision("cfb-postgame-harvest","2026-10-20T12:30:00Z").run,true);
  assert.equal(collegeRefreshDecision("cfb-current-refresh","2027-01-04T13:30:00Z").run,true);
  assert.equal(collegeRefreshDecision("cfb-postgame-harvest","2027-03-01T13:30:00Z").run,false);
});
test("CBB advances every Monday November-April while daily finals continue",()=>{
  assert.equal(collegeRefreshDecision("cbb-current-refresh","2026-11-02T13:30:00Z").run,true);
  assert.equal(collegeRefreshDecision("cbb-current-refresh","2026-11-03T13:30:00Z").run,false);
  assert.equal(collegeRefreshDecision("cbb-postgame-harvest","2026-11-03T13:30:00Z").run,true);
  assert.equal(collegeRefreshDecision("cbb-postgame-harvest","2027-04-05T12:30:00Z").run,true);
  assert.equal(collegeRefreshDecision("cbb-current-refresh","2027-06-07T12:30:00Z").run,false);
});
test("January runs both sports, July spends no college provider allowance",()=>{
  for(const job of ["cfb-postgame-harvest","cbb-postgame-harvest"])
    assert.equal(collegeRefreshDecision(job,"2027-01-05T13:30:00Z").run,true);
  for(const job of COLLEGE_REFRESH_JOBS.filter(j=>j!=="college-health"))
    assert.equal(collegeRefreshDecision(job,"2027-07-05T12:30:00Z").run,false);
  assert.equal(collegeRefreshDecision("college-health","2027-07-05T12:30:00Z").run,true);
});
test("unknown jobs always fail closed",()=>{
  assert.equal(collegeRefreshDecision("model-promote","2026-10-19T12:30:00Z").run,false);
  assert.throws(()=>chicagoCollegeDate("bad-date"),/INVALID_DATE/);
});
