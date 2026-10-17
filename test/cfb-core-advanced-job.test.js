import test from "node:test";
import assert from "node:assert/strict";
import { runCollegeJob, COLLEGE_JOBS } from "../functions/lib/collegeJobsCore.js";
import { acknowledgeCfbdQuotaReplenishment } from "../functions/lib/cfbCfbdAcquisition.js";

test("college jobs include quota replenish ack", () => {
  assert.ok(COLLEGE_JOBS.includes("cfb-quota-replenish-ack"));
});

test("cfb-quota-replenish-ack job requires operator approval", async () => {
  const writes = [];
  const mockEnv = {
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async run() {
                writes.push({ sql, params });
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes("cfb_cfbd_acquisition_control")) {
                  return { blocked_until_ms: 0, last_429_at: null, last_remaining: 75000 };
                }
                return { attempts: 0, succeeded: 0, rate_limited: 0 };
              },
            };
          },
        };
      },
    },
  };
  const denied = await runCollegeJob("cfb-quota-replenish-ack", mockEnv, {
    operatorApproved: false,
    remaining: 75000,
  });
  assert.equal(denied.ok, false);
  assert.match(String(denied.errors?.[0] || ""), /OPERATOR/);

  writes.length = 0;
  const ok = await runCollegeJob("cfb-quota-replenish-ack", mockEnv, {
    operatorApproved: true,
    remaining: 75000,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.d1?.ack?.providerRemaining, 75000);
  assert.ok(writes.some((w) => /last_remaining/.test(w.sql)));
});

test("acknowledge helper rejects invalid remaining", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
  const bad = await acknowledgeCfbdQuotaReplenishment(env, {
    operatorApproved: true,
    remaining: -1,
  });
  assert.equal(bad.ok, false);
});
